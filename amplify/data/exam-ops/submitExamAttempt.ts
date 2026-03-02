import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getCorrectAnswerForTask, getIdentitySub, normalizeAnswer } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const SUBMIT_GRACE_MS = 2 * 60_000; // allow submit up to 2 minutes after end
const SUBMISSION_LOCK_STALE_MS = 10 * 60_000;

function parseIsoMs(iso?: string | null) {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

function firstErrorMessage(errors?: unknown[]) {
  const first = errors?.[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.errorMessage === "string") return record.errorMessage;
  return "";
}

async function hasExistingAttempt(userId: string, examId: string) {
  const existingAttempt = await client.models.ExamAttempt.list({
    filter: {
      userId: { eq: userId },
      examId: { eq: examId },
    },
    limit: 1,
  });
  return (existingAttempt.data ?? []).some(Boolean);
}

async function acquireSubmissionLock(userId: string, examId: string, nowIso: string, nowMs: number) {
  const lockCreate = await client.models.ExamAttemptLock.create({
    owner: userId,
    examId,
    createdAt: nowIso,
  });
  if (lockCreate.data) return true;

  // If an attempt already exists, this is not "in progress" but already submitted.
  if (await hasExistingAttempt(userId, examId)) {
    throw new Error("ALREADY_SUBMITTED");
  }

  // Inspect existing lock.
  const existingLockRes = await client.models.ExamAttemptLock.get({ owner: userId, examId });
  const existingLock = existingLockRes.data;

  // Finalized lock means submission already completed.
  if (existingLock?.attemptId) {
    throw new Error("ALREADY_SUBMITTED");
  }

  // Recover stale in-progress locks left by crashed/incomplete submissions.
  const lockCreatedMs = parseIsoMs(existingLock?.createdAt);
  const isStale = Number.isFinite(lockCreatedMs) && nowMs - lockCreatedMs > SUBMISSION_LOCK_STALE_MS;

  if (existingLock && isStale) {
    try {
      await client.models.ExamAttemptLock.delete({ owner: userId, examId });
    } catch (err) {
      console.error("Failed to delete stale submission lock:", err);
    }

    const retry = await client.models.ExamAttemptLock.create({
      owner: userId,
      examId,
      createdAt: nowIso,
    });
    if (retry.data) return true;
  }

  const reason = firstErrorMessage(lockCreate.errors);
  if (reason) console.error("Failed to acquire submission lock:", reason);
  throw new Error("SUBMISSION_IN_PROGRESS");
}

async function releaseSubmissionLock(userId: string, examId: string) {
  try {
    await client.models.ExamAttemptLock.delete({ owner: userId, examId });
  } catch (err) {
    // Do not fail the request after a failed submission; cleanup can be retried.
    console.error("Failed to release submission lock:", err);
  }
}

export const handler: Schema["submitExamAttempt"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const { examId, answersJson, startedAt } = event.arguments;

  if (!examId) throw new Error("EXAM_ID_REQUIRED");

  // 1) Access check (secured variant)
  const accessRes = await client.models.ExamAccess.get({ owner: userId, examId });
  if (!accessRes.data) throw new Error("NOT_AUTHORIZED_FOR_EXAM");

  // 2) Load exam + time window
  const examRes = await client.models.MockExam.get({ id: examId });
  const exam = examRes.data;
  if (!exam) throw new Error("EXAM_NOT_FOUND");

  const startAtIso = exam.startAt;
  const duration = Number(exam.durationMinutes ?? 0);

  if (!startAtIso || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("EXAM_INVALID_WINDOW");
  }

  const startMs = parseIsoMs(startAtIso);
  const endMs = startMs + duration * 60_000;
  const nowMs = Date.now();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("EXAM_INVALID_WINDOW");
  }

  if (nowMs < startMs) throw new Error("EXAM_NOT_STARTED");
  // allow submitting slightly after end (for auto-submit + network delays)
  if (nowMs > endMs + SUBMIT_GRACE_MS) throw new Error("EXAM_ENDED");
  const nowIso = new Date(nowMs).toISOString();

  // Fast-path check before lock acquisition.
  if (await hasExistingAttempt(userId, examId)) {
    throw new Error("ALREADY_SUBMITTED");
  }

  let lockCreatedThisCall = false;
  let attemptCreated = false;

  try {
    // Atomic lock: prevents concurrent submit races.
    lockCreatedThisCall = await acquireSubmissionLock(userId, examId, nowIso, nowMs);

    // Double-check once lock is held.
    if (await hasExistingAttempt(userId, examId)) {
      throw new Error("ALREADY_SUBMITTED");
    }

    // 4) Parse answers
    let answers: Record<string, string> = {};
    try {
      const parsed = JSON.parse(answersJson ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        answers = parsed as Record<string, string>;
      }
    } catch {
      throw new Error("INVALID_ANSWERS_JSON");
    }

    // 5) Load tasks
    const tasksRes = await client.models.Task.list({
      filter: { examId: { eq: examId } },
      limit: 500,
    });
    const tasks = (tasksRes.data ?? [])
      .filter((task): task is NonNullable<typeof task> => !!task)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (tasks.length === 0) {
      throw new Error("EXAM_HAS_NO_TASKS");
    }

    // 6) Compute score using TaskKey and keep immutable review snapshot
    let maxScore = 0;
    let score = 0;
    const reviewItems: Schema["ReviewItem"]["type"][] = [];

    for (const t of tasks) {
      const rawMark = Number(t.mark ?? 0);
      const mark = Number.isFinite(rawMark) && rawMark > 0 ? rawMark : 0;
      if (mark > 0) maxScore += mark;

      const userAnswer = normalizeAnswer(answers[t.id]);
      const correct = await getCorrectAnswerForTask(client.models.TaskKey, t.id);
      const isCorrect =
        !!correct && !!userAnswer && userAnswer.toLowerCase() === correct.toLowerCase();
      const earned = isCorrect ? mark : 0;
      if (isCorrect) score += mark;

      reviewItems.push({
        taskId: t.id,
        order: t.order ?? null,
        question: t.question ?? "",
        mark,
        correctAnswer: correct,
        userAnswer,
        isCorrect,
        earned,
      });
    }

    // record an endedAt based on official end time (not "now")
    const endedAtIso = new Date(endMs).toISOString();

    // startedAt: accept client hint, but clamp to [startMs, nowMs] to avoid tampering.
    const requestedStartedAtMs = parseIsoMs(startedAt);
    const safeStartedAtMs = Number.isFinite(requestedStartedAtMs)
      ? Math.max(startMs, Math.min(requestedStartedAtMs, nowMs))
      : Math.max(startMs, Math.min(nowMs, endMs));
    const startedAtIso = new Date(safeStartedAtMs).toISOString();

    // 7) Create attempt
    const attemptRes = await client.models.ExamAttempt.create({
      userId,
      examId,
      admissionType: exam.admissionType ?? "",
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      submittedAt: nowIso,
      score,
      maxScore,
      answersJson: JSON.stringify(answers),
      reviewItemsJson: JSON.stringify(reviewItems),
    });

    if (!attemptRes.data) throw new Error("FAILED_TO_CREATE_ATTEMPT");
    attemptCreated = true;

    // Finalize lock as permanent "already submitted" marker.
    try {
      const lockUpdate = await client.models.ExamAttemptLock.update({
        owner: userId,
        examId,
        attemptId: attemptRes.data.id,
        finalizedAt: nowIso,
      });
      if (lockUpdate.errors?.length) {
        console.error("Failed to finalize submission lock:", lockUpdate.errors);
      }
    } catch (err) {
      console.error("Failed to finalize submission lock:", err);
    }

    return attemptRes.data;
  } catch (err) {
    // If submit failed before attempt creation, release lock to allow retry.
    if (lockCreatedThisCall && !attemptCreated) {
      await releaseSubmissionLock(userId, examId);
    }
    throw err;
  }
};

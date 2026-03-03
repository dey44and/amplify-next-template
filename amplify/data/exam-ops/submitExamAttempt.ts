import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getCorrectAnswerForTask, getIdentitySub, normalizeAnswer } from "./_shared";
import {
  BASE_TOPIC_RATING,
  baselineItemRating,
  guessingAwareExpected,
  itemK,
  normalizeOptionsCount,
  normalizeTopic,
  studentK,
} from "./_adaptive";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const SUBMIT_GRACE_MS = 2 * 60_000; // allow submit up to 2 minutes after end
const SUBMISSION_LOCK_STALE_MS = 10 * 60_000;
const EXAM_STUDENT_K_MULTIPLIER = 0.35;
const EXAM_ITEM_K_MULTIPLIER = 0.15;
const EXAM_ITEM_UPDATE_GATE = 15;

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

type TaskLike = {
  id: string;
  topic?: string | null;
  authorDifficulty?: string | null;
  optionsCount?: number | null;
};

type ReviewItemLike = {
  taskId: string;
  isCorrect?: boolean | null;
};

async function updateRatingsFromExamAttempt(args: {
  userId: string;
  tasks: TaskLike[];
  reviewItems: ReviewItemLike[];
  nowIso: string;
}) {
  const { userId, tasks, reviewItems, nowIso } = args;

  const reviewByTaskId = new Map<string, ReviewItemLike>();
  for (const item of reviewItems) {
    if (!item.taskId) continue;
    reviewByTaskId.set(item.taskId, item);
  }

  const topics = Array.from(
    new Set(tasks.map((task) => normalizeTopic(task.topic)))
  );

  const [topicResList, itemResList] = await Promise.all([
    Promise.all(
      topics.map((topic) => client.models.UserTopicRating.get({ owner: userId, topic }))
    ),
    Promise.all(tasks.map((task) => client.models.TaskDifficultyRating.get({ taskId: task.id }))),
  ]);

  const topicState = new Map<
    string,
    { rating: number; attempts: number; existed: boolean }
  >();
  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    const row = topicResList[i].data;

    const rating = Number(row?.rating);
    const attempts = Number(row?.attempts);
    topicState.set(topic, {
      rating: Number.isFinite(rating) ? rating : BASE_TOPIC_RATING,
      attempts:
        Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0,
      existed: Boolean(row),
    });
  }

  const itemState = new Map<
    string,
    { rating: number; attempts: number; existed: boolean; optionsCount: number }
  >();
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const row = itemResList[i].data;

    const rating = Number(row?.rating);
    const attempts = Number(row?.attempts);
    itemState.set(task.id, {
      rating: Number.isFinite(rating)
        ? rating
        : baselineItemRating(task.authorDifficulty),
      attempts:
        Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0,
      existed: Boolean(row),
      optionsCount: normalizeOptionsCount(task.optionsCount),
    });
  }

  // Online updates per task answer: topic always updates; item difficulty updates only after enough evidence.
  for (const task of tasks) {
    const review = reviewByTaskId.get(task.id);
    if (!review) continue;

    const topic = normalizeTopic(task.topic);
    const tState = topicState.get(topic);
    const iState = itemState.get(task.id);
    if (!tState || !iState) continue;

    const expected = guessingAwareExpected(
      tState.rating,
      iState.rating,
      iState.optionsCount
    );
    const score = review.isCorrect ? 1 : 0;

    const ku = studentK(tState.attempts) * EXAM_STUDENT_K_MULTIPLIER;
    tState.rating += ku * (score - expected);
    tState.attempts += 1;

    const shouldUpdateItemDifficulty = iState.attempts >= EXAM_ITEM_UPDATE_GATE;
    if (shouldUpdateItemDifficulty) {
      const ki = itemK(iState.attempts) * EXAM_ITEM_K_MULTIPLIER;
      iState.rating += ki * (expected - score);
    }
    iState.attempts += 1;
  }

  // Persist topic ratings.
  for (const [topic, state] of topicState) {
    if (state.existed) {
      const res = await client.models.UserTopicRating.update({
        owner: userId,
        topic,
        rating: state.rating,
        attempts: state.attempts,
        updatedAt: nowIso,
      });
      if (res.errors?.length) {
        console.error(`UserTopicRating.update failed for topic ${topic}:`, res.errors);
      }
      continue;
    }

    const createRes = await client.models.UserTopicRating.create({
      owner: userId,
      topic,
      rating: state.rating,
      attempts: state.attempts,
      updatedAt: nowIso,
    });
    if (createRes.errors?.length || !createRes.data) {
      console.error(`UserTopicRating.create failed for topic ${topic}:`, createRes.errors);
    }
  }

  // Persist item ratings/attempt counts.
  for (const [taskId, state] of itemState) {
    if (state.existed) {
      const res = await client.models.TaskDifficultyRating.update({
        taskId,
        rating: state.rating,
        attempts: state.attempts,
        updatedAt: nowIso,
      });
      if (res.errors?.length) {
        console.error(`TaskDifficultyRating.update failed for task ${taskId}:`, res.errors);
      }
      continue;
    }

    const createRes = await client.models.TaskDifficultyRating.create({
      taskId,
      rating: state.rating,
      attempts: state.attempts,
      updatedAt: nowIso,
    });
    if (createRes.errors?.length || !createRes.data) {
      console.error(`TaskDifficultyRating.create failed for task ${taskId}:`, createRes.errors);
    }
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

    // Safe policy: apply lower-weight Elo updates from exam answers.
    // This must never block exam submission success.
    try {
      await updateRatingsFromExamAttempt({
        userId,
        tasks: tasks.map((task) => ({
          id: task.id,
          topic: task.topic,
          authorDifficulty: task.authorDifficulty,
          optionsCount: task.optionsCount,
        })),
        reviewItems: reviewItems.map((item) => ({
          taskId: item.taskId,
          isCorrect: item.isCorrect,
        })),
        nowIso,
      });
    } catch (err) {
      console.error("Exam rating updates failed (ignored to preserve submission):", err);
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

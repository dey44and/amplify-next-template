import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/submitExamAttempt"; // must match your function name

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

function getSub(event: any): string {
  const identity = event.identity as any;
  const sub = identity?.sub ?? identity?.claims?.sub ?? identity?.username;
  if (!sub) throw new Error("UNAUTHENTICATED");
  return sub;
}

function normalizeAnswer(a: unknown) {
  return String(a ?? "").trim();
}

async function getCorrectAnswerForTask(taskId: string): Promise<string> {
  const m: any = client.models.TaskKey;

  // ✅ Prefer secondary-index query if available (fast + correct)
  const candidateFns = [
    "listTaskKeysByTaskId",
    "taskKeysByTaskId",
    "listByTaskId",
  ];

  for (const fnName of candidateFns) {
    if (typeof m?.[fnName] === "function") {
      const r = await m[fnName]({ taskId, limit: 1 });
      const item = (r?.data ?? [])[0];
      return String((item as any)?.correctAnswer ?? "").trim();
    }
  }

  // ✅ Fallback: scan without limit:1 (works for small tables)
  const r = await client.models.TaskKey.list({
    filter: { taskId: { eq: taskId } },
    limit: 500, // do NOT set 1
  });

  if (r.errors?.length) {
    console.error("TaskKey.list errors:", r.errors);
  }

  const item = (r.data ?? []).find(Boolean);
  return String((item as any)?.correctAnswer ?? "").trim();
}

const SUBMIT_GRACE_MS = 2 * 60_000; // allow submit up to 2 minutes after end

export const handler: Schema["submitExamAttempt"]["functionHandler"] = async (event) => {
  const userId = getSub(event);
  const { examId, answersJson, startedAt } = event.arguments;

  if (!examId) throw new Error("EXAM_ID_REQUIRED");

  // 1) Access check (secured variant)
  const accessRes = await client.models.ExamAccess.get({ owner: userId, examId } as any);
  if (!accessRes.data) throw new Error("NOT_AUTHORIZED_FOR_EXAM");

  // 2) Load exam + time window
  const examRes = await client.models.MockExam.get({ id: examId });
  const exam = examRes.data;
  if (!exam) throw new Error("EXAM_NOT_FOUND");

  const startAtIso = (exam as any).startAt as string | undefined;
  const duration = Number((exam as any).durationMinutes ?? 0);

  if (!startAtIso || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("EXAM_INVALID_WINDOW");
  }

  const startMs = new Date(startAtIso).getTime();
  const endMs = startMs + duration * 60_000;
  const nowMs = Date.now();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("EXAM_INVALID_WINDOW");
  }

  if (nowMs < startMs) throw new Error("EXAM_NOT_STARTED");
  // allow submitting slightly after end (for auto-submit + network delays)
  if (nowMs > endMs + SUBMIT_GRACE_MS) throw new Error("EXAM_ENDED");

  // 3) Prevent multiple attempts (one attempt per exam)
  const existingAttempt = await client.models.ExamAttempt.list({
    filter: {
      userId: { eq: userId },
      examId: { eq: examId },
    },
    limit: 1,
  });

  if ((existingAttempt.data ?? []).some(Boolean)) {
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
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // 6) Compute score using TaskKey (N+1 is OK for small exams)
  let maxScore = 0;
  let score = 0;

  for (const t of tasks) {
    const mark = Number(t.mark ?? 0);
    if (Number.isFinite(mark) && mark > 0) maxScore += mark;

    const userAnswer = normalizeAnswer(answers[t.id]);
    if (!userAnswer) continue;

    const correct = await getCorrectAnswerForTask(t.id);

    if (correct && userAnswer.toLowerCase() === correct.toLowerCase()) {
      score += mark;
    }
  }

  const nowIso = new Date().toISOString();

  // record an endedAt based on official end time (not "now")
  const endedAtIso = new Date(endMs).toISOString();

  // startedAt: keep client-provided if present, otherwise now
  const startedAtIso = startedAt ?? nowIso;

  // 7) Create attempt
  const attemptRes = await client.models.ExamAttempt.create({
    userId,
    examId,
    admissionType: (exam as any).admissionType ?? "",
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    submittedAt: nowIso,
    score,
    maxScore,
    answersJson: JSON.stringify(answers),
  } as any);

  if (!attemptRes.data) throw new Error("FAILED_TO_CREATE_ATTEMPT");

  return attemptRes.data;
};

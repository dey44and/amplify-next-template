import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/getExamReview";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

function getSub(event: any): string {
  const identity = event.identity as any;
  const sub = identity?.sub ?? identity?.claims?.sub ?? identity?.username;
  if (!sub) throw new Error("UNAUTHENTICATED");
  return sub;
}
function normalize(a: unknown) {
  return String(a ?? "").trim();
}

export const handler: Schema["getExamReview"]["functionHandler"] = async (event) => {
  const userId = getSub(event);
  const { attemptId } = event.arguments;

  const attemptRes = await client.models.ExamAttempt.get({ id: attemptId });
  const attempt = attemptRes.data;
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");

  // Ensure owner can only see their attempt (admins can be added if you want)
  if ((attempt as any).userId !== userId) throw new Error("FORBIDDEN");

  const examId = (attempt as any).examId as string;

  let answers: Record<string, string> = {};
  try {
    answers = JSON.parse((attempt as any).answersJson ?? "{}") ?? {};
  } catch {}

  const tasksRes = await client.models.Task.list({
    filter: { examId: { eq: examId } },
    limit: 500,
  });
  const tasks = (tasksRes.data ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const items: any[] = [];
  for (const t of tasks) {
    const userAnswer = normalize(answers[t.id]);
    const keyRes = await client.models.TaskKey.list({
      filter: { taskId: { eq: t.id } },
      limit: 1,
    });
    const correct = normalize((keyRes.data?.[0] as any)?.correctAnswer);

    const mark = Number(t.mark ?? 0);
    const isCorrect =
      !!correct &&
      !!userAnswer &&
      userAnswer.toLowerCase() === correct.toLowerCase();

    items.push({
      taskId: t.id,
      order: t.order ?? null,
      question: t.question ?? "",
      mark,
      correctAnswer: correct,
      userAnswer,
      isCorrect,
      earned: isCorrect ? mark : 0,
    });
  }

  return {
    attemptId,
    examId,
    submittedAt: (attempt as any).submittedAt ?? null,
    score: (attempt as any).score ?? 0,
    maxScore: (attempt as any).maxScore ?? 0,
    items,
  };
};

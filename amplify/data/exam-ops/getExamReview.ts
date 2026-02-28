import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getCorrectAnswerForTask, getIdentitySub, normalizeAnswer } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["getExamReview"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const { attemptId } = event.arguments;

  const attemptRes = await client.models.ExamAttempt.get({ id: attemptId });
  const attempt = attemptRes.data;
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");

  // Ensure owner can only see their attempt (admins can be added if you want)
  if (attempt.userId !== userId) throw new Error("FORBIDDEN");

  const examId = attempt.examId;
  if (!examId) throw new Error("ATTEMPT_MISSING_EXAM");

  let answers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(attempt.answersJson ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      answers = parsed as Record<string, string>;
    }
  } catch {}

  const tasksRes = await client.models.Task.list({
    filter: { examId: { eq: examId } },
    limit: 500,
  });
  const tasks = (tasksRes.data ?? [])
    .filter((task): task is NonNullable<typeof task> => !!task)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const items: Schema["ReviewItem"]["type"][] = [];
  for (const t of tasks) {
    const userAnswer = normalizeAnswer(answers[t.id]);
    const correct = normalizeAnswer(await getCorrectAnswerForTask(client.models.TaskKey, t.id));

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
    submittedAt: attempt.submittedAt ?? null,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    items,
  };
};

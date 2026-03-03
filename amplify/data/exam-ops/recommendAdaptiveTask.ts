import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentitySub } from "./_shared";
import {
  BASE_TOPIC_RATING,
  baselineItemRating,
  guessingAwareExpected,
  normalizeOptionsCount,
  normalizeTopic,
} from "./_adaptive";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

function clampBand(minProb?: number | null, maxProb?: number | null) {
  const minValue = Number(minProb);
  const maxValue = Number(maxProb);

  const min = Number.isFinite(minValue) ? Math.max(0.35, Math.min(0.95, minValue)) : 0.65;
  const max = Number.isFinite(maxValue) ? Math.max(min, Math.min(0.98, maxValue)) : 0.8;

  return { min, max };
}

function bandDistance(prob: number, min: number, max: number) {
  if (prob < min) return min - prob;
  if (prob > max) return prob - max;
  return 0;
}

function stableTopicSet(tasks: Array<{ topic?: string | null }>) {
  const set = new Set<string>();
  for (const task of tasks) {
    set.add(normalizeTopic(task.topic));
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "ro"));
}

export const handler: Schema["recommendAdaptiveTask"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const requestedTopic = String(event.arguments.topic ?? "").trim();
  const { min, max } = clampBand(event.arguments.minProb, event.arguments.maxProb);

  const [tasksRes, examsRes, topicRatingsRes, itemRatingsRes, attemptsRes] = await Promise.all([
    client.models.Task.list({ limit: 2000 }),
    client.models.MockExam.list({ limit: 500 }),
    client.models.UserTopicRating.list({
      filter: { owner: { eq: userId } },
      limit: 500,
    }),
    client.models.TaskDifficultyRating.list({ limit: 2000 }),
    client.models.PracticeAttempt.list({
      filter: { owner: { eq: userId } },
      limit: 2000,
    }),
  ]);

  if (tasksRes.errors?.length) console.error("Task.list errors:", tasksRes.errors);
  if (examsRes.errors?.length) console.error("MockExam.list errors:", examsRes.errors);
  if (topicRatingsRes.errors?.length) {
    console.error("UserTopicRating.list errors:", topicRatingsRes.errors);
  }
  if (itemRatingsRes.errors?.length) {
    console.error("TaskDifficultyRating.list errors:", itemRatingsRes.errors);
  }
  if (attemptsRes.errors?.length) {
    console.error("PracticeAttempt.list errors:", attemptsRes.errors);
  }

  const examsById = new Map<string, string>();
  for (const exam of examsRes.data ?? []) {
    if (!exam?.id) continue;
    examsById.set(exam.id, String(exam.title ?? "Simulare"));
  }

  const tasks = (tasksRes.data ?? []).filter((task) => {
    if (!task?.id) return false;
    const examId = task.examId ?? null;
    if (examId && !examsById.has(examId)) return false;
    return true;
  }) as Array<
    Exclude<NonNullable<typeof tasksRes.data>[number], null | undefined>
  >;

  if (tasks.length === 0) {
    return {
      status: "NO_ITEMS",
      reason: "Nu există itemi în arhivă încă.",
    };
  }

  const userTopicRatings = new Map<string, NonNullable<Schema["UserTopicRating"]["type"]>>();
  for (const row of topicRatingsRes.data ?? []) {
    if (!row?.topic) continue;
    userTopicRatings.set(normalizeTopic(row.topic), row);
  }

  const taskRatings = new Map<string, NonNullable<Schema["TaskDifficultyRating"]["type"]>>();
  for (const row of itemRatingsRes.data ?? []) {
    if (!row?.taskId) continue;
    taskRatings.set(row.taskId, row);
  }

  const seenCountByTaskId = new Map<string, number>();
  for (const row of attemptsRes.data ?? []) {
    if (!row?.taskId) continue;
    seenCountByTaskId.set(row.taskId, (seenCountByTaskId.get(row.taskId) ?? 0) + 1);
  }

  const topics = stableTopicSet(tasks);

  let targetTopics: string[];
  if (requestedTopic) {
    targetTopics = [normalizeTopic(requestedTopic)];
  } else {
    targetTopics = topics
      .map((topic) => {
        const ratingRow = userTopicRatings.get(topic);
        const rating = Number(ratingRow?.rating ?? BASE_TOPIC_RATING);
        return {
          topic,
          rating: Number.isFinite(rating) ? rating : BASE_TOPIC_RATING,
        };
      })
      .sort((a, b) => a.rating - b.rating)
      .slice(0, 2)
      .map((row) => row.topic);
  }

  const candidateTasks = tasks.filter((task) =>
    targetTopics.includes(normalizeTopic(task.topic))
  );

  const pool = candidateTasks.length > 0 ? candidateTasks : tasks;

  const targetCenter = (min + max) / 2;

  const ranked = pool
    .map((task) => {
      const topic = normalizeTopic(task.topic);
      const optionsCount = normalizeOptionsCount(task.optionsCount);

      const topicRatingRow = userTopicRatings.get(topic);
      const itemRatingRow = taskRatings.get(task.id);

      const studentRating = Number(topicRatingRow?.rating ?? BASE_TOPIC_RATING);
      const itemRating = Number(itemRatingRow?.rating ?? baselineItemRating(task.authorDifficulty));
      const expected = guessingAwareExpected(studentRating, itemRating, optionsCount);
      const seenCount = seenCountByTaskId.get(task.id) ?? 0;
      const distance = bandDistance(expected, min, max);
      const centerDistance = Math.abs(expected - targetCenter);

      return {
        task,
        topic,
        optionsCount,
        studentRating,
        itemRating,
        expected,
        seenCount,
        distance,
        centerDistance,
      };
    })
    .sort((a, b) => {
      if ((a.seenCount === 0) !== (b.seenCount === 0)) {
        return a.seenCount === 0 ? -1 : 1;
      }
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.centerDistance !== b.centerDistance) return a.centerDistance - b.centerDistance;
      return (a.task.order ?? 0) - (b.task.order ?? 0);
    });

  const best = ranked[0];

  if (!best) {
    return {
      status: "NO_ITEMS",
      reason: "Nu există candidați eligibili în arhivă.",
    };
  }

  const examId = best.task.examId ?? null;

  return {
    status: "OK",
    taskId: best.task.id,
    examId,
    examTitle: examId ? examsById.get(examId) ?? "Simulare" : "Simulare",
    question: best.task.question ?? "",
    topic: best.topic,
    optionsCount: best.optionsCount,
    expectedCorrectProb: best.expected,
    studentTopicRating: best.studentRating,
  };
};

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

function asFinite(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const handler: Schema["submitPracticeAnswer"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const taskId = event.arguments.taskId;
  const userAnswer = normalizeAnswer(event.arguments.answer);

  const taskRes = await client.models.Task.get({ id: taskId });
  const task = taskRes.data;
  if (!task) throw new Error("TASK_NOT_FOUND");

  const correctAnswer = normalizeAnswer(
    await getCorrectAnswerForTask(client.models.TaskKey, taskId)
  );

  const topic = normalizeTopic(task.topic);
  const optionsCount = normalizeOptionsCount(task.optionsCount);

  const [topicRatingRes, itemRatingRes] = await Promise.all([
    client.models.UserTopicRating.get({ owner: userId, topic }),
    client.models.TaskDifficultyRating.get({ taskId }),
  ]);

  const topicRatingRow = topicRatingRes.data;
  const itemRatingRow = itemRatingRes.data;

  const studentBefore = asFinite(topicRatingRow?.rating, BASE_TOPIC_RATING);
  const itemBefore = asFinite(itemRatingRow?.rating, baselineItemRating(task.authorDifficulty));

  const expected = guessingAwareExpected(studentBefore, itemBefore, optionsCount);
  const isCorrect =
    Boolean(correctAnswer) &&
    Boolean(userAnswer) &&
    userAnswer.toLowerCase() === correctAnswer.toLowerCase();
  const score = isCorrect ? 1 : 0;

  const topicAttemptsBefore = Math.max(0, Math.floor(asFinite(topicRatingRow?.attempts, 0)));
  const itemAttemptsBefore = Math.max(0, Math.floor(asFinite(itemRatingRow?.attempts, 0)));

  const ku = studentK(topicAttemptsBefore);
  const ki = itemK(itemAttemptsBefore);

  const studentAfter = studentBefore + ku * (score - expected);
  const itemAfter = itemBefore + ki * (expected - score);
  const nowIso = new Date().toISOString();

  if (topicRatingRow) {
    const updateRes = await client.models.UserTopicRating.update({
      owner: userId,
      topic,
      rating: studentAfter,
      attempts: topicAttemptsBefore + 1,
      updatedAt: nowIso,
    });

    if (updateRes.errors?.length) {
      console.error("UserTopicRating.update errors:", updateRes.errors);
      throw new Error("FAILED_TO_UPDATE_TOPIC_RATING");
    }
  } else {
    const createRes = await client.models.UserTopicRating.create({
      owner: userId,
      topic,
      rating: studentAfter,
      attempts: 1,
      updatedAt: nowIso,
    });

    if (createRes.errors?.length || !createRes.data) {
      console.error("UserTopicRating.create errors:", createRes.errors);
      throw new Error("FAILED_TO_CREATE_TOPIC_RATING");
    }
  }

  if (itemRatingRow) {
    const updateRes = await client.models.TaskDifficultyRating.update({
      taskId,
      rating: itemAfter,
      attempts: itemAttemptsBefore + 1,
      updatedAt: nowIso,
    });

    if (updateRes.errors?.length) {
      console.error("TaskDifficultyRating.update errors:", updateRes.errors);
      throw new Error("FAILED_TO_UPDATE_ITEM_RATING");
    }
  } else {
    const createRes = await client.models.TaskDifficultyRating.create({
      taskId,
      rating: itemAfter,
      attempts: 1,
      updatedAt: nowIso,
    });

    if (createRes.errors?.length || !createRes.data) {
      console.error("TaskDifficultyRating.create errors:", createRes.errors);
      throw new Error("FAILED_TO_CREATE_ITEM_RATING");
    }
  }

  const attemptRes = await client.models.PracticeAttempt.create({
    owner: userId,
    taskId,
    topic,
    submittedAt: nowIso,
    isCorrect,
    userAnswer,
    expectedProb: expected,
    optionsCount,
    studentRatingBefore: studentBefore,
    studentRatingAfter: studentAfter,
    itemRatingBefore: itemBefore,
    itemRatingAfter: itemAfter,
  });

  if (attemptRes.errors?.length) {
    console.error("PracticeAttempt.create errors:", attemptRes.errors);
  }

  return {
    taskId,
    topic,
    isCorrect,
    correctAnswer,
    expectedCorrectProb: expected,
    studentTopicRatingBefore: studentBefore,
    studentTopicRatingAfter: studentAfter,
  };
};

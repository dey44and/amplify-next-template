import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["listTasksForExam"]["functionHandler"] = async (event) => {
  const examId = event.arguments.examId;
  const userId = getIdentitySub(event);
  const isAdmin = isAdminEvent(event);
  const nowMs = Date.now();

  // Check access
  if (!isAdmin) {
    const accessRes = await client.models.ExamAccess.get({ owner: userId, examId });
    if (!accessRes.data) throw new Error("NOT_AUTHORIZED_FOR_EXAM");
  }

  // Enforce official exam window for students.
  const examRes = await client.models.MockExam.get({ id: examId });
  const exam = examRes.data;
  if (!exam) throw new Error("EXAM_NOT_FOUND");

  const startMs = exam.startAt ? new Date(exam.startAt).getTime() : Number.NaN;
  const durationMinutes = Number(exam.durationMinutes ?? 0);
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(durationMinutes)
      ? startMs + durationMinutes * 60_000
      : Number.NaN;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || durationMinutes <= 0) {
    throw new Error("EXAM_INVALID_WINDOW");
  }

  if (!isAdmin) {
    if (nowMs < startMs) throw new Error("EXAM_NOT_STARTED");
    if (nowMs >= endMs) throw new Error("EXAM_ENDED");
  }

  const tasksRes = await client.models.Task.list({
    filter: { examId: { eq: examId } },
    limit: 500,
  });

  const tasks = (tasksRes.data ?? [])
    .filter((task): task is NonNullable<typeof task> => !!task)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return tasks;
};

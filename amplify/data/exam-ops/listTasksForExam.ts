import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/listTasksForExam"; // must match function name
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["listTasksForExam"]["functionHandler"] = async (event) => {
  const examId = event.arguments.examId;
  const userId = getIdentitySub(event);

  // Check access
  if (!isAdminEvent(event)) {
    const accessRes = await client.models.ExamAccess.get({ owner: userId, examId });
    if (!accessRes.data) throw new Error("NOT_AUTHORIZED_FOR_EXAM");
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

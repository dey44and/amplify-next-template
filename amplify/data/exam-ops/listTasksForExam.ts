import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/listTasksForExam"; // must match function name

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: Schema["listTasksForExam"]["functionHandler"] = async (event) => {
  const examId = event.arguments.examId;

  const sub =
    (event.identity as any)?.sub ??
    (event.identity as any)?.claims?.sub ??
    (event.identity as any)?.claims?.["cognito:username"];

  if (!sub) throw new Error("UNAUTHENTICATED");

  function isAdmin(event: any) {
    const groups =
      event.identity?.groups ??
      event.identity?.claims?.["cognito:groups"] ??
      [];
    const arr = Array.isArray(groups) ? groups : typeof groups === "string" ? [groups] : [];
    return arr.includes("Admin");
  }

  function getUserId(event: any): string {
    const identity = event.identity as any;
  
    // Most common in Amplify Gen 2 functions
    const sub =
      identity?.sub ??
      identity?.claims?.sub ??
      identity?.username ??
      identity?.userId;
  
    if (!sub) throw new Error("UNAUTHENTICATED");
    return sub;
  }
  const userId = getUserId(event);

  // Check access
  if (!isAdmin(event)) {
    const accessRes = await client.models.ExamAccess.get({ owner: userId, examId } as any);
    if (!accessRes.data) throw new Error("NOT_AUTHORIZED_FOR_EXAM");
  }

  const tasksRes = await client.models.Task.list({
    filter: { examId: { eq: examId } },
    limit: 500,
  });

  const tasks = (tasksRes.data ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return tasks;
};

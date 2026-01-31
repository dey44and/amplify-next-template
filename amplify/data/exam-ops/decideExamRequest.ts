import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/decideExamRequest";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

function getIdentity(event: any) {
  // Cast once; TS identity union is strict
  return event.identity as any;
}

function isAdmin(event: any) {
  const identity = getIdentity(event);
  const groups =
    identity?.groups ??
    identity?.claims?.["cognito:groups"] ??
    [];
  const arr = Array.isArray(groups) ? groups : typeof groups === "string" ? [groups] : [];
  return arr.includes("Admin");
}

function actorSub(event: any) {
  const identity = getIdentity(event);
  return identity?.sub ?? identity?.claims?.sub ?? identity?.username ?? "admin";
}

export const handler: Schema["decideExamRequest"]["functionHandler"] = async (event) => {
  if (!isAdmin(event)) throw new Error("FORBIDDEN");

  const { owner, examId, status, note } = event.arguments;

  if (status !== "APPROVED" && status !== "REJECTED") {
    throw new Error("INVALID_STATUS");
  }

  const now = new Date().toISOString();
  const decidedBy = actorSub(event);

  // Update request (identified by owner+examId)
  const reqUpdate = await client.models.ExamRequest.update({
    owner,
    examId,
    status,
    decidedAt: now,
    decidedBy,
    note: note ?? null,
  } as any);

  if (!reqUpdate.data) throw new Error("REQUEST_NOT_FOUND");

  // If approved, create access
  if (status === "APPROVED") {
    const existing = await client.models.ExamAccess.get({ owner, examId });

    if (!existing.data) {
      await client.models.ExamAccess.create({
        owner,
        examId,
        grantedAt: now,
        grantedBy: decidedBy,
        note: note ?? null,
      });
    }
  }

  return reqUpdate.data;
};

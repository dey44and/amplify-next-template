import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

function actorSub(event: Parameters<Schema["decideExamRequest"]["functionHandler"]>[0]) {
  try {
    return getIdentitySub(event);
  } catch {
    return "admin";
  }
}

export const handler: Schema["decideExamRequest"]["functionHandler"] = async (event) => {
  if (!isAdminEvent(event)) throw new Error("FORBIDDEN");

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
  });

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

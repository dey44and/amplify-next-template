import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentityEmail, getIdentitySub } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["requestBacAccess"]["functionHandler"] = async (event) => {
  const owner = getIdentitySub(event);
  const requesterEmail = getIdentityEmail(event);
  const { simulationId } = event.arguments;

  if (!simulationId) throw new Error("BAC_SIMULATION_REQUIRED");
  if (!requesterEmail) throw new Error("BAC_EMAIL_REQUIRED");

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  if (!simulationRes.data) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const existingRes = await client.models.BacRequest.get({ owner, simulationId });
  if (existingRes.data) return existingRes.data;

  const nowIso = new Date().toISOString();
  const createRes = await client.models.BacRequest.create({
    owner,
    simulationId,
    requesterEmail,
    subject: simulationRes.data.subject ?? null,
    status: "PENDING",
    requestedAt: nowIso,
  });

  if (createRes.errors?.length) {
    console.error("BacRequest.create errors:", createRes.errors);
  }
  if (!createRes.data) throw new Error("BAC_REQUEST_CREATE_FAILED");

  return createRes.data;
};

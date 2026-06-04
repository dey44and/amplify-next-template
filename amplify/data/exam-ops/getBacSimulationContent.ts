import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["getAuthorizedBacSimulationContent"]["functionHandler"] = async (event) => {
  const owner = getIdentitySub(event);
  const { simulationId } = event.arguments;

  if (!simulationId) throw new Error("BAC_SIMULATION_REQUIRED");

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const isAdmin = isAdminEvent(event);

  if (!isAdmin) {
    const accessRes = await client.models.BacAccess.get({ owner, simulationId });
    if (!accessRes.data) throw new Error("BAC_ACCESS_REQUIRED");

    const startMs = simulation.startAt ? new Date(simulation.startAt).getTime() : Number.NaN;
    if (!Number.isFinite(startMs)) throw new Error("BAC_INVALID_WINDOW");
    if (Date.now() < startMs) throw new Error("BAC_NOT_STARTED");
  }

  const contentRes = await client.models.BacSimulationContent.get({ simulationId });
  const content = contentRes.data;

  return {
    simulationId,
    instructions: content?.instructions ?? null,
    promptText: content?.promptText ?? null,
  };
};

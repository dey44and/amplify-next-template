import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

function parseIsoMs(iso?: string | null) {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

function getPositiveMinutes(value: unknown, fallback?: unknown) {
  const minutes = Number(value ?? fallback ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : Number.NaN;
}

export const handler: Schema["getAuthorizedBacSimulationContent"]["functionHandler"] = async (event) => {
  const owner = getIdentitySub(event);
  const { simulationId } = event.arguments;

  if (!simulationId) throw new Error("BAC_SIMULATION_REQUIRED");

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const isAdmin = isAdminEvent(event);
  let startedAt: string | null = null;
  let deadlineAt: string | null = null;
  let accessWindowEndsAt: string | null = null;

  if (!isAdmin) {
    const accessRes = await client.models.BacAccess.get({ owner, simulationId });
    let access = accessRes.data;
    if (!access) throw new Error("BAC_ACCESS_REQUIRED");

    const startMs = parseIsoMs(simulation.startAt);
    const durationMinutes = getPositiveMinutes(simulation.durationMinutes);
    const accessWindowMinutes = getPositiveMinutes(
      simulation.accessWindowMinutes,
      simulation.durationMinutes
    );
    const accessWindowEndMs =
      Number.isFinite(startMs) && Number.isFinite(accessWindowMinutes)
        ? startMs + accessWindowMinutes * 60_000
        : Number.NaN;

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(durationMinutes) ||
      !Number.isFinite(accessWindowEndMs)
    ) {
      throw new Error("BAC_INVALID_WINDOW");
    }

    const nowMs = Date.now();
    if (nowMs < startMs) throw new Error("BAC_NOT_STARTED");

    accessWindowEndsAt = new Date(accessWindowEndMs).toISOString();

    let accessStartedMs = parseIsoMs(access.startedAt);
    let accessDeadlineMs = parseIsoMs(access.deadlineAt);

    if (!Number.isFinite(accessStartedMs)) {
      if (nowMs > accessWindowEndMs) throw new Error("BAC_START_WINDOW_CLOSED");

      accessStartedMs = Math.max(nowMs, startMs);
      accessDeadlineMs = accessStartedMs + durationMinutes * 60_000;

      const updateRes = await client.models.BacAccess.update({
        owner,
        simulationId,
        startedAt: new Date(accessStartedMs).toISOString(),
        deadlineAt: new Date(accessDeadlineMs).toISOString(),
      });
      access = updateRes.data ?? access;
    } else if (!Number.isFinite(accessDeadlineMs)) {
      accessDeadlineMs = accessStartedMs + durationMinutes * 60_000;
      const updateRes = await client.models.BacAccess.update({
        owner,
        simulationId,
        deadlineAt: new Date(accessDeadlineMs).toISOString(),
      });
      access = updateRes.data ?? access;
    }

    startedAt = access.startedAt ?? new Date(accessStartedMs).toISOString();
    deadlineAt = access.deadlineAt ?? new Date(accessDeadlineMs).toISOString();
  }

  const contentRes = await client.models.BacSimulationContent.get({ simulationId });
  const content = contentRes.data;

  return {
    simulationId,
    instructions: content?.instructions ?? null,
    promptText: content?.promptText ?? null,
    startedAt,
    deadlineAt,
    accessWindowEndsAt,
  };
};

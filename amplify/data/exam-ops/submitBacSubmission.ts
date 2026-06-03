import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentitySub } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const SUBMIT_GRACE_MS = 15 * 60_000;
const MAX_SOLUTION_BYTES = 25 * 1024 * 1024;

function parseIsoMs(iso?: string | null) {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

function cleanOptional(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function validateSolutionPath(args: {
  filePath: string;
  userId: string;
  simulationId: string;
}) {
  const { filePath, userId, simulationId } = args;
  const expectedUserSegment = `/${userId}/${simulationId}/`;

  if (!filePath.startsWith("bac-submissions/")) {
    throw new Error("BAC_INVALID_FILE_PATH");
  }

  if (!filePath.includes(expectedUserSegment)) {
    throw new Error("BAC_FILE_PATH_OWNER_MISMATCH");
  }
}

export const handler: Schema["submitBacSubmission"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const {
    simulationId,
    solutionFilePath,
    solutionOriginalName,
    solutionContentType,
    solutionSizeBytes,
    studentNote,
  } = event.arguments;

  const filePath = String(solutionFilePath ?? "").trim();
  if (!simulationId) throw new Error("BAC_SIMULATION_REQUIRED");
  if (!filePath) throw new Error("BAC_FILE_REQUIRED");

  validateSolutionPath({ filePath, userId, simulationId });

  const fileSize = Number(solutionSizeBytes ?? 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_SOLUTION_BYTES) {
    throw new Error("BAC_INVALID_FILE_SIZE");
  }

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const startMs = parseIsoMs(simulation.startAt);
  const durationMinutes = Number(simulation.durationMinutes ?? 0);
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(durationMinutes)
      ? startMs + durationMinutes * 60_000
      : Number.NaN;
  const nowMs = Date.now();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || durationMinutes <= 0) {
    throw new Error("BAC_INVALID_WINDOW");
  }
  if (nowMs < startMs) throw new Error("BAC_NOT_STARTED");
  if (nowMs > endMs + SUBMIT_GRACE_MS) throw new Error("BAC_ENDED");

  const existingEvaluationRes = await client.models.BacEvaluation.get({
    submissionOwner: userId,
    simulationId,
  });
  const existingEvaluation = existingEvaluationRes.data;
  if (existingEvaluation?.status === "GRADED") {
    throw new Error("BAC_ALREADY_GRADED");
  }

  const nowIso = new Date(nowMs).toISOString();
  const payload = {
    owner: userId,
    simulationId,
    submittedAt: nowIso,
    updatedAt: nowIso,
    solutionFilePath: filePath,
    solutionOriginalName: cleanOptional(solutionOriginalName, 180),
    solutionContentType: cleanOptional(solutionContentType, 120),
    solutionSizeBytes: Math.floor(fileSize),
    studentNote: cleanOptional(studentNote, 4000),
  };

  const existingSubmissionRes = await client.models.BacSubmission.get({
    owner: userId,
    simulationId,
  });

  const result = existingSubmissionRes.data
    ? await client.models.BacSubmission.update(payload)
    : await client.models.BacSubmission.create(payload);

  if (result.errors?.length) {
    console.error("BacSubmission save errors:", result.errors);
  }
  if (!result.data) throw new Error("BAC_SUBMISSION_SAVE_FAILED");

  return result.data;
};

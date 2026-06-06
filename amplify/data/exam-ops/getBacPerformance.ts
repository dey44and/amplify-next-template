import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getIdentitySub } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

type BacEvaluation = Schema["BacEvaluation"]["type"];
type BacSimulation = Schema["BacSimulation"]["type"];

const MIN_COHORT_SAMPLE = 5;

type UserBucketAcc = {
  sum: number;
  count: number;
};

function weekStartIso(value?: string | null) {
  const d = new Date(value ?? "");
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;

  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  const start = new Date(ms);
  start.setUTCDate(start.getUTCDate() - offset);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

function evaluationPercent(
  evaluation: Pick<BacEvaluation, "manualGrade" | "maxGrade">,
  simulation?: Pick<BacSimulation, "maxGrade"> | null
) {
  const grade = Number(evaluation.manualGrade);
  const max = Number(evaluation.maxGrade ?? simulation?.maxGrade ?? 0);
  if (!Number.isFinite(grade) || !Number.isFinite(max) || max <= 0) return null;

  const pct = (grade / max) * 100;
  if (!Number.isFinite(pct)) return null;

  return Math.max(0, Math.min(100, pct));
}

function pushUserAcc(map: Map<string, UserBucketAcc>, key: string, value: number) {
  const current = map.get(key) ?? { sum: 0, count: 0 };
  current.sum += value;
  current.count += 1;
  map.set(key, current);
}

function pushValue(map: Map<string, number[]>, key: string, value: number) {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
}

function median(sortedValues: number[]) {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[mid];
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

export const handler: Schema["getBacPerformance"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const subjectRaw = String(event.arguments?.subject ?? "").trim();
  const subject = subjectRaw || null;

  const [simulationsRes, evaluationsRes] = await Promise.all([
    client.models.BacSimulation.list({ limit: 2000 }),
    client.models.BacEvaluation.list({ limit: 2000 }),
  ]);

  if (simulationsRes.errors?.length) {
    console.error("BacSimulation.list errors:", simulationsRes.errors);
    throw new Error("FAILED_TO_LOAD_BAC_SIMULATIONS");
  }
  if (evaluationsRes.errors?.length) {
    console.error("BacEvaluation.list errors:", evaluationsRes.errors);
    throw new Error("FAILED_TO_LOAD_BAC_EVALUATIONS");
  }

  const simulations = (simulationsRes.data ?? []).filter(
    (simulation): simulation is NonNullable<typeof simulation> => !!simulation
  );
  const simulationById = new Map<string, BacSimulation>();
  for (const simulation of simulations) {
    simulationById.set(simulation.id, simulation);
  }

  const evaluations = (evaluationsRes.data ?? []).filter(
    (evaluation): evaluation is NonNullable<typeof evaluation> =>
      !!evaluation && evaluation.status === "GRADED"
  );

  const userMap = new Map<string, UserBucketAcc>();
  const cohortMap = new Map<string, number[]>();
  let userTotalCount = 0;
  let cohortTotalCount = 0;

  for (const evaluation of evaluations) {
    const simulationId = evaluation.simulationId;
    if (!simulationId) continue;

    const simulation = simulationById.get(simulationId);
    if (subject && String(simulation?.subject ?? "") !== subject) continue;

    const bucket = weekStartIso(simulation?.startAt ?? evaluation.gradedAt ?? evaluation.updatedAt);
    if (!bucket) continue;

    const pct = evaluationPercent(evaluation, simulation);
    if (pct == null) continue;

    if (evaluation.submissionOwner === userId) {
      pushUserAcc(userMap, bucket, pct);
      userTotalCount += 1;
      continue;
    }

    pushValue(cohortMap, bucket, pct);
    cohortTotalCount += 1;
  }

  const buckets = new Set<string>();
  for (const key of userMap.keys()) buckets.add(key);
  for (const key of cohortMap.keys()) buckets.add(key);

  const points = Array.from(buckets)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .map((bucketStart) => {
      const user = userMap.get(bucketStart);
      const cohort = (cohortMap.get(bucketStart) ?? []).slice().sort((a, b) => a - b);
      const cohortHasSample = cohort.length >= MIN_COHORT_SAMPLE;

      return {
        bucketStart,
        userAvgPercent: user ? user.sum / user.count : null,
        userCount: user?.count ?? 0,
        cohortMedianPercent: cohortHasSample ? median(cohort) : null,
        cohortMinPercent: cohortHasSample ? cohort[0] : null,
        cohortMaxPercent: cohortHasSample ? cohort[cohort.length - 1] : null,
        cohortCount: cohort.length,
      };
    });

  return {
    subject,
    userTotalCount,
    cohortTotalCount,
    minCohortSample: MIN_COHORT_SAMPLE,
    points,
  };
};

import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { getDataClientEnv } from "./_env";
import { getIdentitySub } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

type ExamAttempt = Schema["ExamAttempt"]["type"];

type BucketAcc = {
  sum: number;
  count: number;
};

function weekStartIso(value?: string | null) {
  const d = new Date(value ?? "");
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;

  // Monday-based week start in UTC.
  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  const start = new Date(ms);
  start.setUTCDate(start.getUTCDate() - offset);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

function attemptPercent(attempt: Pick<ExamAttempt, "score" | "maxScore">) {
  const score = Number(attempt.score ?? 0);
  const max = Number(attempt.maxScore ?? 0);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;

  const pct = (score / max) * 100;
  if (!Number.isFinite(pct)) return null;

  return Math.max(0, Math.min(100, pct));
}

function pushAcc(map: Map<string, BucketAcc>, key: string, value: number) {
  const current = map.get(key) ?? { sum: 0, count: 0 };
  current.sum += value;
  current.count += 1;
  map.set(key, current);
}

export const handler: Schema["getAdmissionPerformance"]["functionHandler"] = async (event) => {
  const userId = getIdentitySub(event);
  const admissionTypeRaw = String(event.arguments?.admissionType ?? "").trim();
  const admissionType = admissionTypeRaw || null;

  const attemptsRes = await client.models.ExamAttempt.list({
    limit: 2000,
  });

  if (attemptsRes.errors?.length) {
    console.error("ExamAttempt.list errors:", attemptsRes.errors);
    throw new Error("FAILED_TO_LOAD_ATTEMPTS");
  }

  const attempts = (attemptsRes.data ?? []).filter(
    (attempt): attempt is NonNullable<typeof attempt> => !!attempt
  );

  const filtered = attempts.filter((attempt) => {
    if (admissionType && String(attempt.admissionType ?? "") !== admissionType) return false;
    return true;
  });

  const userMap = new Map<string, BucketAcc>();
  const cohortMap = new Map<string, BucketAcc>();
  let userTotalCount = 0;
  let cohortTotalCount = 0;

  for (const attempt of filtered) {
    const bucket = weekStartIso(attempt.submittedAt);
    if (!bucket) continue;

    const pct = attemptPercent(attempt);
    if (pct == null) continue;

    if (attempt.userId === userId) {
      pushAcc(userMap, bucket, pct);
      userTotalCount += 1;
      continue;
    }

    pushAcc(cohortMap, bucket, pct);
    cohortTotalCount += 1;
  }

  const buckets = new Set<string>();
  for (const key of userMap.keys()) buckets.add(key);
  for (const key of cohortMap.keys()) buckets.add(key);

  const points = Array.from(buckets)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .map((bucketStart) => {
      const user = userMap.get(bucketStart);
      const cohort = cohortMap.get(bucketStart);

      return {
        bucketStart,
        userAvgPercent: user ? user.sum / user.count : null,
        userCount: user?.count ?? 0,
        cohortAvgPercent: cohort ? cohort.sum / cohort.count : null,
        cohortCount: cohort?.count ?? 0,
      };
    });

  return {
    admissionType,
    userTotalCount,
    cohortTotalCount,
    points,
  };
};

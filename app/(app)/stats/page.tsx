"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type ExamAttempt = Schema["ExamAttempt"]["type"];
type AdmissionPerformance = Schema["AdmissionPerformance"]["type"];
type PerformancePoint = Schema["PerformancePoint"]["type"];
type BacSimulation = Schema["BacSimulation"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];
type BacPerformance = Schema["BacPerformance"]["type"];
type BacPerformancePoint = Schema["BacPerformancePoint"]["type"];

type AdmissionPerformanceQueryResult = {
  data?: AdmissionPerformance | null;
  errors?: unknown[];
};

type BacPerformanceQueryResult = {
  data?: BacPerformance | null;
  errors?: unknown[];
};

type PlotPoint = {
  key: string;
  label: string;
  value: number;
  count: number;
};

type RangePlotPoint = {
  key: string;
  label: string;
  median: number;
  min: number;
  max: number;
  count: number;
};

type StatsMode = "ADMISSION" | "BAC";

const MIN_COHORT_SAMPLE = 5;

const GET_ADMISSION_PERFORMANCE_GQL = /* GraphQL */ `
  query GetAdmissionPerformance($admissionType: String) {
    getAdmissionPerformance(admissionType: $admissionType) {
      admissionType
      userTotalCount
      cohortTotalCount
      points {
        bucketStart
        userAvgPercent
        userCount
        cohortAvgPercent
        cohortCount
      }
    }
  }
`;

const GET_BAC_PERFORMANCE_GQL = /* GraphQL */ `
  query GetBacPerformance($subject: String) {
    getBacPerformance(subject: $subject) {
      subject
      userTotalCount
      cohortTotalCount
      minCohortSample
      points {
        bucketStart
        userAvgPercent
        userCount
        cohortMedianPercent
        cohortMinPercent
        cohortMaxPercent
        cohortCount
      }
    }
  }
`;

async function fetchAdmissionPerformance(
  admissionType?: string
): Promise<AdmissionPerformanceQueryResult> {
  const args = admissionType ? { admissionType } : {};

  const typedQueries = client.queries as
    | {
        getAdmissionPerformance?: (
          args?: { admissionType?: string }
        ) => Promise<AdmissionPerformanceQueryResult>;
      }
    | undefined;

  if (typeof typedQueries?.getAdmissionPerformance === "function") {
    return typedQueries.getAdmissionPerformance(args);
  }

  const clientWithGraphql = client as unknown as {
    graphql?: (args: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { getAdmissionPerformance?: AdmissionPerformance | null };
      errors?: unknown[];
    }>;
  };

  if (typeof clientWithGraphql.graphql !== "function") {
    return {
      errors: [
        new Error(
          "Admission performance query is unavailable in the runtime client."
        ),
      ],
    };
  }

  const raw = await clientWithGraphql.graphql({
    query: GET_ADMISSION_PERFORMANCE_GQL,
    variables: args,
  });

  return {
    data: raw.data?.getAdmissionPerformance ?? null,
    errors: raw.errors,
  };
}

async function fetchBacPerformance(subject?: string): Promise<BacPerformanceQueryResult> {
  const args = subject ? { subject } : {};

  const typedQueries = client.queries as
    | {
        getBacPerformance?: (
          args?: { subject?: string }
        ) => Promise<BacPerformanceQueryResult>;
      }
    | undefined;

  if (typeof typedQueries?.getBacPerformance === "function") {
    return typedQueries.getBacPerformance(args);
  }

  const clientWithGraphql = client as unknown as {
    graphql?: (args: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { getBacPerformance?: BacPerformance | null };
      errors?: unknown[];
    }>;
  };

  if (typeof clientWithGraphql.graphql !== "function") {
    return {
      errors: [
        new Error("Bac performance query is unavailable in the runtime client."),
      ],
    };
  }

  const raw = await clientWithGraphql.graphql({
    query: GET_BAC_PERFORMANCE_GQL,
    variables: args,
  });

  return {
    data: raw.data?.getBacPerformance ?? null,
    errors: raw.errors,
  };
}

function getExamStartMs(exam: Pick<Exam, "startAt">) {
  return toTimestamp(exam.startAt);
}

function getBacSimulationStartMs(simulation: Pick<BacSimulation, "startAt">) {
  return toTimestamp(simulation.startAt);
}

function getAttemptSubmittedAtMs(attempt: Pick<ExamAttempt, "submittedAt">) {
  return toTimestamp(attempt.submittedAt);
}

function getEvaluationDateMs(evaluation: Pick<BacEvaluation, "gradedAt" | "updatedAt">) {
  return toTimestamp(evaluation.gradedAt ?? evaluation.updatedAt);
}

function formatBucketLabel(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "";

  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
  });
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

function extractErrorMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.errorMessage === "string") return record.errorMessage;
  return "";
}

function bacEvaluationPercent(
  evaluation: Pick<BacEvaluation, "manualGrade" | "maxGrade">,
  simulation?: Pick<BacSimulation, "maxGrade"> | null
) {
  const grade = Number(evaluation.manualGrade);
  const max = Number(evaluation.maxGrade ?? simulation?.maxGrade ?? 0);
  if (!Number.isFinite(grade) || !Number.isFinite(max) || max <= 0) return null;
  const percent = (grade / max) * 100;
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function buildLinePath(coords: Array<{ x: number; y: number }>) {
  return coords
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
    .join(" ");
}

function TrendLinePlot({
  points,
  color,
  areaClassName,
  strokeClassName,
  emptyLabel,
}: {
  points: PlotPoint[];
  color: string;
  areaClassName: string;
  strokeClassName: string;
  emptyLabel: string;
}) {
  const width = 560;
  const height = 220;
  const padLeft = 38;
  const padRight = 22;
  const padY = 18;

  if (points.length === 0) {
    return <div className="plot-empty small">{emptyLabel}</div>;
  }

  const spanX = width - padLeft - padRight;
  const spanY = height - padY * 2;
  const denom = Math.max(1, points.length - 1);

  const coords = points.map((point, index) => {
    const x = padLeft + (index / denom) * spanX;
    const y = padY + ((100 - point.value) / 100) * spanY;
    return { ...point, x, y };
  });

  const linePath = buildLinePath(coords);
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(2)} ${(height - padY).toFixed(2)} L${first.x.toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  const axisLabels = [
    coords[0],
    coords[Math.floor(coords.length / 2)],
    coords[coords.length - 1],
  ].filter((coord, idx, arr) => arr.findIndex((x) => x.key === coord.key) === idx);

  return (
    <div className="plot-wrap">
      <svg className="plot-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafic evoluție">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padY + ((100 - tick) / 100) * spanY;
          return (
            <g key={tick}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} className="plot-grid-line" />
              <text x={6} y={y + 4} className="plot-grid-label">
                {tick}%
              </text>
            </g>
          );
        })}

        <path d={areaPath} className={areaClassName} />
        <path d={linePath} className={strokeClassName} />

        {coords.map((coord) => (
          <circle
            key={coord.key}
            cx={coord.x}
            cy={coord.y}
            r={3.5}
            fill={color}
            className="plot-point"
          />
        ))}
      </svg>

      <div className="plot-axis-row">
        {axisLabels.map((label) => (
          <span key={label.key}>{label.label}</span>
        ))}
      </div>
    </div>
  );
}

function RangeLinePlot({
  points,
  emptyLabel,
}: {
  points: RangePlotPoint[];
  emptyLabel: string;
}) {
  const width = 560;
  const height = 220;
  const padLeft = 38;
  const padRight = 22;
  const padY = 18;

  if (points.length === 0) {
    return <div className="plot-empty small">{emptyLabel}</div>;
  }

  const spanX = width - padLeft - padRight;
  const spanY = height - padY * 2;
  const denom = Math.max(1, points.length - 1);

  const coords = points.map((point, index) => {
    const x = padLeft + (index / denom) * spanX;
    const toY = (value: number) => padY + ((100 - value) / 100) * spanY;
    return {
      ...point,
      x,
      medianY: toY(point.median),
      minY: toY(point.min),
      maxY: toY(point.max),
    };
  });

  const medianPath = buildLinePath(coords.map((coord) => ({ x: coord.x, y: coord.medianY })));
  const minPath = buildLinePath(coords.map((coord) => ({ x: coord.x, y: coord.minY })));
  const maxPath = buildLinePath(coords.map((coord) => ({ x: coord.x, y: coord.maxY })));

  const axisLabels = [
    coords[0],
    coords[Math.floor(coords.length / 2)],
    coords[coords.length - 1],
  ].filter((coord, idx, arr) => arr.findIndex((x) => x.key === coord.key) === idx);

  return (
    <div className="plot-wrap">
      <svg className="plot-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafic grup Bac">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padY + ((100 - tick) / 100) * spanY;
          return (
            <g key={tick}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} className="plot-grid-line" />
              <text x={6} y={y + 4} className="plot-grid-label">
                {tick}%
              </text>
            </g>
          );
        })}

        <path d={maxPath} className="plot-line-max" />
        <path d={medianPath} className="plot-line-median" />
        <path d={minPath} className="plot-line-min" />

        {coords.map((coord) => (
          <g key={coord.key}>
            <circle cx={coord.x} cy={coord.maxY} r={3} className="plot-point-max" />
            <circle cx={coord.x} cy={coord.medianY} r={3.5} className="plot-point-median" />
            <circle cx={coord.x} cy={coord.minY} r={3} className="plot-point-min" />
          </g>
        ))}
      </svg>

      <div className="plot-axis-row">
        {axisLabels.map((label) => (
          <span key={label.key}>{label.label}</span>
        ))}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<StatsMode>("ADMISSION");

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [bacSimulations, setBacSimulations] = useState<BacSimulation[]>([]);
  const [bacEvaluations, setBacEvaluations] = useState<BacEvaluation[]>([]);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  const [selectedAdmissionType, setSelectedAdmissionType] = useState("ALL");
  const [selectedBacSubject, setSelectedBacSubject] = useState("ALL");
  const [trendRefreshKey, setTrendRefreshKey] = useState(0);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [admissionTrendData, setAdmissionTrendData] =
    useState<AdmissionPerformance | null>(null);
  const [bacTrendData, setBacTrendData] = useState<BacPerformance | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId;
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

      const canLoadBac = hasBacModels(client.models);
      setBacBackendAvailable(canLoadBac);

      const [examsRes, attemptsRes, bacSimulationsRes, bacEvaluationsRes] =
        await Promise.all([
          client.models.MockExam.list({ limit: 500 }),
          client.models.ExamAttempt.list({
            filter: { userId: { eq: userId } },
            limit: 500,
          }),
          canLoadBac
            ? client.models.BacSimulation.list({ limit: 500 })
            : Promise.resolve({ data: [], errors: undefined }),
          canLoadBac
            ? client.models.BacEvaluation.list({
                filter: { submissionOwner: { eq: userId } },
                limit: 500,
              })
            : Promise.resolve({ data: [], errors: undefined }),
        ]);
      if (cancelled) return;

      if (examsRes.errors?.length) console.error(examsRes.errors);
      setExams((examsRes.data ?? []).filter(notNull));

      if (attemptsRes.errors?.length) console.error(attemptsRes.errors);
      setAttempts((attemptsRes.data ?? []).filter(notNull));

      if (bacSimulationsRes.errors?.length) console.error(bacSimulationsRes.errors);
      setBacSimulations((bacSimulationsRes.data ?? []).filter(notNull));

      if (bacEvaluationsRes.errors?.length) console.error(bacEvaluationsRes.errors);
      setBacEvaluations((bacEvaluationsRes.data ?? []).filter(notNull));

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const admissionTypeOptions = useMemo(() => {
    const set = new Set<string>();

    for (const exam of exams) {
      const type = String(exam.admissionType ?? "").trim();
      if (type) set.add(type);
    }

    for (const attempt of attempts) {
      const type = String(attempt.admissionType ?? "").trim();
      if (type) set.add(type);
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b, "ro"));
  }, [attempts, exams]);

  const bacSubjectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const simulation of bacSimulations) {
      const subject = String(simulation.subject ?? "").trim();
      if (subject) set.add(subject);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ro"));
  }, [bacSimulations]);

  useEffect(() => {
    if (selectedAdmissionType === "ALL") return;
    if (!admissionTypeOptions.includes(selectedAdmissionType)) {
      setSelectedAdmissionType("ALL");
    }
  }, [admissionTypeOptions, selectedAdmissionType]);

  useEffect(() => {
    if (selectedBacSubject === "ALL") return;
    if (!bacSubjectOptions.includes(selectedBacSubject)) {
      setSelectedBacSubject("ALL");
    }
  }, [bacSubjectOptions, selectedBacSubject]);

  const selectedAdmissionTypeValue =
    selectedAdmissionType === "ALL" ? undefined : selectedAdmissionType;
  const selectedBacSubjectValue =
    selectedBacSubject === "ALL" ? undefined : selectedBacSubject;

  useEffect(() => {
    if (loading) return;
    if (mode !== "ADMISSION") return;

    let cancelled = false;

    (async () => {
      setTrendLoading(true);
      setTrendError(null);

      const res = await fetchAdmissionPerformance(selectedAdmissionTypeValue);
      if (cancelled) return;

      if (res.errors?.length) {
        console.error(res.errors);
        const firstMessage = extractErrorMessage(res.errors[0]);
        if (
          firstMessage.includes(
            "Admission performance query is unavailable in the runtime client."
          )
        ) {
          setTrendError(
            "Configurația locală Amplify nu este sincronizată. Regenerază `amplify_outputs.json` și repornește aplicația."
          );
        } else {
          setTrendError("Nu am putut încărca comparația de performanță.");
        }
        setAdmissionTrendData(null);
        setTrendLoading(false);
        return;
      }

      setAdmissionTrendData(res.data ?? null);
      setTrendLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) {
        setTrendError("Nu am putut încărca comparația de performanță.");
        setAdmissionTrendData(null);
        setTrendLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loading, mode, selectedAdmissionTypeValue, trendRefreshKey]);

  useEffect(() => {
    if (loading) return;
    if (mode !== "BAC") return;

    if (!bacBackendAvailable) {
      setBacTrendData(null);
      setTrendError("Simulările Bac nu sunt disponibile momentan în configurația locală.");
      setTrendLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setTrendLoading(true);
      setTrendError(null);

      const res = await fetchBacPerformance(selectedBacSubjectValue);
      if (cancelled) return;

      if (res.errors?.length) {
        console.error(res.errors);
        const firstMessage = extractErrorMessage(res.errors[0]);
        if (
          firstMessage.includes("Bac performance query is unavailable in the runtime client.")
        ) {
          setTrendError(
            "Configurația locală Amplify nu este sincronizată. Regenerază `amplify_outputs.json` și repornește aplicația."
          );
        } else {
          setTrendError("Nu am putut încărca statisticile Bac.");
        }
        setBacTrendData(null);
        setTrendLoading(false);
        return;
      }

      setBacTrendData(res.data ?? null);
      setTrendLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) {
        setTrendError("Nu am putut încărca statisticile Bac.");
        setBacTrendData(null);
        setTrendLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bacBackendAvailable, loading, mode, selectedBacSubjectValue, trendRefreshKey]);

  const attemptsByExamId = useMemo(() => {
    const m = new Map<string, ExamAttempt[]>();

    for (const a of attempts) {
      const examId = a.examId;
      if (!examId) continue;
      const arr = m.get(examId) ?? [];
      arr.push(a);
      m.set(examId, arr);
    }

    m.forEach((arr, k) => {
      arr.sort((x: ExamAttempt, y: ExamAttempt) => {
        const ax = getAttemptSubmittedAtMs(x);
        const ay = getAttemptSubmittedAtMs(y);
        return ay - ax;
      });
      m.set(k, arr);
    });

    return m;
  }, [attempts]);

  const bacSimulationById = useMemo(() => {
    const map = new Map<string, BacSimulation>();
    for (const simulation of bacSimulations) {
      map.set(simulation.id, simulation);
    }
    return map;
  }, [bacSimulations]);

  const bacEvaluationBySimulationId = useMemo(() => {
    const map = new Map<string, BacEvaluation>();
    const sorted = bacEvaluations
      .filter((evaluation) => evaluation.status === "GRADED")
      .slice()
      .sort((a, b) => getEvaluationDateMs(b) - getEvaluationDateMs(a));

    for (const evaluation of sorted) {
      const simulationId = evaluation.simulationId;
      if (!simulationId || map.has(simulationId)) continue;
      map.set(simulationId, evaluation);
    }
    return map;
  }, [bacEvaluations]);

  const examsSortedByStartDesc = useMemo(() => {
    return exams
      .slice()
      .sort((a: Exam, b: Exam) => getExamStartMs(b) - getExamStartMs(a));
  }, [exams]);

  const bacSimulationsSortedByStartDesc = useMemo(() => {
    return bacSimulations
      .slice()
      .sort(
        (a: BacSimulation, b: BacSimulation) =>
          getBacSimulationStartMs(b) - getBacSimulationStartMs(a)
      );
  }, [bacSimulations]);

  const latestAttempts = useMemo(() => {
    return Array.from(attemptsByExamId.values())
      .map((arr) => arr[0] ?? null)
      .filter(notNull);
  }, [attemptsByExamId]);

  const gradedBacEvaluations = useMemo(
    () => bacEvaluations.filter((evaluation) => evaluation.status === "GRADED"),
    [bacEvaluations]
  );

  const attemptedExamsCount = latestAttempts.length;
  const availableExamsLabel =
    exams.length === 1 ? "simulare disponibilă" : "simulări disponibile";

  const averageAdmissionPercent = useMemo(() => {
    if (latestAttempts.length === 0) return 0;
    const values = latestAttempts
      .map((attempt) => {
        const score = Number(attempt.score ?? 0);
        const max = Number(attempt.maxScore ?? 0);
        if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
        return (score / max) * 100;
      })
      .filter((value): value is number => value != null && Number.isFinite(value));

    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [latestAttempts]);

  const averageBacPercent = useMemo(() => {
    if (gradedBacEvaluations.length === 0) return 0;
    const values = gradedBacEvaluations
      .map((evaluation) =>
        bacEvaluationPercent(evaluation, bacSimulationById.get(evaluation.simulationId))
      )
      .filter((value): value is number => value != null && Number.isFinite(value));

    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [bacSimulationById, gradedBacEvaluations]);

  const admissionTrendPoints = useMemo(() => {
    const points = Array.isArray(admissionTrendData?.points)
      ? admissionTrendData.points.filter((point): point is PerformancePoint => !!point)
      : [];

    return points
      .slice()
      .sort((a, b) => toTimestamp(a.bucketStart) - toTimestamp(b.bucketStart));
  }, [admissionTrendData?.points]);

  const bacTrendPoints = useMemo(() => {
    const points = Array.isArray(bacTrendData?.points)
      ? bacTrendData.points.filter((point): point is BacPerformancePoint => !!point)
      : [];

    return points
      .slice()
      .sort((a, b) => toTimestamp(a.bucketStart) - toTimestamp(b.bucketStart));
  }, [bacTrendData?.points]);

  const admissionUserSeries = useMemo(() => {
    return admissionTrendPoints
      .filter(
        (point) =>
          Number.isFinite(Number(point.userAvgPercent)) && Number(point.userCount ?? 0) > 0
      )
      .map((point) => ({
        key: String(point.bucketStart ?? ""),
        label: formatBucketLabel(point.bucketStart),
        value: Number(point.userAvgPercent),
        count: Number(point.userCount ?? 0),
      }));
  }, [admissionTrendPoints]);

  const admissionCohortSeries = useMemo(() => {
    return admissionTrendPoints
      .filter(
        (point) =>
          Number.isFinite(Number(point.cohortAvgPercent)) &&
          Number(point.cohortCount ?? 0) >= MIN_COHORT_SAMPLE
      )
      .map((point) => ({
        key: String(point.bucketStart ?? ""),
        label: formatBucketLabel(point.bucketStart),
        value: Number(point.cohortAvgPercent),
        count: Number(point.cohortCount ?? 0),
      }));
  }, [admissionTrendPoints]);

  const bacUserSeries = useMemo(() => {
    return bacTrendPoints
      .filter(
        (point) =>
          Number.isFinite(Number(point.userAvgPercent)) && Number(point.userCount ?? 0) > 0
      )
      .map((point) => ({
        key: String(point.bucketStart ?? ""),
        label: formatBucketLabel(point.bucketStart),
        value: Number(point.userAvgPercent),
        count: Number(point.userCount ?? 0),
      }));
  }, [bacTrendPoints]);

  const bacCohortRangeSeries = useMemo(() => {
    return bacTrendPoints
      .filter(
        (point) =>
          Number(point.cohortCount ?? 0) >=
            Number(bacTrendData?.minCohortSample ?? MIN_COHORT_SAMPLE) &&
          Number.isFinite(Number(point.cohortMedianPercent)) &&
          Number.isFinite(Number(point.cohortMinPercent)) &&
          Number.isFinite(Number(point.cohortMaxPercent))
      )
      .map((point) => ({
        key: String(point.bucketStart ?? ""),
        label: formatBucketLabel(point.bucketStart),
        median: Number(point.cohortMedianPercent),
        min: Number(point.cohortMinPercent),
        max: Number(point.cohortMaxPercent),
        count: Number(point.cohortCount ?? 0),
      }));
  }, [bacTrendData?.minCohortSample, bacTrendPoints]);

  const admissionHasSmallCohortBuckets = useMemo(() => {
    return admissionTrendPoints.some((point) => {
      const count = Number(point.cohortCount ?? 0);
      return count > 0 && count < MIN_COHORT_SAMPLE;
    });
  }, [admissionTrendPoints]);

  const bacHasSmallCohortBuckets = useMemo(() => {
    return bacTrendPoints.some((point) => {
      const count = Number(point.cohortCount ?? 0);
      return count > 0 && count < Number(bacTrendData?.minCohortSample ?? MIN_COHORT_SAMPLE);
    });
  }, [bacTrendData?.minCohortSample, bacTrendPoints]);

  const isAdmissionMode = mode === "ADMISSION";

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă statisticile…</p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div>
                <div className="page-title">Statisticile mele</div>
                <div className="page-subtitle" style={{ marginTop: 6 }}>
                  Urmărește separat simulările de admitere și simulările de bacalaureat.
                </div>
              </div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Înapoi la panou
                </OutlineButton>
              </div>
            </div>

            <Card>
              <div className="stats-mode-switch" aria-label="Tip statistici">
                <button
                  type="button"
                  className={`stats-mode-button${mode === "ADMISSION" ? " is-active" : ""}`}
                  onClick={() => setMode("ADMISSION")}
                >
                  Admitere
                </button>
                <button
                  type="button"
                  className={`stats-mode-button${mode === "BAC" ? " is-active" : ""}`}
                  onClick={() => setMode("BAC")}
                  disabled={!bacBackendAvailable}
                  title={
                    bacBackendAvailable
                      ? undefined
                      : "Simulările Bac nu sunt disponibile în configurația locală."
                  }
                >
                  Bacalaureat
                </button>
              </div>
            </Card>

            <Card>
              <div className="section-title">
                {isAdmissionMode ? "Rezumat progres" : "Rezumat Bac"}
              </div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                {isAdmissionMode
                  ? "O privire rapidă asupra celor mai recente încercări."
                  : "O privire rapidă asupra simulărilor de bacalaureat evaluate."}
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-blue">
                  <div className="metric-label">
                    {isAdmissionMode ? "Simulări încercate" : "Simulări evaluate"}
                  </div>
                  <div className="metric-value">
                    {isAdmissionMode ? attemptedExamsCount : gradedBacEvaluations.length}
                  </div>
                  <div className="metric-helper">
                    {isAdmissionMode
                      ? `Din ${exams.length} ${availableExamsLabel}`
                      : `Din ${bacSimulations.length} simulări Bac disponibile`}
                  </div>
                </div>

                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Scor mediu</div>
                  <div className="metric-value">
                    {isAdmissionMode ? averageAdmissionPercent : averageBacPercent}%
                  </div>
                  <div className="metric-helper">
                    {isAdmissionMode
                      ? "Bazat pe ultima încercare pentru fiecare simulare"
                      : "Bazat pe notele manuale publicate"}
                  </div>
                </div>

                <div className="metric-tile soft-mint">
                  <div className="metric-label">Rezultate disponibile</div>
                  <div className="metric-value">
                    {isAdmissionMode ? attemptedExamsCount : gradedBacEvaluations.length}
                  </div>
                  <div className="metric-helper">
                    {isAdmissionMode
                      ? "Le poți deschide imediat în lista de mai jos"
                      : "Apar după evaluarea administratorului"}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="stats-compare-head">
                <div>
                  <div className="section-title">
                    {isAdmissionMode ? "Evoluție comparativă" : "Evoluție Bac"}
                  </div>
                  <div className="page-subtitle" style={{ marginTop: 6 }}>
                    {isAdmissionMode
                      ? "Compară evoluția ta cu media altor elevi pe același tip de admitere."
                      : "Compară evoluția ta cu mediană, minimul și maximul grupului pentru simulările Bac."}
                  </div>
                </div>

                {isAdmissionMode ? (
                  <div className="stats-filter-box">
                    <label htmlFor="admission-filter" className="small">
                      Tip admitere
                    </label>
                    <select
                      id="admission-filter"
                      className="stats-select"
                      value={selectedAdmissionType}
                      onChange={(e) => setSelectedAdmissionType(e.target.value)}
                    >
                      <option value="ALL">Toate tipurile</option>
                      {admissionTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="stats-filter-box">
                    <label htmlFor="bac-subject-filter" className="small">
                      Materie Bac
                    </label>
                    <select
                      id="bac-subject-filter"
                      className="stats-select"
                      value={selectedBacSubject}
                      onChange={(e) => setSelectedBacSubject(e.target.value)}
                      disabled={!bacBackendAvailable}
                    >
                      <option value="ALL">Toate materiile</option>
                      {bacSubjectOptions.map((subject) => (
                        <option key={subject} value={subject}>
                          {subject}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {trendLoading ? (
                <p className="small" style={{ marginTop: 14, marginBottom: 0 }}>
                  Se încarcă graficele…
                </p>
              ) : trendError ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <p className="small" style={{ margin: 0 }}>
                    {trendError}
                  </p>
                  <div>
                    <OutlineButton onClick={() => setTrendRefreshKey((x) => x + 1)}>
                      Reîncarcă comparația
                    </OutlineButton>
                  </div>
                </div>
              ) : isAdmissionMode ? (
                <>
                  <div className="stats-plots-grid">
                    <div className="stats-plot-panel">
                      <div className="stats-plot-head">
                        <div className="section-title">Evoluția ta</div>
                        <div className="small">Scor mediu săptămânal (%)</div>
                      </div>

                      <TrendLinePlot
                        points={admissionUserSeries}
                        color="#2f67ff"
                        areaClassName="plot-area-user"
                        strokeClassName="plot-line-user"
                        emptyLabel="Nu există suficiente încercări pentru a afișa evoluția ta."
                      />
                    </div>

                    <div className="stats-plot-panel">
                      <div className="stats-plot-head">
                        <div className="section-title">Media grupului</div>
                        <div className="small">
                          Elevi diferiți de tine, filtrați după tipul selectat
                        </div>
                      </div>

                      <TrendLinePlot
                        points={admissionCohortSeries}
                        color="#20a47d"
                        areaClassName="plot-area-cohort"
                        strokeClassName="plot-line-cohort"
                        emptyLabel={`Nu există suficiente date de grup (minim ${MIN_COHORT_SAMPLE} încercări pe interval).`}
                      />
                    </div>
                  </div>

                  {admissionHasSmallCohortBuckets && (
                    <div className="small" style={{ marginTop: 10 }}>
                      Unele intervale au fost ascunse din graficul grupului deoarece au mai puțin de {MIN_COHORT_SAMPLE} încercări.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="stats-plots-grid">
                    <div className="stats-plot-panel">
                      <div className="stats-plot-head">
                        <div className="section-title">Rezultatele tale</div>
                        <div className="small">Punctaj mediu săptămânal (%)</div>
                      </div>

                      <TrendLinePlot
                        points={bacUserSeries}
                        color="#2f67ff"
                        areaClassName="plot-area-user"
                        strokeClassName="plot-line-user"
                        emptyLabel="Nu există încă simulări Bac evaluate pentru a afișa evoluția ta."
                      />
                    </div>

                    <div className="stats-plot-panel">
                      <div className="stats-plot-head">
                        <div className="section-title">Grup Bac</div>
                        <div className="small">
                          Mediană, minim și maxim pentru elevi diferiți de tine
                        </div>
                        <div className="plot-range-legend" aria-hidden="true">
                          <span className="legend-median">Mediană</span>
                          <span className="legend-max">Maxim</span>
                          <span className="legend-min">Minim</span>
                        </div>
                      </div>

                      <RangeLinePlot
                        points={bacCohortRangeSeries}
                        emptyLabel={`Nu există suficiente date de grup (minim ${
                          bacTrendData?.minCohortSample ?? MIN_COHORT_SAMPLE
                        } evaluări pe interval).`}
                      />
                    </div>
                  </div>

                  {bacHasSmallCohortBuckets && (
                    <div className="small" style={{ marginTop: 10 }}>
                      Unele intervale au fost ascunse din graficul Bac deoarece au mai puțin de{" "}
                      {bacTrendData?.minCohortSample ?? MIN_COHORT_SAMPLE} evaluări.
                    </div>
                  )}
                </>
              )}
            </Card>

            <Card>
              <div className="section-title">
                {isAdmissionMode ? "Rezultate pe simulare" : "Rezultate Bac"}
              </div>

              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                {isAdmissionMode
                  ? "Rezultatele apar imediat după trimitere."
                  : "Rezultatele Bac apar după evaluarea manuală a lucrării."}
              </div>

              <div className="exam-list">
                {isAdmissionMode ? (
                  exams.length === 0 ? (
                    <p className="small" style={{ margin: 0 }}>
                      Nu există simulări disponibile.
                    </p>
                  ) : (
                    examsSortedByStartDesc.map((e) => {
                      const examAttempts = attemptsByExamId.get(e.id) ?? [];
                      const latest = examAttempts[0] ?? null;

                      return (
                        <div key={e.id} className="exam-item">
                          <div className="exam-item-title">{e.title}</div>
                          <div className="small">Tip admitere: {e.admissionType}</div>

                          <div className="small" style={{ opacity: 0.85 }}>
                            Începe: {formatWhen(e.startAt)} • Durată: {e.durationMinutes ?? "—"} min
                          </div>

                          {latest ? (
                            <div className="small" style={{ opacity: 0.85 }}>
                              Trimis: {formatWhen(latest.submittedAt)} • Scor: {latest.score} /{" "}
                              {latest.maxScore}
                            </div>
                          ) : (
                            <div className="small" style={{ opacity: 0.85 }}>
                              Fără încercări încă.
                            </div>
                          )}

                          <div className="exam-actions">
                            {latest && (
                              <OutlineButton
                                onClick={() => router.push(`/exam/review/${latest.id}`)}
                              >
                                Vezi rezultatele
                              </OutlineButton>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )
                ) : !bacBackendAvailable ? (
                  <p className="small" style={{ margin: 0 }}>
                    Simulările Bac nu sunt disponibile momentan.
                  </p>
                ) : bacSimulations.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări Bac disponibile.
                  </p>
                ) : (
                  bacSimulationsSortedByStartDesc.map((simulation) => {
                    const evaluation = bacEvaluationBySimulationId.get(simulation.id);
                    const percent = evaluation
                      ? bacEvaluationPercent(evaluation, simulation)
                      : null;

                    return (
                      <div key={simulation.id} className="exam-item">
                        <div className="exam-item-title">{simulation.title}</div>
                        <div className="small">Materie: {simulation.subject}</div>

                        <div className="small" style={{ opacity: 0.85 }}>
                          Începe: {formatWhen(simulation.startAt)} • Durată:{" "}
                          {simulation.durationMinutes ?? "—"} min
                        </div>

                        {evaluation ? (
                          <div className="small" style={{ opacity: 0.85 }}>
                            Evaluat: {formatWhen(evaluation.gradedAt ?? evaluation.updatedAt)} •
                            Punctaj: {evaluation.manualGrade} /{" "}
                            {evaluation.maxGrade ?? simulation.maxGrade ?? "—"}
                            {percent == null ? "" : ` (${formatPercent(percent)})`}
                          </div>
                        ) : (
                          <div className="small" style={{ opacity: 0.85 }}>
                            Fără evaluare publicată încă.
                          </div>
                        )}

                        <div className="exam-actions">
                          <OutlineButton onClick={() => router.push(`/bac/${simulation.id}`)}>
                            Deschide simularea
                          </OutlineButton>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        )}
      </PageShell>
    </>
  );
}

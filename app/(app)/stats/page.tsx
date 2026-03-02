"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
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
type AdmissionPerformanceQueryResult = {
  data?: AdmissionPerformance | null;
  errors?: unknown[];
};

type PlotPoint = {
  key: string;
  label: string;
  value: number;
  count: number;
};

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

async function fetchAdmissionPerformance(admissionType?: string): Promise<AdmissionPerformanceQueryResult> {
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

function getExamStartMs(exam: Pick<Exam, "startAt">) {
  return toTimestamp(exam.startAt);
}

function getAttemptSubmittedAtMs(attempt: Pick<ExamAttempt, "submittedAt">) {
  return toTimestamp(attempt.submittedAt);
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

  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
    .join(" ");

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

export default function StatsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);

  const [selectedAdmissionType, setSelectedAdmissionType] = useState("ALL");
  const [trendRefreshKey, setTrendRefreshKey] = useState(0);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<AdmissionPerformance | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      // auth gate
      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId;
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

      const [examsRes, attemptsRes] = await Promise.all([
        client.models.MockExam.list({ limit: 500 }),
        client.models.ExamAttempt.list({
          filter: { userId: { eq: userId } },
          limit: 500,
        }),
      ]);
      if (cancelled) return;

      if (examsRes.errors?.length) console.error(examsRes.errors);
      setExams((examsRes.data ?? []).filter(notNull));

      if (attemptsRes.errors?.length) console.error(attemptsRes.errors);
      setAttempts((attemptsRes.data ?? []).filter(notNull));

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

  useEffect(() => {
    if (selectedAdmissionType === "ALL") return;
    if (!admissionTypeOptions.includes(selectedAdmissionType)) {
      setSelectedAdmissionType("ALL");
    }
  }, [admissionTypeOptions, selectedAdmissionType]);

  const selectedAdmissionTypeValue =
    selectedAdmissionType === "ALL" ? undefined : selectedAdmissionType;

  useEffect(() => {
    if (loading) return;

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
        setTrendData(null);
        setTrendLoading(false);
        return;
      }

      setTrendData(res.data ?? null);
      setTrendLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) {
        setTrendError("Nu am putut încărca comparația de performanță.");
        setTrendData(null);
        setTrendLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loading, selectedAdmissionTypeValue, trendRefreshKey]);

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

  const examsSortedByStartDesc = useMemo(() => {
    return exams
      .slice()
      .sort((a: Exam, b: Exam) => getExamStartMs(b) - getExamStartMs(a));
  }, [exams]);

  const latestAttempts = useMemo(() => {
    return Array.from(attemptsByExamId.values())
      .map((arr) => arr[0] ?? null)
      .filter(notNull);
  }, [attemptsByExamId]);

  const attemptedExamsCount = latestAttempts.length;
  const availableExamsLabel =
    exams.length === 1 ? "simulare disponibilă" : "simulări disponibile";

  const averagePercent = useMemo(() => {
    if (latestAttempts.length === 0) return 0;
    const total = latestAttempts.reduce((sum, attempt) => {
      const score = Number(attempt.score ?? 0);
      const max = Number(attempt.maxScore ?? 0);
      if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return sum;
      return sum + (score / max) * 100;
    }, 0);
    return Math.round(total / latestAttempts.length);
  }, [latestAttempts]);

  const trendPoints = useMemo(() => {
    const points = Array.isArray(trendData?.points)
      ? trendData.points.filter((point): point is PerformancePoint => !!point)
      : [];

    return points
      .slice()
      .sort((a, b) => toTimestamp(a.bucketStart) - toTimestamp(b.bucketStart));
  }, [trendData?.points]);

  const userSeries = useMemo(() => {
    return trendPoints
      .filter((point) => Number.isFinite(Number(point.userAvgPercent)) && Number(point.userCount ?? 0) > 0)
      .map((point) => ({
        key: String(point.bucketStart ?? ""),
        label: formatBucketLabel(point.bucketStart),
        value: Number(point.userAvgPercent),
        count: Number(point.userCount ?? 0),
      }));
  }, [trendPoints]);

  const cohortSeries = useMemo(() => {
    return trendPoints
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
  }, [trendPoints]);

  const latestUser = useMemo(() => {
    if (userSeries.length === 0) return null;
    return userSeries[userSeries.length - 1].value;
  }, [userSeries]);

  const latestCohort = useMemo(() => {
    if (cohortSeries.length === 0) return null;
    return cohortSeries[cohortSeries.length - 1].value;
  }, [cohortSeries]);

  const latestGap = useMemo(() => {
    if (latestUser == null || latestCohort == null) return null;
    return latestUser - latestCohort;
  }, [latestCohort, latestUser]);

  const hasSmallCohortBuckets = useMemo(() => {
    return trendPoints.some((point) => {
      const count = Number(point.cohortCount ?? 0);
      return count > 0 && count < MIN_COHORT_SAMPLE;
    });
  }, [trendPoints]);

  const cohortTotalCount = Number(trendData?.cohortTotalCount ?? 0);
  const userTotalCount = Number(trendData?.userTotalCount ?? 0);
  const gapPrefix = latestGap != null && latestGap > 0 ? "+" : "";

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă statisticile…</p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">Statisticile mele</div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Înapoi la panou
                </OutlineButton>
              </div>
            </div>

            <Card>
              <div className="section-title">Rezumat progres</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                O privire rapidă asupra celor mai recente încercări.
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-blue">
                  <div className="metric-label">Simulări încercate</div>
                  <div className="metric-value">{attemptedExamsCount}</div>
                  <div className="metric-helper">Din {exams.length} {availableExamsLabel}</div>
                </div>

                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Scor mediu</div>
                  <div className="metric-value">{averagePercent}%</div>
                  <div className="metric-helper">Bazat pe ultima încercare pentru fiecare simulare</div>
                </div>

                <div className="metric-tile soft-mint">
                  <div className="metric-label">Rezultate disponibile</div>
                  <div className="metric-value">{attemptedExamsCount}</div>
                  <div className="metric-helper">Le poți deschide imediat în lista de mai jos</div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="stats-compare-head">
                <div>
                  <div className="section-title">Evoluție comparativă</div>
                  <div className="page-subtitle" style={{ marginTop: 6 }}>
                    Compară evoluția ta cu media altor elevi pe același tip de admitere.
                  </div>
                </div>

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
              ) : (
                <>
                  <div className="stats-plots-grid">
                    <div className="stats-plot-panel">
                      <div className="stats-plot-head">
                        <div className="section-title">Evoluția ta</div>
                        <div className="small">Scor mediu săptămânal (%)</div>
                      </div>

                      <TrendLinePlot
                        points={userSeries}
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
                        points={cohortSeries}
                        color="#20a47d"
                        areaClassName="plot-area-cohort"
                        strokeClassName="plot-line-cohort"
                        emptyLabel={`Nu există suficiente date de grup (minim ${MIN_COHORT_SAMPLE} încercări pe interval).`}
                      />
                    </div>
                  </div>

                  <div className="stats-compare-kpis">
                    <div className="stats-kpi-pill">
                      <span>Ultimul tău punct</span>
                      <strong>{formatPercent(latestUser)}</strong>
                    </div>

                    <div className="stats-kpi-pill">
                      <span>Ultima medie a grupului</span>
                      <strong>{formatPercent(latestCohort)}</strong>
                    </div>

                    <div className="stats-kpi-pill">
                      <span>Diferență față de grup</span>
                      <strong>
                        {latestGap == null
                          ? "—"
                          : `${gapPrefix}${Math.round(latestGap)} pp`}
                      </strong>
                    </div>

                    <div className="stats-kpi-pill">
                      <span>Eșantion</span>
                      <strong>
                        Tu: {userTotalCount} • Grup: {cohortTotalCount}
                      </strong>
                    </div>
                  </div>

                  {hasSmallCohortBuckets && (
                    <div className="small" style={{ marginTop: 10 }}>
                      Unele intervale au fost ascunse din graficul grupului deoarece au mai puțin de {MIN_COHORT_SAMPLE} încercări.
                    </div>
                  )}
                </>
              )}
            </Card>

            <Card>
              <div className="section-title">Rezultate pe simulare</div>

              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                Rezultatele apar imediat după trimitere.
              </div>

              <div className="exam-list">
                {exams.length === 0 ? (
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
                          {latest &&
                            (
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
                )}
              </div>
            </Card>
          </div>
        )}
      </PageShell>
    </>
  );
}

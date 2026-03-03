"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type ArchiveProblem = Schema["ArchiveProblem"]["type"];
type AdaptiveRecommendation = Schema["AdaptiveRecommendation"]["type"];
type PracticeSubmissionResult = Schema["PracticeSubmissionResult"]["type"];
type ArchiveExamGroup = { key: string; examTitle: string; problems: ArchiveProblem[] };

type QueryResult<T> = { data?: T | null; errors?: unknown[] };

type ArchiveListResult = { data?: ArchiveProblem[] | null; errors?: unknown[] };

const LIST_ARCHIVE_PROBLEMS_GQL = /* GraphQL */ `
  query ListArchiveProblems {
    listArchiveProblems {
      taskId
      examId
      examTitle
      order
      question
      mark
      topic
    }
  }
`;

const RECOMMEND_ADAPTIVE_TASK_GQL = /* GraphQL */ `
  query RecommendAdaptiveTask($topic: String, $minProb: Float, $maxProb: Float) {
    recommendAdaptiveTask(topic: $topic, minProb: $minProb, maxProb: $maxProb) {
      status
      reason
      taskId
      examId
      examTitle
      question
      topic
      expectedCorrectProb
      studentTopicRating
    }
  }
`;

const SUBMIT_PRACTICE_ANSWER_GQL = /* GraphQL */ `
  mutation SubmitPracticeAnswer($taskId: ID!, $answer: String!) {
    submitPracticeAnswer(taskId: $taskId, answer: $answer) {
      taskId
      topic
      isCorrect
      correctAnswer
      expectedCorrectProb
      studentTopicRatingBefore
      studentTopicRatingAfter
    }
  }
`;

function formatPercent(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatRating(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}`;
}

async function listArchiveProblems(): Promise<ArchiveListResult> {
  const typedQueries = client.queries as
    | {
        listArchiveProblems?: () => Promise<ArchiveListResult>;
      }
    | undefined;

  if (typeof typedQueries?.listArchiveProblems === "function") {
    return typedQueries.listArchiveProblems();
  }

  const graphqlClient = client as unknown as {
    graphql?: (args: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { listArchiveProblems?: ArchiveProblem[] | null };
      errors?: unknown[];
    }>;
  };

  if (typeof graphqlClient.graphql !== "function") {
    return { errors: [new Error("Archive query is unavailable in runtime client.")] };
  }

  const raw = await graphqlClient.graphql({ query: LIST_ARCHIVE_PROBLEMS_GQL });
  return {
    data: raw.data?.listArchiveProblems ?? [],
    errors: raw.errors,
  };
}

async function recommendAdaptiveTask(args: {
  topic?: string;
  minProb?: number;
  maxProb?: number;
}): Promise<QueryResult<AdaptiveRecommendation>> {
  const typedQueries = client.queries as
    | {
        recommendAdaptiveTask?: (args?: {
          topic?: string;
          minProb?: number;
          maxProb?: number;
        }) => Promise<QueryResult<AdaptiveRecommendation>>;
      }
    | undefined;

  if (typeof typedQueries?.recommendAdaptiveTask === "function") {
    return typedQueries.recommendAdaptiveTask(args);
  }

  const graphqlClient = client as unknown as {
    graphql?: (args: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { recommendAdaptiveTask?: AdaptiveRecommendation | null };
      errors?: unknown[];
    }>;
  };

  if (typeof graphqlClient.graphql !== "function") {
    return { errors: [new Error("Adaptive recommendation query is unavailable.")] };
  }

  const raw = await graphqlClient.graphql({
    query: RECOMMEND_ADAPTIVE_TASK_GQL,
    variables: args,
  });

  return {
    data: raw.data?.recommendAdaptiveTask ?? null,
    errors: raw.errors,
  };
}

async function submitPracticeAnswer(args: {
  taskId: string;
  answer: string;
}): Promise<QueryResult<PracticeSubmissionResult>> {
  const typedMutations = client.mutations as
    | {
        submitPracticeAnswer?: (args: {
          taskId: string;
          answer: string;
        }) => Promise<QueryResult<PracticeSubmissionResult>>;
      }
    | undefined;

  if (typeof typedMutations?.submitPracticeAnswer === "function") {
    return typedMutations.submitPracticeAnswer(args);
  }

  const graphqlClient = client as unknown as {
    graphql?: (args: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { submitPracticeAnswer?: PracticeSubmissionResult | null };
      errors?: unknown[];
    }>;
  };

  if (typeof graphqlClient.graphql !== "function") {
    return { errors: [new Error("Practice answer mutation is unavailable.")] };
  }

  const raw = await graphqlClient.graphql({
    query: SUBMIT_PRACTICE_ANSWER_GQL,
    variables: args,
  });

  return {
    data: raw.data?.submitPracticeAnswer ?? null,
    errors: raw.errors,
  };
}

function firstErrorMessage(errors?: unknown[]) {
  const first = errors?.[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.errorMessage === "string") return record.errorMessage;
  return "";
}

export default function ArchivePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [problems, setProblems] = useState<ArchiveProblem[]>([]);
  const [selectedTopic, setSelectedTopic] = useState("ALL");
  const [expandedByExam, setExpandedByExam] = useState<Record<string, boolean>>({});

  const [recLoading, setRecLoading] = useState(false);
  const [rec, setRec] = useState<AdaptiveRecommendation | null>(null);

  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<PracticeSubmissionResult | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);

      try {
        await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

      const res = await listArchiveProblems();
      if (cancelled) return;

      if (res.errors?.length) {
        console.error(res.errors);
        setLoadError(firstErrorMessage(res.errors) || "Nu am putut încărca arhiva de probleme.");
        setProblems([]);
        setLoading(false);
        return;
      }

      setProblems((res.data ?? []).filter(notNull));
      setLoading(false);
    })().catch((err) => {
      console.error(err);
      if (!cancelled) {
        setLoadError("Nu am putut încărca arhiva de probleme.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const topics = useMemo(() => {
    const set = new Set<string>();
    for (const problem of problems) {
      const topic = String(problem.topic ?? "").trim() || "General";
      set.add(topic);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ro"));
  }, [problems]);

  useEffect(() => {
    if (selectedTopic === "ALL") return;
    if (!topics.includes(selectedTopic)) {
      setSelectedTopic("ALL");
    }
  }, [selectedTopic, topics]);

  const visibleProblems = useMemo(() => {
    const filtered =
      selectedTopic === "ALL"
        ? problems
        : problems.filter((problem) => String(problem.topic ?? "").trim() === selectedTopic);

    return filtered
      .slice()
      .sort((a, b) => {
        const examCmp = String(a.examTitle ?? "").localeCompare(String(b.examTitle ?? ""), "ro");
        if (examCmp !== 0) return examCmp;
        const orderCmp = Number(a.order ?? 0) - Number(b.order ?? 0);
        if (orderCmp !== 0) return orderCmp;
        return String(a.topic ?? "").localeCompare(String(b.topic ?? ""), "ro");
      });
  }, [problems, selectedTopic]);

  const visibleProblemsPreview = useMemo(() => visibleProblems.slice(0, 120), [visibleProblems]);

  const groupedVisibleProblems = useMemo<ArchiveExamGroup[]>(() => {
    const groups = new Map<string, ArchiveExamGroup>();

    for (const problem of visibleProblemsPreview) {
      const examTitle = String(problem.examTitle ?? "").trim() || "Simulare";
      const examId = String(problem.examId ?? "").trim();
      const key = examId ? `id:${examId}` : `title:${examTitle}`;

      const existing = groups.get(key);
      if (existing) {
        existing.problems.push(problem);
      } else {
        groups.set(key, { key, examTitle, problems: [problem] });
      }
    }

    return Array.from(groups.values())
      .sort((a, b) => a.examTitle.localeCompare(b.examTitle, "ro"))
      .map((group) => ({
        ...group,
        problems: group.problems
          .slice()
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)),
      }));
  }, [visibleProblemsPreview]);

  useEffect(() => {
    setExpandedByExam((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const group of groupedVisibleProblems) {
        if (group.key in prev) {
          next[group.key] = prev[group.key];
        } else {
          next[group.key] = false;
          changed = true;
        }
      }

      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [groupedVisibleProblems]);

  function toggleExamGroup(groupKey: string) {
    setExpandedByExam((prev) => ({
      ...prev,
      [groupKey]: !(prev[groupKey] ?? false),
    }));
  }

  async function handleRecommend() {
    setRecLoading(true);
    setSubmission(null);
    setSubmissionError(null);
    setAnswer("");

    try {
      const topic = selectedTopic === "ALL" ? undefined : selectedTopic;
      const res = await recommendAdaptiveTask({
        topic,
        minProb: 0.65,
        maxProb: 0.8,
      });

      if (res.errors?.length) {
        console.error(res.errors);
        setRec({
          status: "ERROR",
          reason: firstErrorMessage(res.errors) || "Recomandarea adaptivă a eșuat.",
        });
        return;
      }

      setRec(res.data ?? { status: "NO_ITEMS", reason: "Nu există recomandări disponibile." });
    } catch (err) {
      console.error(err);
      setRec({ status: "ERROR", reason: "Recomandarea adaptivă a eșuat." });
    } finally {
      setRecLoading(false);
    }
  }

  async function handleSubmitPracticeAnswer() {
    const taskId = rec?.taskId;
    if (!taskId) return;

    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      setSubmissionError("Introdu un răspuns înainte de trimitere.");
      return;
    }

    setSubmitting(true);
    setSubmissionError(null);

    try {
      const res = await submitPracticeAnswer({ taskId, answer: trimmedAnswer });
      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        setSubmissionError(firstErrorMessage(res.errors) || "Trimiterea răspunsului a eșuat.");
        return;
      }

      setSubmission(res.data);
    } catch (err) {
      console.error(err);
      setSubmissionError("Trimiterea răspunsului a eșuat.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă arhiva…</p>
        ) : loadError ? (
          <p className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
            {loadError}
          </p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">Arhivă probleme</div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>Înapoi la panou</OutlineButton>
              </div>
            </div>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="section-title">Antrenament adaptiv (Elo)</div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Recomandă itemi pe topicurile tale mai slabe, cu probabilitate țintă de succes între 65% și 80%.
                  </div>
                </div>

                <div style={{ minWidth: 220, display: "grid", gap: 6 }}>
                  <label htmlFor="archive-topic-select" className="small">
                    Topic
                  </label>
                  <select
                    id="archive-topic-select"
                    className="stats-select"
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                  >
                    <option value="ALL">Toate topicurile</option>
                    {topics.map((topic) => (
                      <option key={topic} value={topic}>
                        {topic}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <OutlineButton onClick={handleRecommend} disabled={recLoading}>
                  {recLoading ? "Se caută…" : "Recomandă item"}
                </OutlineButton>
              </div>

              {rec && rec.status !== "OK" && (
                <div className="small" style={{ marginTop: 10, opacity: 0.9 }}>
                  {rec.reason || "Nu există recomandări pentru moment."}
                </div>
              )}

              {rec?.status === "OK" && (
                <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                  <div className="exam-item">
                    <div className="exam-item-title">Recomandare curentă</div>
                    <div className="small" style={{ opacity: 0.9 }}>
                      Simulare: {rec.examTitle || "Simulare"} • Topic: {rec.topic || "General"}
                    </div>
                    <div className="small" style={{ opacity: 0.85 }}>
                      Probabilitate estimată de răspuns corect: {formatPercent(rec.expectedCorrectProb)}
                    </div>

                    <MathText className="task-question-text" text={String(rec.question ?? "")} />

                    <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                      <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Răspunsul tău"
                        className="field-input"
                        disabled={submitting}
                      />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <OutlineButton onClick={handleSubmitPracticeAnswer} disabled={submitting}>
                          {submitting ? "Se trimite…" : "Trimite răspuns"}
                        </OutlineButton>
                      </div>
                    </div>
                  </div>

                  {submissionError && (
                    <div className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
                      {submissionError}
                    </div>
                  )}

                  {submission && (
                    <div className="exam-item" style={{ background: "var(--surface-soft)" }}>
                      <div className="exam-item-title">
                        {submission.isCorrect ? "Răspuns corect" : "Răspuns greșit"}
                      </div>
                      <div className="small" style={{ opacity: 0.9 }}>
                        Răspuns corect: <MathText inline text={String(submission.correctAnswer ?? "—")} />
                      </div>
                      <div className="small" style={{ opacity: 0.9 }}>
                        Probabilitate estimată: {formatPercent(submission.expectedCorrectProb)}
                      </div>
                      <div className="small" style={{ opacity: 0.9 }}>
                        Rating topic: {formatRating(submission.studentTopicRatingBefore)} → {formatRating(submission.studentTopicRatingAfter)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <div className="section-title">Probleme disponibile</div>

              <div className="small" style={{ marginTop: 10, opacity: 0.9 }}>
                {visibleProblems.length} probleme găsite{visibleProblems.length > visibleProblemsPreview.length ? ` (afișăm primele ${visibleProblemsPreview.length})` : ""}.
              </div>

              <div className="exam-groups">
                {groupedVisibleProblems.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există probleme pentru filtrul curent.
                  </p>
                ) : (
                  groupedVisibleProblems.map((group, index) => {
                    const isExpanded = expandedByExam[group.key] ?? false;
                    const panelId = `archive-group-${index}`;
                    const groupCountLabel =
                      group.problems.length === 1
                        ? "1 problemă"
                        : `${group.problems.length} probleme`;

                    return (
                      <section key={group.key} className={`exam-type-group${isExpanded ? " is-open" : ""}`}>
                        <button
                          type="button"
                          className="exam-type-toggle"
                          onClick={() => toggleExamGroup(group.key)}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                        >
                          <span className="exam-type-head">
                            <span className="exam-type-title">{group.examTitle}</span>
                            <span className="exam-type-count">{groupCountLabel}</span>
                          </span>
                          <span className={`exam-type-chevron${isExpanded ? " is-open" : ""}`} aria-hidden="true">
                            ▾
                          </span>
                        </button>

                        {isExpanded && (
                          <div id={panelId} className="exam-list exam-list--nested">
                            {group.problems.map((problem) => {
                              const taskId = String(problem.taskId ?? "");
                              return (
                                <div key={taskId || `${group.key}-${problem.order ?? "?"}`} className="exam-item">
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      gap: 12,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                                      <div className="exam-item-title">Problema {problem.order ?? "?"}</div>
                                      <div className="small" style={{ opacity: 0.9 }}>
                                        Topic: {problem.topic || "General"}
                                      </div>
                                    </div>
                                    <div className="exam-actions" style={{ marginTop: 0, marginLeft: "auto" }}>
                                      <OutlineButton
                                        disabled={!taskId}
                                        onClick={() => taskId && router.push(`/archive/problem/${taskId}`)}
                                      >
                                        Deschide problema
                                      </OutlineButton>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
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

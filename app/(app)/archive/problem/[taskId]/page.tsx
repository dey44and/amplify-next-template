"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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
type PracticeSubmissionResult = Schema["PracticeSubmissionResult"]["type"];
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

function firstErrorMessage(errors?: unknown[]) {
  const first = errors?.[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.errorMessage === "string") return record.errorMessage;
  return "";
}

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

export default function ArchiveProblemPage() {
  const router = useRouter();
  const params = useParams<{ taskId: string }>();
  const taskId = useMemo(() => String(params.taskId ?? ""), [params.taskId]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ArchiveProblem | null>(null);

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
        setLoadError(firstErrorMessage(res.errors) || "Nu am putut încărca problema din arhivă.");
        setProblem(null);
        setLoading(false);
        return;
      }

      const items = (res.data ?? []).filter(notNull);
      const match = items.find((item) => String(item.taskId ?? "") === taskId) ?? null;
      if (!match) {
        setLoadError("Problema nu a fost găsită în arhivă.");
        setProblem(null);
        setLoading(false);
        return;
      }

      setProblem(match);
      setLoading(false);
    })().catch((err) => {
      console.error(err);
      if (!cancelled) {
        setLoadError("Nu am putut încărca problema din arhivă.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, taskId]);

  async function handleSubmitPracticeAnswer() {
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

  const pageTitle = `${problem?.examTitle || "Simulare"} - Problema ${problem?.order ?? "?"}`;

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă problema…</p>
        ) : loadError || !problem ? (
          <div className="panel-stack">
            <p className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
              {loadError || "Problema nu a fost găsită."}
            </p>
            <div className="panel-actions">
              <OutlineButton onClick={() => router.push("/archive")}>Înapoi la arhivă</OutlineButton>
            </div>
          </div>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">{pageTitle}</div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/archive")}>Înapoi la arhivă</OutlineButton>
              </div>
            </div>

            <Card>
              <div className="small" style={{ opacity: 0.9, marginBottom: 10 }}>
                Topic: {problem.topic || "General"}
              </div>

              <MathText className="task-question-text" text={String(problem.question ?? "")} />

              <div style={{ marginTop: 16, display: "grid", gap: 8, maxWidth: 420 }}>
                <label htmlFor="archive-answer-input" className="field-label">
                  Răspunsul tău
                </label>
                <input
                  id="archive-answer-input"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Exemplu: a"
                  className="field-input"
                  disabled={submitting}
                />

                <div className="exam-actions" style={{ marginTop: 4 }}>
                  <OutlineButton onClick={handleSubmitPracticeAnswer} disabled={submitting}>
                    {submitting ? "Se trimite…" : "Trimite răspuns"}
                  </OutlineButton>
                </div>

                {submissionError && (
                  <div className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
                    {submissionError}
                  </div>
                )}
              </div>
            </Card>

            {submission && (
              <Card>
                <div className="section-title">
                  {submission.isCorrect ? "Răspuns corect" : "Răspuns greșit"}
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  Răspuns corect: <MathText inline text={String(submission.correctAnswer ?? "—")} />
                </div>
                <div className="small">Probabilitate estimată: {formatPercent(submission.expectedCorrectProb)}</div>
                <div className="small">
                  Rating topic: {formatRating(submission.studentTopicRatingBefore)} → {formatRating(submission.studentTopicRatingAfter)}
                </div>
              </Card>
            )}
          </div>
        )}
      </PageShell>
    </>
  );
}

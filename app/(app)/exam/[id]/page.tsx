"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { getExamWindow } from "@/lib/examWindow";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type Task = Schema["Task"]["type"];
type ExamAttempt = Schema["ExamAttempt"]["type"];

function msToClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function ExamTakePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = useMemo(() => params.id, [params.id]);

  const [loginId, setLoginId] = useState("");

  const [exam, setExam] = useState<Exam | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [checkingAttempt, setCheckingAttempt] = useState(true);

  const [loadingTasks, setLoadingTasks] = useState(false);
  const [triedLoadingTasks, setTriedLoadingTasks] = useState(false);

  const [nowMs, setNowMs] = useState(Date.now());
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // used to prevent repeated submissions (manual + auto)
  const submittedRef = useRef(false);

  // derived window
  const { startMs, endMs } = useMemo(
    () => getExamWindow(exam ?? {}),
    [exam]
  );

  const isBefore = Number.isFinite(startMs) ? nowMs < startMs : false;
  const isDuring =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? nowMs >= startMs && nowMs < endMs
      : false;
  const isAfter = Number.isFinite(endMs) ? nowMs >= endMs : false;

  const remainingMs = Number.isFinite(endMs) ? endMs - nowMs : 0;

  async function loadExamOnly() {
    const examRes = await client.models.MockExam.get({ id: examId });
    if (examRes.errors?.length) console.error(examRes.errors);
    setExam(examRes.data ?? null);
  }

  async function checkAlreadySubmitted() {
    setCheckingAttempt(true);

    let userId: string;
    try {
      userId = (await getCurrentUser()).userId;
    } catch {
      router.replace("/login");
      return;
    }

    const res = await client.models.ExamAttempt.list({
      filter: {
        userId: { eq: userId },
        examId: { eq: examId },
      },
      limit: 50,
    });

    if (res.errors?.length) console.error(res.errors);

    const data = (res.data ?? []).filter(notNull);
    if (data.length > 0) {
      const latest = data
        .slice()
        .sort((a: ExamAttempt, b: ExamAttempt) => {
          const ax = toTimestamp(a.submittedAt);
          const bx = toTimestamp(b.submittedAt);
          return bx - ax;
        })[0];

      if (latest?.id) {
        submittedRef.current = true;
        router.replace(`/exam/review/${latest.id}`);
        return;
      }
    }

    setCheckingAttempt(false);
  }

  async function loadTasksSecure() {
    setLoadingTasks(true);
    setSubmitError(null);

    try {
      const res = await client.queries.listTasksForExam({ examId });
      if (res.errors?.length) {
        console.error(res.errors);
        setTasks([]);
        return;
      }

      const raw = (res.data ?? []).filter((t): t is Task => !!t);
      const data = raw.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setTasks(data);
    } finally {
      setLoadingTasks(false);
    }
  }

  async function requestAccess() {
    let userId: string;
    try {
      userId = (await getCurrentUser()).userId;
    } catch {
      router.replace("/login");
      return;
    }

    const res = await client.models.ExamRequest.create({
      owner: userId,
      examId,
      admissionType: exam?.admissionType ?? "",
      status: "PENDING",
      requestedAt: new Date().toISOString(),
    });

    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to request access.");
      return;
    }

    alert("Request sent. Please wait for approval.");
  }

  async function submitAttempt(auto = false) {
    if (submitting) return;
    if (submittedRef.current) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const answersJson = JSON.stringify(answers);

      const res = await client.mutations.submitExamAttempt({
        examId,
        answersJson,
        startedAt: startedAtIso ?? undefined,
      });

      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        const msg = res.errors?.[0]?.message ?? "Failed to submit.";

        // if server says already submitted, redirect user to stats (or you can refetch latest attempt)
        if (msg.includes("ALREADY_SUBMITTED")) {
          submittedRef.current = true;
          router.replace("/stats");
          return;
        }

        setSubmitError(msg);

        // if auto submit failed, stop re-spamming
        if (auto) submittedRef.current = true;
        return;
      }

      submittedRef.current = true;
      router.replace(`/exam/review/${res.data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Auth gate + exam load + attempt check
  useEffect(() => {
    (async () => {
      setLoading(true);

      // must be logged in
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }
      setLoginId(user.signInDetails?.loginId ?? user.username ?? "");

      await loadExamOnly();
      await checkAlreadySubmitted();

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Timer tick
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // When exam transitions into "during": set startedAt + load tasks once.
  // When exam ends: auto-submit best-effort once.
  useEffect(() => {
    if (!exam) return;
    if (checkingAttempt) return; // don't do anything until we know if already submitted
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;

    if (isDuring) {
      if (!startedAtIso) setStartedAtIso(new Date().toISOString());

      if (!triedLoadingTasks && !loadingTasks) {
        setTriedLoadingTasks(true);
        loadTasksSecure().catch(console.error);
      }
    }

    // auto-submit at/after end (best effort once)
    if (isAfter && !submittedRef.current && tasks.length > 0) {
      submitAttempt(true).catch(console.error);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, isDuring, isAfter, checkingAttempt, triedLoadingTasks, loadingTasks, tasks.length]);

  const inputStyle: React.CSSProperties = {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    outline: "none",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
    color: "var(--fg)",
  };

  const showLoading = loading || checkingAttempt;

  return (
    <>
      <SiteHeader
        rightSlot={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="small" style={{ opacity: 0.75 }}>
              {loginId}
            </span>
            <OutlineButton
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </OutlineButton>
          </div>
        }
      />

      <PageShell>
        {showLoading ? (
          <p className="small">Loading…</p>
        ) : !exam ? (
          <p className="small">Exam not found.</p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">{exam.title}</div>

              <div className="small" style={{ opacity: 0.8 }}>
                Starts: {formatWhen(exam.startAt)} • Duration: {exam.durationMinutes} min
              </div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>Back</OutlineButton>
              </div>
            </div>

            {/* Status card */}
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div className="section-title">Exam status</div>
                  <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                    {isBefore
                      ? "Not started yet."
                      : isDuring
                      ? "In progress."
                      : isAfter
                      ? "Ended."
                      : "Schedule unavailable."}
                  </div>
                </div>

                {Number.isFinite(remainingMs) && isDuring && (
                  <div style={{ textAlign: "right" }}>
                    <div className="small" style={{ opacity: 0.75 }}>
                      Time remaining
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 760 }}>
                      {msToClock(remainingMs)}
                    </div>
                  </div>
                )}
              </div>

              {isBefore && Number.isFinite(startMs) && (
                <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
                  You can start when the timer reaches 0.
                </div>
              )}

              {isAfter && (
                <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
                  If you submitted, you can review your results from the review page link shown after submission.
                </div>
              )}
            </Card>

            {/* Main exam content */}
            <Card>
              {!isDuring ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="section-title">Questions</div>

                  {isBefore ? (
                    <p className="small" style={{ margin: 0 }}>
                      The exam has not started yet.
                    </p>
                  ) : isAfter ? (
                    <p className="small" style={{ margin: 0 }}>
                      The exam window has ended.
                    </p>
                  ) : (
                    <p className="small" style={{ margin: 0 }}>
                      Unable to determine schedule.
                    </p>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <OutlineButton onClick={() => router.push("/dashboard")}>
                      Back to dashboard
                    </OutlineButton>
                  </div>
                </div>
              ) : loadingTasks ? (
                <p className="small" style={{ margin: 0 }}>
                  Loading questions…
                </p>
              ) : tasks.length === 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="section-title">No access or no questions</div>
                  <p className="small" style={{ margin: 0, opacity: 0.85 }}>
                    If you requested access, wait for approval. If you have access and still see
                    this, verify the exam has questions.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <OutlineButton onClick={requestAccess}>Request access</OutlineButton>
                    <OutlineButton onClick={loadTasksSecure}>Retry</OutlineButton>
                  </div>
                </div>
              ) : (
                <div className="panel-stack">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div className="section-title">Questions</div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <OutlineButton onClick={() => submitAttempt(false)} disabled={submitting}>
                        {submitting ? "Submitting…" : "Submit"}
                      </OutlineButton>
                    </div>
                  </div>

                  {submitError && (
                    <div className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
                      {submitError}
                    </div>
                  )}

                  <div style={{ display: "grid", gap: 12 }}>
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          borderTop: "1px solid var(--border)",
                          paddingTop: 12,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 760 }}>
                          #{t.order} • {t.mark} points
                        </div>

                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                          {t.question}
                        </div>

                        <input
                          style={inputStyle}
                          placeholder="Your answer…"
                          value={answers[t.id] ?? ""}
                          onChange={(e) =>
                            setAnswers((prev) => ({ ...prev, [t.id]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="small" style={{ opacity: 0.75 }}>
                    Tip: submission is enforced server-side based on the official exam start time and duration.
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </PageShell>
    </>
  );
}

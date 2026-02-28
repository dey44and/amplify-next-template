"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
type ExamAttempt = Schema["ExamAttempt"]["type"];

function GrayButton({ label, title }: { label: string; title?: string }) {
  return (
    <button
      disabled
      title={title}
      style={{
        background: "rgba(0,0,0,0.05)",
        border: "1px solid rgba(0,0,0,0.10)",
        padding: "10px 12px",
        borderRadius: 12,

        // normal feel (not bold)
        fontWeight: 600,
        fontSize: 14,

        opacity: 1,
        color: "rgba(0,0,0,0.55)",
        cursor: "not-allowed",
      }}
    >
      {label}
    </button>
  );
}

function getExamStartMs(exam: Pick<Exam, "startAt">) {
  return toTimestamp(exam.startAt);
}

function getAttemptSubmittedAtMs(attempt: Pick<ExamAttempt, "submittedAt">) {
  return toTimestamp(attempt.submittedAt);
}

export default function StatsPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(true);

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);

  // used for "unlock review after exam ends"
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      // auth gate
      let userId: string;
      let login: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId;
        login = u.signInDetails?.loginId ?? u.username ?? "";
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;
      setLoginId(login);

      const [examsRes, attemptsRes] = await Promise.all([
        client.models.MockExam.list({ limit: 500 }),
        // load attempts for current user
        // (If you later have a generated secondary-index query, you can swap to it.)
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

  const attemptsByExamId = useMemo(() => {
    const m = new Map<string, ExamAttempt[]>();

    for (const a of attempts) {
      const examId = a.examId;
      if (!examId) continue;
      const arr = m.get(examId) ?? [];
      arr.push(a);
      m.set(examId, arr);
    }

    // sort each bucket by submittedAt desc
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

  const reviewLockedCount = useMemo(() => {
    let count = 0;
    for (const exam of examsSortedByStartDesc) {
      const latest = attemptsByExamId.get(exam.id)?.[0];
      if (!latest) continue;
      const { endMs } = getExamWindow(exam);
      const reviewUnlocked = Number.isFinite(endMs) ? nowMs >= endMs : true;
      if (!reviewUnlocked) count += 1;
    }
    return count;
  }, [attemptsByExamId, examsSortedByStartDesc, nowMs]);

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
        {loading ? (
          <p className="small">Loading stats…</p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">My stats</div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Back to dashboard
                </OutlineButton>
              </div>
            </div>

            <Card>
              <div className="section-title">Progress snapshot</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                A quick look at how your latest attempts are going.
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-blue">
                  <div className="metric-label">Attempted exams</div>
                  <div className="metric-value">{attemptedExamsCount}</div>
                  <div className="metric-helper">From {exams.length} available exam(s)</div>
                </div>

                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Average score</div>
                  <div className="metric-value">{averagePercent}%</div>
                  <div className="metric-helper">Based on latest attempt per exam</div>
                </div>

                <div className="metric-tile soft-mint">
                  <div className="metric-label">Locked reviews</div>
                  <div className="metric-value">{reviewLockedCount}</div>
                  <div className="metric-helper">Unlock automatically after exam end</div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="section-title">Results per exam</div>

              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                Results appear after you submit. Reviews unlock after the exam time window ends.
              </div>

              <div className="exam-list">
                {exams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No exams available.
                  </p>
                ) : (
                  examsSortedByStartDesc.map((e) => {
                      const examAttempts = attemptsByExamId.get(e.id) ?? [];
                      const latest = examAttempts[0] ?? null;

                      const { endMs } = getExamWindow(e);
                      const reviewUnlocked = Number.isFinite(endMs) ? nowMs >= endMs : true;

                      return (
                        <div key={e.id} className="exam-item">
                          <div className="exam-item-title">{e.title}</div>
                          <div className="small">Admission type: {e.admissionType}</div>

                          <div className="small" style={{ opacity: 0.85 }}>
                            Starts: {formatWhen(e.startAt)} • Duration: {e.durationMinutes ?? "—"} min
                          </div>

                          {latest ? (
                            <div className="small" style={{ opacity: 0.85 }}>
                              Submission: {formatWhen(latest.submittedAt)} • Score: {latest.score} /{" "}
                              {latest.maxScore}
                            </div>
                          ) : (
                            <div className="small" style={{ opacity: 0.85 }}>
                              No attempts yet.
                            </div>
                          )}

                          <div className="exam-actions">
                            {/* <OutlineButton onClick={() => router.push(`/exam/${e.id}`)}>
                              Go to exam
                            </OutlineButton> */}

                            {latest && (
                              reviewUnlocked ? (
                              <OutlineButton
                                onClick={() => router.push(`/exam/review/${latest.id}`)}
                              >
                                View results
                              </OutlineButton>
                            ) : (
                              <GrayButton
                                label="Review locked"
                                title="Review unlocks after the exam time window ends."
                              />
                            )
                            )}
                          </div>

                          {!reviewUnlocked && latest && (
                            <div className="small" style={{ opacity: 0.7 }}>
                              Review will be available after the exam ends.
                            </div>
                          )}
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

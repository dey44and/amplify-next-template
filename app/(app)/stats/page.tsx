"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type ExamAttempt = Schema["ExamAttempt"]["type"];

function notNull<T>(x: T | null | undefined): x is T {
  return x != null;
}

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function getWindow(exam: any) {
  const startIso = exam?.startAt as string | undefined;
  const dur = Number(exam?.durationMinutes ?? 0);

  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs = Number.isFinite(startMs) && Number.isFinite(dur) ? startMs + dur * 60_000 : NaN;

  return { startMs, endMs };
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
      setLoginId(login);

      // load exams
      const examsRes = await client.models.MockExam.list({ limit: 500 });
      if (examsRes.errors?.length) console.error(examsRes.errors);
      setExams((examsRes.data ?? []).filter(notNull));

      // load attempts for current user
      // (If you later have a generated secondary-index query, you can swap to it.)
      const attemptsRes = await client.models.ExamAttempt.list({
        filter: { userId: { eq: userId } },
        limit: 500,
      });
      if (attemptsRes.errors?.length) console.error(attemptsRes.errors);
      setAttempts((attemptsRes.data ?? []).filter(notNull));

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  const attemptsByExamId = useMemo(() => {
    const m = new Map<string, ExamAttempt[]>();

    for (const a of attempts) {
      const examId = (a as any).examId as string | undefined;
      if (!examId) continue;
      const arr = m.get(examId) ?? [];
      arr.push(a);
      m.set(examId, arr);
    }

    // sort each bucket by submittedAt desc
    m.forEach((arr, k) => {
      arr.sort((x: ExamAttempt, y: ExamAttempt) => {
        const ax = new Date((x as any).submittedAt ?? 0).getTime();
        const ay = new Date((y as any).submittedAt ?? 0).getTime();
        return ay - ax;
      });
      m.set(k, arr);
    });

    return m;
  }, [attempts]);

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
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>My stats</div>

              <div style={{ marginLeft: "auto" }}>
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Back to dashboard
                </OutlineButton>
              </div>
            </div>

            <Card>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                Results per exam
              </div>

              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                Results appear after you submit. Reviews unlock after the exam time window ends.
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {exams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No exams available.
                  </p>
                ) : (
                  exams
                    .slice()
                    .sort((a: Exam, b: Exam) => {
                      const sa = new Date((a as any).startAt ?? 0).getTime();
                      const sb = new Date((b as any).startAt ?? 0).getTime();
                      return sb - sa;
                    })
                    .map((e) => {
                      const examAttempts = attemptsByExamId.get(e.id) ?? [];
                      const latest = examAttempts[0] ?? null;

                      const best =
                        examAttempts.length === 0
                          ? null
                          : examAttempts.reduce((acc: ExamAttempt, cur: ExamAttempt) => {
                              const s1 = Number((acc as any).score ?? 0);
                              const s2 = Number((cur as any).score ?? 0);
                              return s2 > s1 ? cur : acc;
                            }, examAttempts[0]);

                      const { endMs } = getWindow(e as any);
                      const reviewUnlocked = Number.isFinite(endMs) ? nowMs >= endMs : true;

                      return (
                        <div
                          key={e.id}
                          style={{
                            borderTop: "1px solid var(--border)",
                            paddingTop: 12,
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ fontWeight: 900, letterSpacing: -0.2 }}>{e.title}</div>
                          <div className="small">Admission type: {e.admissionType}</div>

                          <div className="small" style={{ opacity: 0.85 }}>
                            Starts: {formatWhen((e as any).startAt)} • Duration:{" "}
                            {(e as any).durationMinutes ?? "—"} min
                          </div>

                          {latest ? (
                            <div className="small" style={{ opacity: 0.85 }}>
                              Submission: {formatWhen((latest as any).submittedAt)} • Score:{" "}
                              {(latest as any).score} / {(latest as any).maxScore}
                            </div>
                          ) : (
                            <div className="small" style={{ opacity: 0.85 }}>
                              No attempts yet.
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
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

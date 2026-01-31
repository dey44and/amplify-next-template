"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];
type Exam = Schema["MockExam"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];
type ExamAccess = Schema["ExamAccess"]["type"];
type ExamAttempt = Schema["ExamAttempt"]["type"];

async function checkIsAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

function getWindow(exam: any) {
  const startIso = exam?.startAt as string | undefined;
  const dur = Number(exam?.durationMinutes ?? 0);

  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(dur) ? startMs + dur * 60_000 : NaN;

  return { startMs, endMs };
}

function getExamState(exam: any, nowMs: number) {
  const { startMs, endMs } = getWindow(exam);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "unknown";
  if (nowMs < startMs) return "before";
  if (nowMs >= startMs && nowMs < endMs) return "during";
  return "after";
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

        // ✅ NOT BOLD (match normal button feel)
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

function notNull<T>(x: T | null | undefined): x is T {
  return x != null;
}

export default function DashboardPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [requests, setRequests] = useState<ExamRequest[]>([]);
  const [access, setAccess] = useState<ExamAccess[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginId, setLoginId] = useState<string>("");

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const accessByExamId = useMemo(() => {
    const m = new Map<string, ExamAccess>();
    for (const a of access) {
      const examId = (a as any).examId as string | undefined;
      if (examId) m.set(examId, a);
    }
    return m;
  }, [access]);

  const requestByExamId = useMemo(() => {
    const m = new Map<string, ExamRequest>();
    for (const r of requests) {
      const examId = (r as any).examId as string | undefined;
      if (examId) m.set(examId, r);
    }
    return m;
  }, [requests]);

  // ✅ Latest attempt per exam (so dashboard can show "View results")
  const latestAttemptByExamId = useMemo(() => {
    const m = new Map<string, ExamAttempt>();

    const sorted = attempts
      .filter(notNull)
      .slice()
      .sort((a, b) => {
        const ax = new Date((a as any).submittedAt ?? 0).getTime();
        const bx = new Date((b as any).submittedAt ?? 0).getTime();
        return bx - ax;
      });

    for (const a of sorted) {
      const examId = (a as any).examId as string | undefined;
      if (!examId) continue;
      if (!m.has(examId)) m.set(examId, a); // first is latest (sorted desc)
    }
    return m;
  }, [attempts]);

  async function refreshStudentState(userId: string) {
    // requests
    const reqRes = await client.models.ExamRequest.list({
      filter: { owner: { eq: userId } },
      limit: 500,
    });
    if (reqRes.errors?.length) console.error(reqRes.errors);
    setRequests(reqRes.data ?? []);

    // access
    const accRes = await client.models.ExamAccess.list({
      filter: { owner: { eq: userId } },
      limit: 500,
    });
    if (accRes.errors?.length) console.error(accRes.errors);
    setAccess(accRes.data ?? []);

    // ✅ attempts (so we can hide Start exam after submit)
    const attRes = await client.models.ExamAttempt.list({
      filter: { userId: { eq: userId } },
      limit: 500,
    });
    if (attRes.errors?.length) console.error(attRes.errors);
    setAttempts(attRes.data ?? []);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);

      let userId: string;
      let login: string;
      try {
        const current = await getCurrentUser();
        userId = current.userId;
        login = current.signInDetails?.loginId ?? current.username ?? "";
      } catch {
        router.replace("/login");
        return;
      }

      setLoginId(login);

      const admin = await checkIsAdmin();
      setIsAdmin(admin);

      const profileRes = await client.models.UserProfile.get({ id: userId });
      if (profileRes.errors?.length) console.error(profileRes.errors);

      const p = profileRes.data ?? null;
      if (!p) {
        router.replace("/profile");
        return;
      }
      setProfile(p);

      const examsRes = await client.models.MockExam.list({ limit: 200 });
      if (examsRes.errors?.length) console.error(examsRes.errors);
      setExams(examsRes.data ?? []);

      if (!admin) {
        await refreshStudentState(userId);
      } else {
        setRequests([]);
        setAccess([]);
        setAttempts([]);
      }

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function requestAccess(exam: Exam) {
    let userId: string;
    try {
      userId = (await getCurrentUser()).userId;
    } catch {
      router.replace("/login");
      return;
    }

    if (requestByExamId.has(exam.id)) return;

    const res = await client.models.ExamRequest.create({
      owner: userId,
      examId: exam.id,
      admissionType: exam.admissionType,
      status: "PENDING",
      requestedAt: new Date().toISOString(),
    } as any);

    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to request access.");
      return;
    }

    await refreshStudentState(userId);
  }

  async function deleteRequest(req: ExamRequest) {
    if (!confirm("Delete this request?")) return;

    const owner = (req as any).owner as string | undefined;
    const examId = (req as any).examId as string | undefined;
    if (!owner || !examId) return;

    const res = await client.models.ExamRequest.delete({ owner, examId } as any);
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to delete request.");
      return;
    }

    setRequests((prev) =>
      prev.filter((r) => !((r as any).owner === owner && (r as any).examId === examId))
    );
  }

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
          <p className="small">Loading dashboard…</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>
                Welcome, {profile?.firstName} {profile?.lastName}
              </div>

              <div style={{ display: "flex", gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
                {isAdmin && (
                  <>
                    <OutlineButton onClick={() => router.push("/admin/exams")}>
                      Admin exams
                    </OutlineButton>
                    <OutlineButton onClick={() => router.push("/admin/requests")}>
                      Requests
                    </OutlineButton>
                  </>
                )}
              </div>
            </div>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4 }}>
                    Available mock exams
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Choose an exam and start practicing.
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {exams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No exams yet. (An Admin must create them.)
                  </p>
                ) : (
                  exams.map((e) => {
                    const hasAccess = accessByExamId.has(e.id);
                    const req = requestByExamId.get(e.id);
                    const status = (req as any)?.status as string | undefined;

                    const examState = getExamState(e as any, nowMs);

                    const latestAttempt = latestAttemptByExamId.get(e.id);

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

                        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                          {isAdmin ? (
                            <OutlineButton onClick={() => router.push(`/admin/exams/${e.id}`)}>
                              Manage exam
                            </OutlineButton>
                          ) : latestAttempt ? (
                            // ✅ already submitted -> do NOT show Start exam anymore
                            <OutlineButton
                              onClick={() => router.push(`/exam/review/${latestAttempt.id}`)}
                            >
                              View results
                            </OutlineButton>
                          ) : hasAccess ? (
                            examState === "during" ? (
                              <OutlineButton onClick={() => router.push(`/exam/${e.id}`)}>
                                Start exam
                              </OutlineButton>
                            ) : examState === "before" ? (
                              <GrayButton
                                label="Not started"
                                title={`Starts at ${formatWhen((e as any).startAt)}`}
                              />
                            ) : (
                              <GrayButton label="Exam ended" />
                            )
                          ) : status === "PENDING" ? (
                            <GrayButton label="Request pending" />
                          ) : status === "REJECTED" ? (
                            <>
                              <GrayButton label="Rejected" />
                              <button
                                onClick={() => deleteRequest(req!)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: "10px 0",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "rgba(0,0,0,0.55)",
                                  textDecoration: "underline",
                                }}
                              >
                                Delete request
                              </button>
                            </>
                          ) : (
                            <OutlineButton onClick={() => requestAccess(e)}>
                              Request access
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

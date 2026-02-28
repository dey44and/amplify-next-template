"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { getExamState, getExamWindow } from "@/lib/examWindow";
import { isAdmin as checkIsAdmin } from "@/lib/isAdmin";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];
type Exam = Schema["MockExam"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];
type ExamAccess = Schema["ExamAccess"]["type"];
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

  // 1s tick keeps state accurate (start/lock/unlock)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const accessByExamId = useMemo(() => {
    const m = new Map<string, ExamAccess>();
    for (const a of access) {
      const examId = a.examId;
      if (examId) m.set(examId, a);
    }
    return m;
  }, [access]);

  const requestByExamId = useMemo(() => {
    const m = new Map<string, ExamRequest>();
    for (const r of requests) {
      const examId = r.examId;
      if (examId) m.set(examId, r);
    }
    return m;
  }, [requests]);

  // Latest attempt per exam (so dashboard can show results and hide "Start exam")
  const latestAttemptByExamId = useMemo(() => {
    const m = new Map<string, ExamAttempt>();

    const sorted = attempts
      .filter(notNull)
      .slice()
      .sort((a, b) => {
        const ax = toTimestamp(a.submittedAt);
        const bx = toTimestamp(b.submittedAt);
        return bx - ax;
      });

    for (const a of sorted) {
      const examId = a.examId;
      if (!examId) continue;
      if (!m.has(examId)) m.set(examId, a);
    }
    return m;
  }, [attempts]);

  const completedCount = latestAttemptByExamId.size;
  const upcomingCount = useMemo(
    () => exams.filter((exam) => getExamState(exam, nowMs) === "before").length,
    [exams, nowMs]
  );
  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "PENDING").length,
    [requests]
  );

  async function refreshStudentState(userId: string) {
    const [reqRes, accRes, attRes] = await Promise.all([
      client.models.ExamRequest.list({
        filter: { owner: { eq: userId } },
        limit: 500,
      }),
      client.models.ExamAccess.list({
        filter: { owner: { eq: userId } },
        limit: 500,
      }),
      client.models.ExamAttempt.list({
        filter: { userId: { eq: userId } },
        limit: 500,
      }),
    ]);

    if (reqRes.errors?.length) console.error(reqRes.errors);
    setRequests((reqRes.data ?? []).filter(notNull));

    if (accRes.errors?.length) console.error(accRes.errors);
    setAccess((accRes.data ?? []).filter(notNull));

    if (attRes.errors?.length) console.error(attRes.errors);
    setAttempts((attRes.data ?? []).filter(notNull));
  }

  useEffect(() => {
    let cancelled = false;

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
      if (cancelled) return;

      setLoginId(login);

      const admin = await checkIsAdmin();
      if (cancelled) return;
      setIsAdmin(admin);

      const profileRes = await client.models.UserProfile.get({ id: userId });
      if (profileRes.errors?.length) console.error(profileRes.errors);
      if (cancelled) return;

      const p = profileRes.data ?? null;
      if (!p) {
        router.replace("/profile");
        return;
      }
      setProfile(p);

      const examsRes = await client.models.MockExam.list({ limit: 200 });
      if (examsRes.errors?.length) console.error(examsRes.errors);
      if (cancelled) return;
      setExams((examsRes.data ?? []).filter(notNull));

      if (!admin) {
        await refreshStudentState(userId);
      } else {
        setRequests([]);
        setAccess([]);
        setAttempts([]);
      }
      if (cancelled) return;

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
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
    });

    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to request access.");
      return;
    }

    await refreshStudentState(userId);
  }

  async function deleteRequest(req: ExamRequest) {
    if (!confirm("Delete this request?")) return;

    const owner = req.owner;
    const examId = req.examId;
    if (!owner || !examId) return;

    const res = await client.models.ExamRequest.delete({ owner, examId });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to delete request.");
      return;
    }

    setRequests((prev) =>
      prev.filter((r) => !(r.owner === owner && r.examId === examId))
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
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">
                Welcome, {profile?.firstName} {profile?.lastName}
              </div>

              <div className="panel-actions">
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
              <div className="section-title">Your learning pulse</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Quick overview of your current exam activity.
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-blue">
                  <div className="metric-label">Available exams</div>
                  <div className="metric-value">{exams.length}</div>
                  <div className="metric-helper">
                    {upcomingCount} upcoming
                  </div>
                </div>

                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Completed</div>
                  <div className="metric-value">{completedCount}</div>
                  <div className="metric-helper">
                    Exams with at least one submission
                  </div>
                </div>

                <div className="metric-tile soft-mint">
                  <div className="metric-label">Access status</div>
                  <div className="metric-value">{isAdmin ? "Admin" : access.length}</div>
                  <div className="metric-helper">
                    {isAdmin ? "You can manage all exams" : `${pendingCount} pending request(s)`}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="section-title-lg">
                    Available mock exams
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Choose an exam and start practicing.
                  </div>
                </div>
              </div>

              <div className="exam-list">
                {exams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No exams yet. (An Admin must create them.)
                  </p>
                ) : (
                  exams.map((e) => {
                    const hasAccess = accessByExamId.has(e.id);
                    const req = requestByExamId.get(e.id);
                    const status = req?.status;

                    const examState = getExamState(e, nowMs);

                    // latest attempt (if submitted)
                    const latestAttempt = latestAttemptByExamId.get(e.id);

                    // ✅ Review lock logic (same as stats page)
                    const { endMs } = getExamWindow(e);
                    const reviewUnlocked = Number.isFinite(endMs) ? nowMs >= endMs : true;

                    return (
                      <div key={e.id} className="exam-item">
                        <div className="exam-item-title">{e.title}</div>
                        <div className="small">Admission type: {e.admissionType}</div>

                        <div className="small" style={{ opacity: 0.85 }}>
                          Starts: {formatWhen(e.startAt)} • Duration: {e.durationMinutes ?? "—"}{" "}
                          min
                        </div>

                        <div className="exam-actions">
                          {isAdmin ? (
                            <OutlineButton onClick={() => router.push(`/admin/exams/${e.id}`)}>
                              Manage exam
                            </OutlineButton>
                          ) : latestAttempt ? (
                            // ✅ submitted: show results, but lock until exam ends
                            reviewUnlocked ? (
                              <OutlineButton
                                onClick={() => router.push(`/exam/review/${latestAttempt.id}`)}
                              >
                                View results
                              </OutlineButton>
                            ) : (
                              <GrayButton
                                label="Review locked"
                                title="Review unlocks after the exam time window ends."
                              />
                            )
                          ) : hasAccess ? (
                            examState === "during" ? (
                              <OutlineButton onClick={() => router.push(`/exam/${e.id}`)}>
                                Start exam
                              </OutlineButton>
                            ) : examState === "before" ? (
                              <GrayButton
                                label="Not started"
                                title={`Starts at ${formatWhen(e.startAt)}`}
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

                        {/* Optional helper text when locked */}
                        {!isAdmin && latestAttempt && !reviewUnlocked && (
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { getExamState, getExamWindow } from "@/lib/examWindow";
import { isAdmin as checkIsAdmin } from "@/lib/isAdmin";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

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
  const visibleDashboardExams = useMemo(
    () =>
      exams.filter((exam) => {
        const state = getExamState(exam, nowMs);
        return state === "before" || state === "during";
      }),
    [exams, nowMs]
  );
  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "PENDING").length,
    [requests]
  );
  const upcomingLabel =
    upcomingCount === 1
      ? "1 simulare viitoare"
      : `${upcomingCount} simulări viitoare`;
  const pendingLabel =
    pendingCount === 1
      ? "1 cerere în așteptare"
      : `${pendingCount} cereri în așteptare`;

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
      try {
        const current = await getCurrentUser();
        userId = current.userId;
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

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
      alert("Solicitarea accesului a eșuat.");
      return;
    }

    await refreshStudentState(userId);
  }

  async function deleteRequest(req: ExamRequest) {
    if (!confirm("Ștergi această cerere?")) return;

    const owner = req.owner;
    const examId = req.examId;
    if (!owner || !examId) return;

    const res = await client.models.ExamRequest.delete({ owner, examId });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Ștergerea cererii a eșuat.");
      return;
    }

    setRequests((prev) =>
      prev.filter((r) => !(r.owner === owner && r.examId === examId))
    );
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă panoul…</p>
        ) : (
          <div className="panel-stack">
            <div className="panel-top-row">
              <div className="page-title">
                Bine ai venit, {profile?.firstName} {profile?.lastName}
              </div>

              <div className="panel-actions">
                {isAdmin && (
                  <>
                    <OutlineButton onClick={() => router.push("/admin/exams")}>
                      Simulări administrator
                    </OutlineButton>
                    <OutlineButton onClick={() => router.push("/admin/requests")}>
                      Cereri
                    </OutlineButton>
                  </>
                )}
              </div>
            </div>

            <Card>
              <div className="section-title">Ritmul tău de învățare</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                O privire rapidă asupra activității tale la simulări.
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-blue">
                  <div className="metric-label">Simulări disponibile</div>
                  <div className="metric-value">{visibleDashboardExams.length}</div>
                  <div className="metric-helper">
                    {upcomingLabel}
                  </div>
                </div>

                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Finalizate</div>
                  <div className="metric-value">{completedCount}</div>
                  <div className="metric-helper">
                    Simulări cu cel puțin o trimitere
                  </div>
                </div>

                <div className="metric-tile soft-mint">
                  <div className="metric-label">Stare acces</div>
                  <div className="metric-value">{isAdmin ? "Administrator" : access.length}</div>
                  <div className="metric-helper">
                    {isAdmin ? "Poți gestiona toate simulările" : pendingLabel}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="section-title-lg">
                    Simulări disponibile
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Sunt afișate doar simulările viitoare sau în desfășurare.
                  </div>
                </div>
              </div>

              <div className="exam-list">
                {visibleDashboardExams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări viitoare în acest moment.
                  </p>
                ) : (
                  visibleDashboardExams.map((e) => {
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
                        <div className="small">Tip admitere: {e.admissionType}</div>

                        <div className="small" style={{ opacity: 0.85 }}>
                          Începe: {formatWhen(e.startAt)} • Durată: {e.durationMinutes ?? "—"}{" "}
                          min
                        </div>

                        <div className="exam-actions">
                          {isAdmin ? (
                            <OutlineButton onClick={() => router.push(`/admin/exams/${e.id}`)}>
                              Gestionează simularea
                            </OutlineButton>
                          ) : latestAttempt ? (
                            // ✅ submitted: show results, but lock until exam ends
                            reviewUnlocked ? (
                              <OutlineButton
                                onClick={() => router.push(`/exam/review/${latestAttempt.id}`)}
                              >
                                Vezi rezultatele
                              </OutlineButton>
                            ) : (
                              <GrayButton
                                label="Rezultate blocate"
                                title="Rezultatele se deblochează după încheierea intervalului de examen."
                              />
                            )
                          ) : hasAccess ? (
                            examState === "during" ? (
                              <OutlineButton onClick={() => router.push(`/exam/${e.id}`)}>
                                Începe examenul
                              </OutlineButton>
                            ) : examState === "before" ? (
                              <GrayButton
                                label="Neînceput"
                                title={`Începe la ${formatWhen(e.startAt)}`}
                              />
                            ) : (
                              <GrayButton label="Examen încheiat" />
                            )
                          ) : status === "PENDING" ? (
                            <GrayButton label="Cerere în așteptare" />
                          ) : status === "REJECTED" ? (
                            <>
                              <GrayButton label="Respins" />
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
                                Șterge cererea
                              </button>
                            </>
                          ) : (
                            <OutlineButton onClick={() => requestAccess(e)}>
                              Solicită acces
                            </OutlineButton>
                          )}
                        </div>

                        {/* Optional helper text when locked */}
                        {!isAdmin && latestAttempt && !reviewUnlocked && (
                          <div className="small" style={{ opacity: 0.7 }}>
                            Rezultatele vor fi disponibile după încheierea examenului.
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

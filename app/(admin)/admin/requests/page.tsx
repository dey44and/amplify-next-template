"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen } from "@/lib/dateTime";
import { isAdmin } from "@/lib/isAdmin";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];

export default function AdminRequestsPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState<ExamRequest[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [noteByKey, setNoteByKey] = useState<Record<string, string>>({});
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  const examTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of exams) m.set(e.id, e.title ?? e.id);
    return m;
  }, [exams]);

  async function refresh() {
    setLoading(true);

    const reqRes = await client.models.ExamRequest.list({
      filter: { status: { eq: "PENDING" } },
      limit: 500,
    });
    if (reqRes.errors?.length) console.error(reqRes.errors);
    setRequests(reqRes.data ?? []);

    const examsRes = await client.models.MockExam.list({ limit: 500 });
    if (examsRes.errors?.length) console.error(examsRes.errors);
    setExams(examsRes.data ?? []);

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Auth gate -> /login
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }
      setLoginId(user.signInDetails?.loginId ?? user.username ?? "");

      // Admin gate -> /dashboard
      const ok = await isAdmin();
      if (!ok) {
        router.replace("/dashboard");
        return;
      }

      await refresh();
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function decide(req: ExamRequest, status: "APPROVED" | "REJECTED") {
    const owner = req.owner;
    const examId = req.examId;
    if (!owner || !examId) return;

    const key = `${owner}::${examId}`;
    const note = (noteByKey[key] ?? "").trim();

    setWorkingKey(key);
    try {
      const res = await client.mutations.decideExamRequest({
        owner,
        examId,
        status,
        note: note || undefined,
      });

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Failed to update request (check console).");
        return;
      }

      // Remove from UI immediately
      setRequests((prev) =>
        prev.filter((r) => !(r.owner === owner && r.examId === examId))
      );
    } finally {
      setWorkingKey(null);
    }
  }

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
        <div className="panel-stack">
          <div className="panel-top-row">
            <div className="page-title">Admin • Requests</div>

            <div className="small" style={{ marginLeft: 8 }}>
              Approve or reject exam access requests.
            </div>

            <div className="panel-actions">
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Refresh
              </OutlineButton>
            </div>
          </div>

          <Card>
            <div className="section-title">Pending requests</div>

            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {loading ? (
                <p className="small" style={{ margin: 0 }}>
                  Loading…
                </p>
              ) : requests.length === 0 ? (
                <p className="small" style={{ margin: 0 }}>
                  No pending requests.
                </p>
              ) : (
                requests.map((r) => {
                  const owner = r.owner;
                  const examId = r.examId;
                  const key = `${owner ?? "?"}::${examId ?? "?"}`;

                  return (
                    <div
                      key={key}
                      style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: 12,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 760, letterSpacing: -0.2 }}>
                        {examTitleById.get(examId ?? "") ?? examId ?? "Unknown exam"}
                      </div>

                      <div className="small" style={{ opacity: 0.85 }}>
                        Exam ID: {examId ?? "—"}
                      </div>

                      <div className="small">
                        Student (owner sub): <span style={{ opacity: 0.85 }}>{owner ?? "—"}</span>
                      </div>

                      <div className="small" style={{ opacity: 0.85 }}>
                        Requested: {formatWhen(r.requestedAt)}
                      </div>

                      <input
                        placeholder="Optional note (shown to student later if you use it)"
                        value={noteByKey[key] ?? ""}
                        onChange={(e) => setNoteByKey((p) => ({ ...p, [key]: e.target.value }))}
                        style={inputStyle}
                      />

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <OutlineButton
                          onClick={() => decide(r, "APPROVED")}
                          disabled={workingKey === key}
                        >
                          {workingKey === key ? "Working…" : "Approve"}
                        </OutlineButton>

                        <button
                          onClick={() => decide(r, "REJECTED")}
                          disabled={workingKey === key}
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
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </PageShell>
    </>
  );
}

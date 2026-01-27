"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import {
  fetchAuthSession,
  getCurrentUser,
  signOut,
} from "aws-amplify/auth";

const client = generateClient<Schema>();
type Exam = Schema["MockExam"]["type"];

async function isAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

export default function AdminExamsPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(true);

  const [exams, setExams] = useState<Exam[]>([]);
  const [form, setForm] = useState({ title: "", admissionType: "" });
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const res = await client.models.MockExam.list({ limit: 200 });
    if (res.errors?.length) console.error(res.errors);
    setExams(res.data ?? []);
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
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function createExam() {
    const title = form.title.trim();
    const admissionType = form.admissionType.trim();
    if (!title || !admissionType) {
      alert("Please fill title and admission type.");
      return;
    }

    setCreating(true);
    try {
      const res = await client.models.MockExam.create({ title, admissionType });
      if (res.errors?.length) {
        console.error(res.errors);
        alert("Failed to create exam (check console).");
        return;
      }
      setForm({ title: "", admissionType: "" });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function deleteExam(id: string) {
    if (!confirm("Delete this exam?")) return;

    const res = await client.models.MockExam.delete({ id });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to delete exam.");
      return;
    }
    setExams((prev) => prev.filter((e) => e.id !== id));
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
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>
              Admin • Exams
            </div>

            <div className="small" style={{ marginLeft: 8 }}>
              Create and manage mock exams.
            </div>

            <div style={{ marginLeft: "auto" }}>
              <OutlineButton onClick={() => router.push("/dashboard")}>
                Back to dashboard
              </OutlineButton>
            </div>
          </div>

          <Card>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
              Create exam
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                placeholder="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={creating}
                style={{
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  outline: "none",
                  fontSize: 14,
                }}
              />
              <input
                placeholder="Admission type (e.g. Computer Engineering)"
                value={form.admissionType}
                onChange={(e) => setForm({ ...form, admissionType: e.target.value })}
                disabled={creating}
                style={{
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  outline: "none",
                  fontSize: 14,
                }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <OutlineButton onClick={createExam} disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </OutlineButton>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                  Existing exams
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Click an exam to manage tasks (questions).
                </div>
              </div>
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Refresh
              </OutlineButton>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {loading ? (
                <p className="small" style={{ margin: 0 }}>
                  Loading…
                </p>
              ) : exams.length === 0 ? (
                <p className="small" style={{ margin: 0 }}>
                  No exams yet.
                </p>
              ) : (
                exams.map((e) => (
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

                    <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      <OutlineButton onClick={() => router.push(`/admin/exams/${e.id}`)}>
                        Manage tasks
                      </OutlineButton>

                      <button
                        onClick={() => deleteExam(e.id)}
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
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </PageShell>
    </>
  );
}

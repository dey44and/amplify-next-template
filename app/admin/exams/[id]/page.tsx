"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

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
type Task = Schema["Task"]["type"];

async function isAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

export default function AdminExamDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = useMemo(() => params.id, [params.id]);

  const [loginId, setLoginId] = useState("");
  const [exam, setExam] = useState<Exam | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [savingExam, setSavingExam] = useState(false);
  const [newTask, setNewTask] = useState({
    order: "",
    question: "",
    mark: "",
  });
  const [addingTask, setAddingTask] = useState(false);

  async function refresh() {
    setLoading(true);

    const examRes = await client.models.MockExam.get({ id: examId });
    if (examRes.errors?.length) console.error(examRes.errors);
    setExam(examRes.data ?? null);

    const tasksRes = await client.models.Task.list({
      filter: { examId: { eq: examId } },
      limit: 500,
    });
    if (tasksRes.errors?.length) console.error(tasksRes.errors);

    const data = (tasksRes.data ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    setTasks(data);

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  async function saveExam() {
    if (!exam) return;

    const title = exam.title?.trim() ?? "";
    const admissionType = exam.admissionType?.trim() ?? "";
    if (!title || !admissionType) {
      alert("Title and admission type are required.");
      return;
    }

    setSavingExam(true);
    try {
      const res = await client.models.MockExam.update({
        id: exam.id,
        title,
        admissionType,
      });
      if (res.errors?.length) {
        console.error(res.errors);
        alert("Failed to save exam.");
      } else {
        await refresh();
      }
    } finally {
      setSavingExam(false);
    }
  }

  async function addTask() {
    const orderStr = newTask.order.trim();
    const markStr = newTask.mark.trim();
    const question = newTask.question.trim();

    if (!orderStr || !markStr || !question) {
      alert("Please fill order, mark, question.");
      return;
    }

    const order = Number(orderStr);
    const mark = Number(markStr);

    if (!Number.isInteger(order) || order < 1) {
      alert("Order must be an integer >= 1.");
      return;
    }
    if (!Number.isFinite(mark) || mark <= 0) {
      alert("Mark must be a positive number.");
      return;
    }

    setAddingTask(true);
    try {
      const res = await client.models.Task.create({
        examId,
        order,
        question,
        mark,
      });
      if (res.errors?.length) {
        console.error(res.errors);
        alert("Failed to add task.");
        return;
      }
      setNewTask({ order: "", question: "", mark: "" });
      await refresh();
    } finally {
      setAddingTask(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task?")) return;
    const res = await client.models.Task.delete({ id: taskId });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to delete task.");
      return;
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
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
          <p className="small">Loading…</p>
        ) : !exam ? (
          <p className="small">Exam not found.</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Top row */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>
                Admin • Manage exam
              </div>
              <div className="small" style={{ opacity: 0.75 }}>
                ID: {examId}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <OutlineButton onClick={() => router.push("/admin/exams")}>
                  Back
                </OutlineButton>
                <OutlineButton onClick={saveExam} disabled={savingExam}>
                  {savingExam ? "Saving…" : "Save"}
                </OutlineButton>
              </div>
            </div>

            {/* Exam details */}
            <Card>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                Exam details
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 620 }}>
                <input
                  value={exam.title ?? ""}
                  onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  placeholder="Title"
                  style={{
                    padding: "12px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
                <input
                  value={exam.admissionType ?? ""}
                  onChange={(e) => setExam({ ...exam, admissionType: e.target.value })}
                  placeholder="Admission type"
                  style={{
                    padding: "12px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </div>
            </Card>

            {/* Tasks */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                    Tasks (questions)
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Add questions with an order and mark. (Answer key comes next.)
                  </div>
                </div>
              </div>

              {/* Add task form */}
              <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 780 }}>
                <div style={{ display: "grid", gridTemplateColumns: "160px 160px 1fr", gap: 10 }}>
                  <input
                    placeholder="Order (1, 2, 3...)"
                    value={newTask.order}
                    onChange={(e) => setNewTask({ ...newTask, order: e.target.value })}
                    disabled={addingTask}
                    style={{
                      padding: "12px 12px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                  <input
                    placeholder="Mark (e.g. 1, 2.5)"
                    value={newTask.mark}
                    onChange={(e) => setNewTask({ ...newTask, mark: e.target.value })}
                    disabled={addingTask}
                    style={{
                      padding: "12px 12px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      outline: "none",
                      fontSize: 14,
                    }}
                  />
                  <div />
                </div>

                <textarea
                  placeholder="Question text"
                  value={newTask.question}
                  onChange={(e) => setNewTask({ ...newTask, question: e.target.value })}
                  disabled={addingTask}
                  style={{
                    padding: "12px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    outline: "none",
                    fontSize: 14,
                    minHeight: 110,
                    resize: "vertical",
                  }}
                />

                <div style={{ display: "flex", gap: 10 }}>
                  <OutlineButton onClick={addTask} disabled={addingTask}>
                    {addingTask ? "Adding…" : "Add task"}
                  </OutlineButton>
                </div>
              </div>

              {/* List */}
              <div style={{ marginTop: 16 }}>
                {tasks.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No tasks yet.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          borderTop: "1px solid var(--border)",
                          paddingTop: 12,
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>
                          #{t.order} • {t.mark} points
                        </div>

                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                          {t.question}
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                          <button
                            onClick={() => deleteTask(t.id)}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              fontSize: 13,
                              fontWeight: 700,
                              color: "rgba(0,0,0,0.55)",
                              textDecoration: "underline",
                            }}
                          >
                            Delete task
                          </button>

                          {/* Next step: manage correct answer (TaskKey) here */}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </PageShell>
    </>
  );
}

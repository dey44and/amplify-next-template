"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type Task = Schema["Task"]["type"];
type TaskKey = Schema["TaskKey"]["type"];

async function isAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

/**
 * Convert "YYYY-MM-DDTHH:mm" (datetime-local) to ISO string reliably in local time.
 * Avoids browser quirks around new Date("YYYY-MM-DDTHH:mm").
 */
function localDatetimeToISO(local: string) {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  return dt.toISOString();
}

function isoToLocalDatetimeValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function notNull<T>(x: T | null | undefined): x is T {
  return x != null;
}

export default function AdminExamDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = useMemo(() => params.id, [params.id]);

  const [loginId, setLoginId] = useState("");

  const [exam, setExam] = useState<Exam | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [keysByTaskId, setKeysByTaskId] = useState<Map<string, TaskKey>>(new Map());

  const [loading, setLoading] = useState(true);
  const [savingExam, setSavingExam] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  const [newTask, setNewTask] = useState({
    order: "",
    question: "",
    mark: "",
    correctAnswer: "",
  });

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

  const textAreaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 110,
    resize: "vertical",
  };

  async function refresh() {
    setLoading(true);

    // 1) exam
    const examRes = await client.models.MockExam.get({ id: examId });
    if (examRes.errors?.length) console.error(examRes.errors);
    setExam(examRes.data ?? null);

    // 2) tasks
    const tasksRes = await client.models.Task.list({
      filter: { examId: { eq: examId } },
      limit: 500,
    });
    if (tasksRes.errors?.length) console.error(tasksRes.errors);

    const sortedTasks = (tasksRes.data ?? [])
      .filter(notNull)
      .slice()
      .sort((a: Task, b: Task) => (a.order ?? 0) - (b.order ?? 0));
    setTasks(sortedTasks);

    // 3) keys (single query, then map)
    // This avoids doing N+1 list() calls (one per task), which can randomly fail/race.
    const keysRes = await client.models.TaskKey.list({ limit: 2000 });
    if (keysRes.errors?.length) console.error(keysRes.errors);

    const taskIds = new Set(sortedTasks.map((t) => t.id));
    const m = new Map<string, TaskKey>();
    for (const k of (keysRes.data ?? []).filter(notNull)) {
      const tid = (k as any).taskId as string | undefined;
      if (tid && taskIds.has(tid)) m.set(tid, k);
    }
    setKeysByTaskId(m);

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      // auth gate
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }
      setLoginId(user.signInDetails?.loginId ?? user.username ?? "");

      // admin gate
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
    const startAt = (exam as any).startAt?.trim?.() ?? (exam as any).startAt ?? "";
    const durationMinutes = Number((exam as any).durationMinutes);

    if (!title || !admissionType || !startAt) {
      alert("Title, admission type, and start time are required.");
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      alert("Duration must be a positive integer.");
      return;
    }

    setSavingExam(true);
    try {
      const res = await client.models.MockExam.update({
        id: exam.id,
        title,
        admissionType,
        startAt,
        durationMinutes,
      } as any);

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
    const correctAnswer = newTask.correctAnswer.trim();

    if (!orderStr || !markStr || !question || !correctAnswer) {
      alert("Please fill order, mark, question, and correct answer.");
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
      // 1) Create Task
      const taskRes = await client.models.Task.create({
        examId,
        order,
        question,
        mark,
      });

      if (taskRes.errors?.length || !taskRes.data) {
        console.error(taskRes.errors);
        alert("Failed to add task.");
        return;
      }

      const taskId = taskRes.data.id;

      // 2) Create TaskKey
      const keyRes = await client.models.TaskKey.create({
        taskId,
        correctAnswer,
      });

      // IMPORTANT: treat "no data" as failure too (not just errors)
      if (keyRes.errors?.length || !keyRes.data) {
        console.error(keyRes.errors);
        // rollback task if key failed
        await client.models.Task.delete({ id: taskId });
        alert(
          "Failed to save correct answer (TaskKey). The question was rolled back, so you can try again."
        );
        return;
      }

      setNewTask({ order: "", question: "", mark: "", correctAnswer: "" });
      await refresh();
    } finally {
      setAddingTask(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task?")) return;

    // delete key (if exists) then task
    const k = keysByTaskId.get(taskId);
    if (k?.id) {
      const delKeyRes = await client.models.TaskKey.delete({ id: k.id });
      if (delKeyRes.errors?.length) console.error(delKeyRes.errors);
    } else {
      // fallback: search & delete (in case map is stale)
      const keyRes = await client.models.TaskKey.list({
        filter: { taskId: { eq: taskId } },
        limit: 20,
      });
      if (keyRes.errors?.length) console.error(keyRes.errors);
      for (const kk of (keyRes.data ?? []).filter(notNull)) {
        await client.models.TaskKey.delete({ id: kk.id });
      }
    }

    const res = await client.models.Task.delete({ id: taskId });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Failed to delete task.");
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setKeysByTaskId((prev) => {
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
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
                <OutlineButton onClick={() => router.push("/admin/exams")}>Back</OutlineButton>
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

              <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 720 }}>
                <input
                  value={exam.title ?? ""}
                  onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  placeholder="Title"
                  style={inputStyle}
                />

                <input
                  value={exam.admissionType ?? ""}
                  onChange={(e) => setExam({ ...exam, admissionType: e.target.value })}
                  placeholder="Admission type"
                  style={inputStyle}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 10 }}>
                  <input
                    type="datetime-local"
                    value={isoToLocalDatetimeValue((exam as any).startAt)}
                    onChange={(e) =>
                      setExam({ ...(exam as any), startAt: localDatetimeToISO(e.target.value) })
                    }
                    style={inputStyle}
                  />

                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={(exam as any).durationMinutes ?? ""}
                    onChange={(e) =>
                      setExam({
                        ...(exam as any),
                        durationMinutes: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="Duration (min)"
                    style={inputStyle}
                  />
                </div>

                <div className="small" style={{ opacity: 0.75 }}>
                  Tip: Start time uses your local timezone when editing.
                </div>
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
                    Add questions with an order, mark, and correct answer (admin-only).
                  </div>
                </div>
              </div>

              {/* Add task form */}
              <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 860 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "160px 160px 1fr",
                    gap: 10,
                  }}
                >
                  <input
                    placeholder="Order (1, 2, 3...)"
                    value={newTask.order}
                    onChange={(e) => setNewTask({ ...newTask, order: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Mark (e.g. 1, 2.5)"
                    value={newTask.mark}
                    onChange={(e) => setNewTask({ ...newTask, mark: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Correct answer"
                    value={newTask.correctAnswer}
                    onChange={(e) => setNewTask({ ...newTask, correctAnswer: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                </div>

                <textarea
                  placeholder="Question text"
                  value={newTask.question}
                  onChange={(e) => setNewTask({ ...newTask, question: e.target.value })}
                  disabled={addingTask}
                  style={textAreaStyle}
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
                    {tasks.map((t) => {
                      const key = keysByTaskId.get(t.id);
                      const correctAnswer = (key as any)?.correctAnswer as string | undefined;

                      return (
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

                          <div className="small" style={{ opacity: 0.85 }}>
                            <span style={{ fontWeight: 800 }}>Correct answer:</span>{" "}
                            {correctAnswer ? (
                              <span>{correctAnswer}</span>
                            ) : (
                              <span style={{ opacity: 0.7 }}>
                                (missing TaskKey — not saved or not readable)
                              </span>
                            )}
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
                          </div>
                        </div>
                      );
                    })}
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

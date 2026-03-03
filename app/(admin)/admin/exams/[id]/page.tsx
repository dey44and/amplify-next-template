"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { isAdmin } from "@/lib/isAdmin";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type Task = Schema["Task"]["type"];
type TaskKey = Schema["TaskKey"]["type"];

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

export default function AdminExamDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = useMemo(() => params.id, [params.id]);

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
    topic: "",
    authorDifficulty: "MEDIUM",
    optionsCount: "4",
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
      const tid = k.taskId;
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
    const startAt = exam.startAt?.trim() ?? "";
    const durationMinutes = Number(exam.durationMinutes);

    if (!title || !admissionType || !startAt) {
      alert("Titlul, tipul de admitere și ora de start sunt obligatorii.");
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      alert("Durata trebuie să fie un număr întreg pozitiv.");
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
      });

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Salvarea simulării a eșuat.");
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
    const topic = newTask.topic.trim();
    const authorDifficulty = newTask.authorDifficulty.trim().toUpperCase();
    const optionsCount = Number(newTask.optionsCount);

    if (!orderStr || !markStr || !question || !correctAnswer || !topic) {
      alert("Completează ordinea, punctajul, întrebarea, răspunsul corect și topicul.");
      return;
    }

    const order = Number(orderStr);
    const mark = Number(markStr);

    if (!Number.isInteger(order) || order < 1) {
      alert("Ordinea trebuie să fie un număr întreg >= 1.");
      return;
    }
    if (!Number.isFinite(mark) || mark <= 0) {
      alert("Punctajul trebuie să fie un număr pozitiv.");
      return;
    }
    if (optionsCount !== 4 && optionsCount !== 6) {
      alert("Numărul de opțiuni trebuie să fie 4 sau 6.");
      return;
    }
    if (!["EASY", "MEDIUM", "HARD"].includes(authorDifficulty)) {
      alert("Dificultatea trebuie să fie EASY, MEDIUM sau HARD.");
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
        topic,
        authorDifficulty,
        optionsCount,
      });

      if (taskRes.errors?.length || !taskRes.data) {
        console.error(taskRes.errors);
        alert("Adăugarea itemului a eșuat.");
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
          "Salvarea răspunsului corect (TaskKey) a eșuat. Întrebarea a fost anulată, ca să poți încerca din nou."
        );
        return;
      }

      setNewTask({
        order: "",
        question: "",
        mark: "",
        correctAnswer: "",
        topic: "",
        authorDifficulty: "MEDIUM",
        optionsCount: "4",
      });
      await refresh();
    } finally {
      setAddingTask(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Ștergi acest item?")) return;

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
      alert("Ștergerea itemului a eșuat.");
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
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă…</p>
        ) : !exam ? (
          <p className="small">Simularea nu a fost găsită.</p>
        ) : (
          <div className="panel-stack">
            {/* Top row */}
            <div className="panel-top-row">
              <div className="page-title">Administrator • Gestionare simulare</div>
              <div className="small" style={{ opacity: 0.75 }}>
                ID: {examId}
              </div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/admin/exams")}>Înapoi</OutlineButton>
                <OutlineButton onClick={saveExam} disabled={savingExam}>
                  {savingExam ? "Se salvează…" : "Salvează"}
                </OutlineButton>
              </div>
            </div>

            {/* Exam details */}
            <Card>
              <div className="section-title">Detalii simulare</div>

              <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 720 }}>
                <input
                  value={exam.title ?? ""}
                  onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  placeholder="Titlu"
                  style={inputStyle}
                />

                <input
                  value={exam.admissionType ?? ""}
                  onChange={(e) => setExam({ ...exam, admissionType: e.target.value })}
                  placeholder="Tip admitere"
                  style={inputStyle}
                />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 10 }}>
                  <input
                    type="datetime-local"
                    value={isoToLocalDatetimeValue(exam.startAt)}
                    onChange={(e) =>
                      setExam({ ...exam, startAt: localDatetimeToISO(e.target.value) })
                    }
                    style={inputStyle}
                  />

                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={exam.durationMinutes ?? ""}
                    onChange={(e) =>
                      setExam({
                        ...exam,
                        durationMinutes: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="Durată (min)"
                    style={inputStyle}
                  />
                </div>

                <div className="small" style={{ opacity: 0.75 }}>
                  Sfat: ora de start folosește fusul tău orar local la editare.
                </div>
              </div>
            </Card>

            {/* Tasks */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="section-title">Itemi (întrebări)</div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Adaugă întrebări cu ordine, punctaj, răspuns corect și topic.
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
                    placeholder="Ordine (1, 2, 3...)"
                    value={newTask.order}
                    onChange={(e) => setNewTask({ ...newTask, order: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Punctaj (ex.: 1, 2.5)"
                    value={newTask.mark}
                    onChange={(e) => setNewTask({ ...newTask, mark: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Răspuns corect"
                    value={newTask.correctAnswer}
                    onChange={(e) => setNewTask({ ...newTask, correctAnswer: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 180px 160px",
                    gap: 10,
                  }}
                >
                  <input
                    placeholder="Topic (ex.: Algebră)"
                    value={newTask.topic}
                    onChange={(e) => setNewTask({ ...newTask, topic: e.target.value })}
                    disabled={addingTask}
                    style={inputStyle}
                  />
                  <select
                    value={newTask.authorDifficulty}
                    onChange={(e) =>
                      setNewTask({ ...newTask, authorDifficulty: e.target.value })
                    }
                    disabled={addingTask}
                    style={inputStyle}
                  >
                    <option value="EASY">Dificultate: EASY</option>
                    <option value="MEDIUM">Dificultate: MEDIUM</option>
                    <option value="HARD">Dificultate: HARD</option>
                  </select>
                  <select
                    value={newTask.optionsCount}
                    onChange={(e) =>
                      setNewTask({ ...newTask, optionsCount: e.target.value })
                    }
                    disabled={addingTask}
                    style={inputStyle}
                  >
                    <option value="4">4 opțiuni</option>
                    <option value="6">6 opțiuni</option>
                  </select>
                </div>

                <textarea
                  placeholder="Text întrebare"
                  value={newTask.question}
                  onChange={(e) => setNewTask({ ...newTask, question: e.target.value })}
                  disabled={addingTask}
                  style={textAreaStyle}
                />

                <div className="small" style={{ opacity: 0.78 }}>
                  Poți folosi formule LaTeX: inline cu <code>$...$</code> sau bloc cu <code>$$...$$</code>.
                </div>

                {newTask.question.trim() ? (
                  <div
                    style={{
                      border: "1px dashed var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "var(--surface-soft)",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div className="small" style={{ opacity: 0.78 }}>
                      Previzualizare întrebare
                    </div>
                    <MathText className="task-question-text" text={newTask.question} />
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 10 }}>
                  <OutlineButton onClick={addTask} disabled={addingTask}>
                    {addingTask ? "Se adaugă…" : "Adaugă item"}
                  </OutlineButton>
                </div>
              </div>

              {/* List */}
              <div style={{ marginTop: 16 }}>
                {tasks.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există itemi încă.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {tasks.map((t) => {
                      const key = keysByTaskId.get(t.id);
                      const correctAnswer = key?.correctAnswer;

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
                          <div style={{ fontWeight: 760 }}>
                            #{t.order} • {t.mark} puncte
                          </div>

                          <div className="small" style={{ opacity: 0.9 }}>
                            Topic: {t.topic || "General"} • Dificultate:{" "}
                            {t.authorDifficulty || "MEDIUM"} • Opțiuni:{" "}
                            {t.optionsCount ?? 4}
                          </div>

                          <MathText className="task-question-text" text={String(t.question ?? "")} />

                          <div className="small" style={{ opacity: 0.85 }}>
                            <span style={{ fontWeight: 700 }}>Răspuns corect:</span>{" "}
                            {correctAnswer ? (
                              <MathText inline text={correctAnswer} />
                            ) : (
                              <span style={{ opacity: 0.7 }}>
                                (lipsește TaskKey — nu a fost salvat sau nu poate fi citit)
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
                              Șterge item
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

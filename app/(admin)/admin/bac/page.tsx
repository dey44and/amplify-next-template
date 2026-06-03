"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];

type BacSimulationForm = {
  title: string;
  subject: string;
  startAt: string;
  durationMinutes: string;
  maxGrade: string;
  instructions: string;
  promptText: string;
};

const emptyForm: BacSimulationForm = {
  title: "",
  subject: "",
  startAt: "",
  durationMinutes: "",
  maxGrade: "10",
  instructions: "",
  promptText: "",
};

function localDatetimeToISO(local: string) {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  return dt.toISOString();
}

function isoToLocalDatetime(iso?: string | null) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";

  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  ].join("T");
}

export default function AdminBacPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingSimulation, setSavingSimulation] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [simulations, setSimulations] = useState<BacSimulation[]>([]);
  const [form, setForm] = useState<BacSimulationForm>(emptyForm);

  async function refresh() {
    setLoading(true);
    const res = await client.models.BacSimulation.list({ limit: 500 });
    if (res.errors?.length) console.error(res.errors);
    setSimulations((res.data ?? []).filter(notNull));
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((err) => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const sortedSimulations = useMemo(
    () =>
      simulations
        .slice()
        .sort((a, b) => toTimestamp(b.startAt) - toTimestamp(a.startAt)),
    [simulations]
  );

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  function editSimulation(simulation: BacSimulation) {
    setEditingId(simulation.id);
    setForm({
      title: simulation.title ?? "",
      subject: simulation.subject ?? "",
      startAt: isoToLocalDatetime(simulation.startAt),
      durationMinutes:
        simulation.durationMinutes != null ? String(simulation.durationMinutes) : "",
      maxGrade: simulation.maxGrade != null ? String(simulation.maxGrade) : "10",
      instructions: simulation.instructions ?? "",
      promptText: simulation.promptText ?? "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSimulation() {
    const title = form.title.trim();
    const subject = form.subject.trim();
    const startAtLocal = form.startAt.trim();
    const duration = Number(form.durationMinutes);
    const maxGrade = Number(form.maxGrade || 10);

    if (!title || !subject || !startAtLocal || !form.durationMinutes.trim()) {
      alert("Completează titlul, materia, ora de start și durata.");
      return;
    }
    if (!Number.isInteger(duration) || duration <= 0) {
      alert("Durata trebuie să fie un număr întreg pozitiv.");
      return;
    }
    if (!Number.isFinite(maxGrade) || maxGrade <= 0) {
      alert("Punctajul maxim trebuie să fie pozitiv.");
      return;
    }

    setSavingSimulation(true);
    try {
      const payload = {
        title,
        subject,
        startAt: localDatetimeToISO(startAtLocal),
        durationMinutes: duration,
        maxGrade,
        instructions: form.instructions.trim() || null,
        promptText: form.promptText.trim() || null,
      };

      const res = editingId
        ? await client.models.BacSimulation.update({
            id: editingId,
            ...payload,
          })
        : await client.models.BacSimulation.create(payload);

      if (res.errors?.length) {
        console.error(res.errors);
        alert(
          editingId
            ? "Actualizarea simulării Bac a eșuat."
            : "Crearea simulării Bac a eșuat."
        );
        return;
      }

      resetForm();
      await refresh();
    } finally {
      setSavingSimulation(false);
    }
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack bac-page bac-page--admin">
          <section className="bac-hero bac-hero--admin">
            <div className="bac-hero-copy">
              <div className="bac-kicker">Administrator</div>
              <div className="bac-title">Bacalaureat</div>
              <div className="bac-subtitle">
                Subiecte scrise, lucrări încărcate și evaluare manuală.
              </div>
            </div>
            <div className="panel-actions">
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Reîncarcă
              </OutlineButton>
            </div>
          </section>

          <Card className="bac-card">
            <div className="section-title">
              {editingId ? "Editează simulare Bac" : "Creează simulare Bac"}
            </div>
            {editingId ? (
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Modificările se aplică simulării selectate. Lucrările deja trimise rămân atașate.
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 820 }}>
              <input
                placeholder="Titlu"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={savingSimulation}
                className="field-input"
              />

              <input
                placeholder="Materie (ex.: Matematică M1, Română)"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                disabled={savingSimulation}
                className="field-input"
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 10,
                }}
              >
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  disabled={savingSimulation}
                  className="field-input"
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Durată (min)"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  disabled={savingSimulation}
                  className="field-input"
                />
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  placeholder="Max"
                  value={form.maxGrade}
                  onChange={(e) => setForm({ ...form, maxGrade: e.target.value })}
                  disabled={savingSimulation}
                  className="field-input"
                />
              </div>

              <textarea
                placeholder="Instrucțiuni pentru elevi"
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                disabled={savingSimulation}
                className="field-input"
                style={{ minHeight: 90, resize: "vertical" }}
              />

              <textarea
                placeholder="Subiect / cerințe (poate conține LaTeX)"
                value={form.promptText}
                onChange={(e) => setForm({ ...form, promptText: e.target.value })}
                disabled={savingSimulation}
                className="field-input"
                style={{ minHeight: 130, resize: "vertical" }}
              />

              {form.promptText.trim() ? (
                <div className="exam-item">
                  <div className="small" style={{ opacity: 0.78 }}>
                    Previzualizare subiect
                  </div>
                  <MathText className="task-question-text" text={form.promptText} />
                </div>
              ) : null}

              <div className="exam-actions">
                <OutlineButton onClick={saveSimulation} disabled={savingSimulation}>
                  {savingSimulation
                    ? editingId
                      ? "Se salvează…"
                      : "Se creează…"
                    : editingId
                    ? "Salvează modificările"
                    : "Creează"}
                </OutlineButton>
                {editingId ? (
                  <OutlineButton onClick={resetForm} disabled={savingSimulation}>
                    Anulează editarea
                  </OutlineButton>
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="bac-card">
            <div className="section-title">Simulări Bac existente</div>

            <div className="exam-list" style={{ marginTop: 14 }}>
              {loading ? (
                <p className="small" style={{ margin: 0 }}>
                  Se încarcă…
                </p>
              ) : sortedSimulations.length === 0 ? (
                <p className="small" style={{ margin: 0 }}>
                  Nu există simulări Bac încă.
                </p>
              ) : (
                sortedSimulations.map((simulation) => (
                  <div key={simulation.id} className="exam-item">
                    <div className="exam-item-title">{simulation.title}</div>
                    <div className="small">Materie: {simulation.subject}</div>
                    <div className="small" style={{ opacity: 0.85 }}>
                      Începe: {formatWhen(simulation.startAt)} • Durată:{" "}
                      {simulation.durationMinutes ?? "—"} min • Max:{" "}
                      {simulation.maxGrade ?? 10}
                    </div>
                    <div className="exam-actions">
                      <OutlineButton onClick={() => editSimulation(simulation)}>
                        Editează
                      </OutlineButton>
                      <OutlineButton onClick={() => router.push(`/admin/bac/${simulation.id}`)}>
                        Evaluări
                      </OutlineButton>
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

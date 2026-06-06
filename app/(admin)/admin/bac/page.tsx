"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { remove } from "aws-amplify/storage";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacSimulationContent = Schema["BacSimulationContent"]["type"];

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
  const [loadingContentForEdit, setLoadingContentForEdit] = useState(false);
  const [deletingSimulationId, setDeletingSimulationId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [simulations, setSimulations] = useState<BacSimulation[]>([]);
  const [form, setForm] = useState<BacSimulationForm>(emptyForm);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  async function refresh() {
    setLoading(true);
    const canLoadBac = hasBacModels(client.models);
    setBacBackendAvailable(canLoadBac);

    if (!canLoadBac) {
      setSimulations([]);
      setLoading(false);
      return;
    }

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

  async function editSimulation(simulation: BacSimulation) {
    if (!bacBackendAvailable) return;

    setLoadingContentForEdit(true);
    setEditingId(simulation.id);
    setForm({
      title: simulation.title ?? "",
      subject: simulation.subject ?? "",
      startAt: isoToLocalDatetime(simulation.startAt),
      durationMinutes:
        simulation.durationMinutes != null ? String(simulation.durationMinutes) : "",
      maxGrade: simulation.maxGrade != null ? String(simulation.maxGrade) : "10",
      instructions: "",
      promptText: "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const contentRes = await client.models.BacSimulationContent.get({
        simulationId: simulation.id,
      });
      if (contentRes.errors?.length) console.error(contentRes.errors);
      const content = contentRes.data as BacSimulationContent | null;
      setForm((current) => ({
        ...current,
        instructions: content?.instructions ?? "",
        promptText: content?.promptText ?? "",
      }));
    } finally {
      setLoadingContentForEdit(false);
    }
  }

  async function saveSimulation() {
    if (!bacBackendAvailable) {
      alert("Modelele Bac nu sunt disponibile în configurația Amplify curentă.");
      return;
    }

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

      const simulationId = editingId ?? res.data?.id;
      if (!simulationId) {
        alert("Simularea a fost salvată, dar conținutul nu a putut fi asociat.");
        return;
      }

      const contentPayload = {
        simulationId,
        instructions: form.instructions.trim() || null,
        promptText: form.promptText.trim() || null,
      };
      const existingContent = await client.models.BacSimulationContent.get({ simulationId });
      const contentRes = existingContent.data
        ? await client.models.BacSimulationContent.update(contentPayload)
        : await client.models.BacSimulationContent.create(contentPayload);

      if (contentRes.errors?.length) {
        console.error(contentRes.errors);
        alert("Simularea a fost salvată, dar salvarea subiectului a eșuat.");
        return;
      }

      resetForm();
      await refresh();
    } finally {
      setSavingSimulation(false);
    }
  }

  async function deleteSimulation(simulation: BacSimulation) {
    if (!bacBackendAvailable) {
      alert("Modelele Bac nu sunt disponibile în configurația Amplify curentă.");
      return;
    }

    const id = simulation.id;
    if (
      !confirm(
        "Ștergi această simulare Bac? Vor fi șterse și cererile, accesările, lucrările încărcate și evaluările asociate."
      )
    ) {
      return;
    }

    setDeletingSimulationId(id);
    try {
      const contentRes = await client.models.BacSimulationContent.get({ simulationId: id });
      if (contentRes.errors?.length) {
        console.error(contentRes.errors);
        alert("Nu am putut verifica subiectul pentru ștergere.");
        return;
      }
      if (contentRes.data) {
        const deleteContentRes = await client.models.BacSimulationContent.delete({
          simulationId: id,
        });
        if (deleteContentRes.errors?.length) {
          console.error(deleteContentRes.errors);
          alert("Ștergerea subiectului Bac a eșuat.");
          return;
        }
      }

      const requestRes = await client.models.BacRequest.list({
        filter: { simulationId: { eq: id } },
        limit: 2000,
      });
      if (requestRes.errors?.length) {
        console.error(requestRes.errors);
        alert("Nu am putut încărca cererile Bac pentru ștergere.");
        return;
      }
      for (const row of (requestRes.data ?? []).filter(notNull)) {
        const deleteRequestRes = await client.models.BacRequest.delete({
          owner: row.owner,
          simulationId: id,
        });
        if (deleteRequestRes.errors?.length) {
          console.error(deleteRequestRes.errors);
          alert("Nu am putut șterge toate cererile Bac.");
          return;
        }
      }

      const accessRes = await client.models.BacAccess.list({
        filter: { simulationId: { eq: id } },
        limit: 2000,
      });
      if (accessRes.errors?.length) {
        console.error(accessRes.errors);
        alert("Nu am putut încărca accesările Bac pentru ștergere.");
        return;
      }
      for (const row of (accessRes.data ?? []).filter(notNull)) {
        const deleteAccessRes = await client.models.BacAccess.delete({
          owner: row.owner,
          simulationId: id,
        });
        if (deleteAccessRes.errors?.length) {
          console.error(deleteAccessRes.errors);
          alert("Nu am putut șterge toate accesările Bac.");
          return;
        }
      }

      const evaluationRes = await client.models.BacEvaluation.list({
        filter: { simulationId: { eq: id } },
        limit: 2000,
      });
      if (evaluationRes.errors?.length) {
        console.error(evaluationRes.errors);
        alert("Nu am putut încărca evaluările Bac pentru ștergere.");
        return;
      }
      for (const row of (evaluationRes.data ?? []).filter(notNull)) {
        const deleteEvaluationRes = await client.models.BacEvaluation.delete({
          submissionOwner: row.submissionOwner,
          simulationId: id,
        });
        if (deleteEvaluationRes.errors?.length) {
          console.error(deleteEvaluationRes.errors);
          alert("Nu am putut șterge toate evaluările Bac.");
          return;
        }
      }

      const submissionRes = await client.models.BacSubmission.list({
        filter: { simulationId: { eq: id } },
        limit: 2000,
      });
      if (submissionRes.errors?.length) {
        console.error(submissionRes.errors);
        alert("Nu am putut încărca lucrările Bac pentru ștergere.");
        return;
      }
      for (const row of (submissionRes.data ?? []).filter(notNull)) {
        if (row.solutionFilePath) {
          await remove({ path: row.solutionFilePath });
        }

        const deleteSubmissionRes = await client.models.BacSubmission.delete({
          owner: row.owner,
          simulationId: id,
        });
        if (deleteSubmissionRes.errors?.length) {
          console.error(deleteSubmissionRes.errors);
          alert("Nu am putut șterge toate lucrările Bac.");
          return;
        }
      }

      const deleteSimulationRes = await client.models.BacSimulation.delete({ id });
      if (deleteSimulationRes.errors?.length) {
        console.error(deleteSimulationRes.errors);
        alert("Ștergerea simulării Bac a eșuat.");
        return;
      }

      if (editingId === id) resetForm();
      setSimulations((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error(error);
      alert("Ștergerea simulării Bac a eșuat.");
    } finally {
      setDeletingSimulationId((current) => (current === id ? null : current));
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
            {!bacBackendAvailable ? (
              <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                Modelele Bac nu sunt în configurația Amplify curentă. Regenerază{" "}
                <code>amplify_outputs.json</code> după ce backendul cu Bac este deployat.
              </div>
            ) : null}
            {editingId ? (
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Modificările se aplică simulării selectate. Lucrările deja trimise rămân atașate.
                {loadingContentForEdit ? " Se încarcă subiectul…" : ""}
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 820 }}>
              <input
                placeholder="Titlu"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={savingSimulation || !bacBackendAvailable}
                className="field-input"
              />

              <input
                placeholder="Materie (ex.: Matematică M1, Română)"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                disabled={savingSimulation || !bacBackendAvailable}
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
                  disabled={savingSimulation || !bacBackendAvailable}
                  className="field-input"
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Durată (min)"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  disabled={savingSimulation || !bacBackendAvailable}
                  className="field-input"
                />
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  placeholder="Max"
                  value={form.maxGrade}
                  onChange={(e) => setForm({ ...form, maxGrade: e.target.value })}
                  disabled={savingSimulation || !bacBackendAvailable}
                  className="field-input"
                />
              </div>

              <textarea
                placeholder="Instrucțiuni pentru elevi"
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                disabled={savingSimulation || !bacBackendAvailable}
                className="field-input"
                style={{ minHeight: 90, resize: "vertical" }}
              />

              <textarea
                placeholder="Subiect / cerințe (poate conține LaTeX)"
                value={form.promptText}
                onChange={(e) => setForm({ ...form, promptText: e.target.value })}
                disabled={savingSimulation || !bacBackendAvailable}
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
                <OutlineButton onClick={saveSimulation} disabled={savingSimulation || !bacBackendAvailable}>
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
              ) : !bacBackendAvailable ? (
                <p className="small" style={{ margin: 0 }}>
                  Simulările Bac nu pot fi încărcate până când configurația Amplify include modelele Bac.
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
                        {loadingContentForEdit && editingId === simulation.id
                          ? "Se încarcă…"
                          : "Editează"}
                      </OutlineButton>
                      <OutlineButton onClick={() => router.push(`/admin/bac/${simulation.id}`)}>
                        Evaluări
                      </OutlineButton>
                      <button
                        onClick={() => deleteSimulation(simulation)}
                        disabled={deletingSimulationId === simulation.id}
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
                        {deletingSimulationId === simulation.id ? "Se șterge…" : "Șterge"}
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

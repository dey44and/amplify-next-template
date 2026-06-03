"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen } from "@/lib/dateTime";
import { getExamWindow } from "@/lib/examWindow";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { getUrl, uploadData } from "aws-amplify/storage";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SUBMIT_GRACE_MS = 15 * 60_000;

function safeFileName(name: string) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "solutie.pdf";
}

function mapBacSubmitError(raw?: string) {
  const msg = String(raw ?? "");
  if (msg.includes("BAC_NOT_STARTED")) return "Simularea nu a început încă.";
  if (msg.includes("BAC_ENDED")) return "Intervalul de trimitere s-a încheiat.";
  if (msg.includes("BAC_ALREADY_GRADED")) return "Lucrarea a fost deja evaluată.";
  if (msg.includes("BAC_INVALID_FILE_SIZE")) return "Fișierul trebuie să fie între 1B și 25MB.";
  if (msg.includes("BAC_INVALID_WINDOW")) {
    return "Programul simulării este invalid. Contactează administratorul.";
  }
  return raw ?? "Trimiterea soluției a eșuat.";
}

export default function BacSimulationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const simulationId = useMemo(() => String(params.id ?? ""), [params.id]);

  const [userId, setUserId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<BacSimulation | null>(null);
  const [submission, setSubmission] = useState<BacSubmission | null>(null);
  const [evaluation, setEvaluation] = useState<BacEvaluation | null>(null);

  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [studentNote, setStudentNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function refresh(currentUserId: string) {
    const [simulationRes, submissionRes, evaluationRes] = await Promise.all([
      client.models.BacSimulation.get({ id: simulationId }),
      client.models.BacSubmission.get({ owner: currentUserId, simulationId }),
      client.models.BacEvaluation.get({
        submissionOwner: currentUserId,
        simulationId,
      }),
    ]);

    if (simulationRes.errors?.length) console.error(simulationRes.errors);
    if (submissionRes.errors?.length) console.error(submissionRes.errors);
    if (evaluationRes.errors?.length) console.error(evaluationRes.errors);

    setSimulation(simulationRes.data ?? null);
    setSubmission(submissionRes.data ?? null);
    setEvaluation(evaluationRes.data ?? null);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      let currentUserId: string;
      try {
        currentUserId = (await getCurrentUser()).userId;
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

      setUserId(currentUserId);
      await refresh(currentUserId);
      if (!cancelled) setLoading(false);
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, simulationId]);

  const { startMs, endMs } = useMemo(
    () => getExamWindow(simulation ?? {}),
    [simulation]
  );

  const isBefore = Number.isFinite(startMs) ? nowMs < startMs : false;
  const isOpen =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? nowMs >= startMs && nowMs <= endMs + SUBMIT_GRACE_MS
      : false;
  const isAfter = Number.isFinite(endMs) ? nowMs > endMs + SUBMIT_GRACE_MS : false;
  const isGraded = evaluation?.status === "GRADED";

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSubmitError(null);
    setUploadProgress(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      event.target.value = "";
      setSubmitError("Alege un fișier între 1B și 25MB.");
      return;
    }

    setSelectedFile(file);
  }

  async function openSubmittedFile() {
    const path = submission?.solutionFilePath;
    if (!path) return;

    const res = await getUrl({
      path,
      options: {
        expiresIn: 300,
        contentDisposition: {
          type: "attachment",
          filename: submission.solutionOriginalName ?? "solutie.pdf",
        },
      },
    });
    window.open(res.url.toString(), "_blank", "noopener,noreferrer");
  }

  async function submitSolution() {
    if (!simulation || !userId || !selectedFile) return;

    setUploading(true);
    setSubmitError(null);
    setUploadProgress(0);

    try {
      const session = await fetchAuthSession();
      const identityId = session.identityId;
      if (!identityId) throw new Error("BAC_IDENTITY_UNAVAILABLE");

      const objectPath = [
        "bac-submissions",
        identityId,
        userId,
        simulation.id,
        `${Date.now()}-${safeFileName(selectedFile.name)}`,
      ].join("/");

      await uploadData({
        path: objectPath,
        data: selectedFile,
        options: {
          contentType: selectedFile.type || "application/octet-stream",
          contentDisposition: {
            type: "attachment",
            filename: selectedFile.name,
          },
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (!totalBytes) return;
            setUploadProgress(Math.round((transferredBytes / totalBytes) * 100));
          },
        },
      }).result;

      const res = await client.mutations.submitBacSubmission({
        simulationId: simulation.id,
        solutionFilePath: objectPath,
        solutionOriginalName: selectedFile.name,
        solutionContentType: selectedFile.type || "application/octet-stream",
        solutionSizeBytes: selectedFile.size,
        studentNote: studentNote.trim() || undefined,
      });

      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        setSubmitError(mapBacSubmitError(res.errors?.[0]?.message));
        return;
      }

      setSubmission(res.data);
      setSelectedFile(null);
      setStudentNote("");
      setUploadProgress(null);
    } catch (err) {
      console.error(err);
      setSubmitError(
        err instanceof Error && err.message === "BAC_IDENTITY_UNAVAILABLE"
          ? "Nu am putut obține identitatea pentru încărcarea fișierului."
          : "Încărcarea soluției a eșuat."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă simularea Bac…</p>
        ) : !simulation ? (
          <Card>
            <div className="section-title">Simularea nu a fost găsită</div>
            <div style={{ marginTop: 12 }}>
              <OutlineButton onClick={() => router.push("/bac")}>Înapoi</OutlineButton>
            </div>
          </Card>
        ) : (
          <div className="panel-stack bac-page">
            <section className="bac-hero bac-hero--compact">
              <div className="bac-hero-copy">
                <div className="bac-kicker">{simulation.subject}</div>
                <div className="bac-title">{simulation.title}</div>
                <div className="bac-subtitle">
                  {formatWhen(simulation.startAt)} • {simulation.durationMinutes ?? "—"} min •{" "}
                  Max {simulation.maxGrade ?? 10}
                </div>
              </div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/bac")}>Înapoi</OutlineButton>
              </div>
            </section>

            <Card className="bac-card">
              <div className="section-title">Detalii simulare</div>
              <div className="small" style={{ marginTop: 8 }}>
                Materie: {simulation.subject} • Începe: {formatWhen(simulation.startAt)} • Durată:{" "}
                {simulation.durationMinutes ?? "—"} min • Punctaj maxim:{" "}
                {simulation.maxGrade ?? 10}
              </div>

              {simulation.instructions ? (
                <div className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
                  {simulation.instructions}
                </div>
              ) : null}

              {simulation.promptText ? (
                <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <div className="section-title">Subiect</div>
                  <MathText className="task-question-text" text={simulation.promptText} />
                </div>
              ) : null}
            </Card>

            <Card className="bac-card">
              <div className="section-title">Soluția ta</div>
              <div className="small" style={{ marginTop: 8 }}>
                {isBefore
                  ? "Simularea nu a început încă."
                  : isOpen
                  ? "Poți încărca documentul soluției în intervalul deschis."
                  : isAfter
                  ? "Intervalul de trimitere s-a încheiat."
                  : "Programul nu poate fi determinat."}
              </div>

              {submission ? (
                <div className="exam-item" style={{ marginTop: 14 }}>
                  <div className="exam-item-title">Soluție trimisă</div>
                  <div className="small">
                    Fișier: {submission.solutionOriginalName ?? "solutie"} • Trimis:{" "}
                    {formatWhen(submission.submittedAt)}
                  </div>
                  {submission.studentNote ? (
                    <div className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                      Notă elev: {submission.studentNote}
                    </div>
                  ) : null}
                  <div className="exam-actions">
                    <OutlineButton onClick={openSubmittedFile}>Descarcă soluția</OutlineButton>
                  </div>
                </div>
              ) : null}

              {isOpen && !isGraded ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 620 }}>
                  <label className="field-label" htmlFor="bac-solution-file">
                    Document soluție
                  </label>
                  <input
                    id="bac-solution-file"
                    type="file"
                    accept=".pdf,.doc,.docx,image/*"
                    onChange={onFileChange}
                    disabled={uploading}
                    className="field-input"
                  />

                  <label className="field-label" htmlFor="bac-student-note">
                    Notă pentru evaluator
                  </label>
                  <textarea
                    id="bac-student-note"
                    value={studentNote}
                    onChange={(e) => setStudentNote(e.target.value)}
                    disabled={uploading}
                    className="field-input"
                    style={{ minHeight: 90, resize: "vertical" }}
                  />

                  {uploadProgress != null ? (
                    <div className="small">Încărcare: {uploadProgress}%</div>
                  ) : null}

                  {submitError ? (
                    <div className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
                      {submitError}
                    </div>
                  ) : null}

                  <div>
                    <OutlineButton
                      onClick={submitSolution}
                      disabled={uploading || !selectedFile}
                    >
                      {uploading
                        ? "Se încarcă…"
                        : submission
                        ? "Înlocuiește soluția"
                        : "Trimite soluția"}
                    </OutlineButton>
                  </div>
                </div>
              ) : isGraded ? (
                <div className="small" style={{ marginTop: 12 }}>
                  Lucrarea a fost evaluată, deci soluția nu mai poate fi înlocuită.
                </div>
              ) : null}
            </Card>

            {evaluation ? (
              <Card className="bac-card bac-grade-card">
                <div className="section-title">Evaluare</div>
                <div className="small" style={{ marginTop: 8 }}>
                  Status: {evaluation.status ?? "DRAFT"}
                </div>
                {evaluation.status === "GRADED" ? (
                  <>
                    <div style={{ marginTop: 8, fontSize: 26, fontWeight: 760 }}>
                      {evaluation.manualGrade ?? "—"} /{" "}
                      {evaluation.maxGrade ?? simulation.maxGrade ?? 10}
                    </div>
                    {evaluation.evaluationNotes ? (
                      <div className="small" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                        {evaluation.evaluationNotes}
                      </div>
                    ) : null}
                    <div className="small" style={{ marginTop: 8 }}>
                      Evaluat la: {formatWhen(evaluation.gradedAt)}
                    </div>
                  </>
                ) : (
                  <div className="small" style={{ marginTop: 8 }}>
                    Evaluarea este în lucru.
                  </div>
                )}
              </Card>
            ) : null}
          </div>
        )}
      </PageShell>
    </>
  );
}

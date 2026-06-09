"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen, toTimestamp } from "@/lib/dateTime";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { getUrl, uploadData } from "aws-amplify/storage";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacSimulationContentView = Schema["BacSimulationContentView"]["type"];
type BacRequest = Schema["BacRequest"]["type"];
type BacAccess = Schema["BacAccess"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SUBMIT_GRACE_MS = 15 * 60_000;

function getBacWindow(simulation?: BacSimulation | null) {
  const startMs = simulation?.startAt ? toTimestamp(simulation.startAt) : Number.NaN;
  const startWindowMinutes = Number(
    simulation?.accessWindowMinutes ?? simulation?.durationMinutes ?? 0
  );
  const startWindowEndMs =
    Number.isFinite(startMs) && Number.isFinite(startWindowMinutes)
      ? startMs + startWindowMinutes * 60_000
      : Number.NaN;

  return { startMs, startWindowMinutes, startWindowEndMs };
}

function formatLatestStartAt(simulation?: BacSimulation | null) {
  const { startWindowEndMs } = getBacWindow(simulation);
  return Number.isFinite(startWindowEndMs)
    ? formatWhen(new Date(startWindowEndMs).toISOString())
    : formatWhen(null);
}

function optionalTimestamp(iso?: string | null) {
  if (!iso) return Number.NaN;
  const ms = toTimestamp(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function formatRemaining(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function safeFileName(name: string) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "solutie.pdf";
}

function mapBacSubmitError(raw?: string) {
  const msg = String(raw ?? "");
  if (msg.includes("BAC_NOT_STARTED")) return "Simularea nu a început încă.";
  if (msg.includes("BAC_ENDED")) return "Timpul personal de lucru s-a încheiat.";
  if (msg.includes("BAC_START_WINDOW_CLOSED")) {
    return "Fereastra de începere a simulării s-a încheiat.";
  }
  if (msg.includes("BAC_ACCESS_REQUIRED")) return "Participarea trebuie aprobată înainte.";
  if (msg.includes("BAC_REQUEST_WINDOW_CLOSED")) {
    return "Perioada de solicitare a participării s-a încheiat.";
  }
  if (msg.includes("BAC_EMAIL_REQUIRED")) {
    return "Nu am putut identifica emailul contului. Reautentifică-te și încearcă din nou.";
  }
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
  const [content, setContent] = useState<BacSimulationContentView | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [request, setRequest] = useState<BacRequest | null>(null);
  const [access, setAccess] = useState<BacAccess | null>(null);
  const [submission, setSubmission] = useState<BacSubmission | null>(null);
  const [evaluation, setEvaluation] = useState<BacEvaluation | null>(null);

  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [studentNote, setStudentNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function loadContentAndRefreshAccess(currentUserId: string) {
    const contentRes = await client.queries.getAuthorizedBacSimulationContent({
      simulationId,
    });

    if (contentRes.errors?.length) {
      console.error(contentRes.errors);
      setContent(null);
      setContentError(mapBacSubmitError(contentRes.errors[0]?.message));
      return;
    }

    setContent(contentRes.data ?? null);
    setContentError(null);

    const accessAfterStartRes = await client.models.BacAccess.get({
      owner: currentUserId,
      simulationId,
    });
    if (accessAfterStartRes.errors?.length) console.error(accessAfterStartRes.errors);
    setAccess(accessAfterStartRes.data ?? null);
  }

  async function refresh(currentUserId: string) {
    const canLoadBac = hasBacModels(client.models);
    setBacBackendAvailable(canLoadBac);
    if (!canLoadBac) {
      setSimulation(null);
      setContent(null);
      setRequest(null);
      setAccess(null);
      setSubmission(null);
      setEvaluation(null);
      setContentError("Simulările Bac nu sunt disponibile momentan.");
      return;
    }

    const [simulationRes, requestRes, accessRes, submissionRes, evaluationRes] =
      await Promise.all([
      client.models.BacSimulation.get({ id: simulationId }),
      client.models.BacRequest.get({ owner: currentUserId, simulationId }),
      client.models.BacAccess.get({ owner: currentUserId, simulationId }),
      client.models.BacSubmission.get({ owner: currentUserId, simulationId }),
      client.models.BacEvaluation.get({
        submissionOwner: currentUserId,
        simulationId,
      }),
    ]);

    if (simulationRes.errors?.length) console.error(simulationRes.errors);
    if (requestRes.errors?.length) console.error(requestRes.errors);
    if (accessRes.errors?.length) console.error(accessRes.errors);
    if (submissionRes.errors?.length) console.error(submissionRes.errors);
    if (evaluationRes.errors?.length) console.error(evaluationRes.errors);

    const currentAccess = accessRes.data ?? null;

    setSimulation(simulationRes.data ?? null);
    setRequest(requestRes.data ?? null);
    setAccess(currentAccess);
    setSubmission(submissionRes.data ?? null);
    setEvaluation(evaluationRes.data ?? null);

    setContent(null);
    setContentError(null);
    if (currentAccess?.startedAt) {
      await loadContentAndRefreshAccess(currentUserId);
    }
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

  const { startMs, startWindowEndMs } = useMemo(
    () => getBacWindow(simulation),
    [simulation]
  );

  const hasAccess = Boolean(access);
  const startedAtMs = optionalTimestamp(access?.startedAt ?? content?.startedAt);
  const deadlineAtMs = optionalTimestamp(access?.deadlineAt ?? content?.deadlineAt);
  const hasStarted = Number.isFinite(startedAtMs) && Number.isFinite(deadlineAtMs);
  const isBefore = Number.isFinite(startMs) ? nowMs < startMs : false;
  const canStart =
    hasAccess &&
    !hasStarted &&
    Number.isFinite(startMs) &&
    Number.isFinite(startWindowEndMs) &&
    nowMs >= startMs &&
    nowMs <= startWindowEndMs;
  const startWindowClosed =
    !hasStarted && Number.isFinite(startWindowEndMs)
      ? nowMs > startWindowEndMs
      : false;
  const isOpen = hasStarted ? nowMs <= deadlineAtMs + SUBMIT_GRACE_MS : false;
  const isAfter = hasStarted ? nowMs > deadlineAtMs + SUBMIT_GRACE_MS : startWindowClosed;
  const requestWindowClosed = Number.isFinite(startWindowEndMs)
    ? nowMs > startWindowEndMs
    : true;
  const remainingWorkMs = hasStarted ? deadlineAtMs - nowMs : Number.NaN;
  const remainingStartWindowMs =
    !hasStarted && Number.isFinite(startWindowEndMs) ? startWindowEndMs - nowMs : Number.NaN;
  const isGraded = evaluation?.status === "GRADED";

  async function startSimulation() {
    if (!userId || !hasAccess || startingExam) return;

    setStartingExam(true);
    setContentError(null);
    try {
      await loadContentAndRefreshAccess(userId);
    } finally {
      setStartingExam(false);
    }
  }

  async function requestParticipation() {
    if (!simulation || !userId || !bacBackendAvailable) return;

    setRequesting(true);
    try {
      const res = await client.mutations.requestBacAccess({ simulationId: simulation.id });
      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        alert(mapBacSubmitError(res.errors?.[0]?.message ?? "Solicitarea participării a eșuat."));
        return;
      }
      await refresh(userId);
    } finally {
      setRequesting(false);
    }
  }

  async function deleteRequest() {
    if (!bacBackendAvailable || !request?.owner || !request.simulationId || !userId) return;
    if (!confirm("Ștergi această cerere de participare?")) return;

    const res = await client.models.BacRequest.delete({
      owner: request.owner,
      simulationId: request.simulationId,
    });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Ștergerea cererii a eșuat.");
      return;
    }
    await refresh(userId);
  }

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

  async function openEvaluationFile() {
    const path = evaluation?.evaluationFilePath;
    if (!path) return;

    const res = await getUrl({
      path,
      options: {
        expiresIn: 300,
        contentDisposition: {
          type: "attachment",
          filename: evaluation.evaluationOriginalName ?? "evaluare.pdf",
        },
      },
    });

    window.open(res.url.toString(), "_blank", "noopener,noreferrer");
  }

  async function submitSolution() {
    if (!bacBackendAvailable || !simulation || !userId || !selectedFile) return;

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
            <div className="section-title">
              {bacBackendAvailable ? "Simularea nu a fost găsită" : "Bac indisponibil"}
            </div>
            {!bacBackendAvailable ? (
              <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                Configurația aplicației nu include încă modelele Bac. Revino după sincronizarea
                backendului.
              </div>
            ) : null}
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
                  {formatWhen(simulation.startAt)} • Poți începe cel târziu la:{" "}
                  {formatLatestStartAt(simulation)} • Timp de lucru{" "}
                  {simulation.durationMinutes ?? "—"} min •{" "}
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
                Materie: {simulation.subject} • Începe: {formatWhen(simulation.startAt)} • Poți începe cel târziu la:{" "}
                {formatLatestStartAt(simulation)} • Timp de lucru:{" "}
                {simulation.durationMinutes ?? "—"} min • Punctaj maxim:{" "}
                {simulation.maxGrade ?? 10}
              </div>

              {!hasAccess ? (
                <div className="exam-item" style={{ marginTop: 14 }}>
                  <div className="exam-item-title">Participare pe bază de cerere</div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Subiectul și încărcarea soluției devin disponibile doar după aprobarea
                    participării de către un administrator.
                  </div>
                  {request ? (
                    <div className="small" style={{ marginTop: 8 }}>
                      Status cerere: {request.status ?? "PENDING"}
                      {request.note ? ` • Notă: ${request.note}` : ""}
                    </div>
                  ) : null}
                  <div className="exam-actions" style={{ marginTop: 10 }}>
                    {request?.status === "PENDING" ? (
                      <>
                        <OutlineButton disabled>În așteptare</OutlineButton>
                        <OutlineButton onClick={deleteRequest}>Anulează</OutlineButton>
                      </>
                    ) : request?.status === "REJECTED" ? (
                      <OutlineButton disabled>Cerere respinsă</OutlineButton>
                    ) : requestWindowClosed ? (
                      <OutlineButton disabled>Perioada s-a încheiat</OutlineButton>
                    ) : (
                      <OutlineButton onClick={requestParticipation} disabled={requesting}>
                        {requesting ? "Se trimite…" : "Solicită participare"}
                      </OutlineButton>
                    )}
                  </div>
                </div>
              ) : null}

              {hasAccess ? (
                <div className="exam-item" style={{ marginTop: 14 }}>
                  <div className="exam-item-title">
                    {hasStarted ? "Cronometrul tău" : "Începerea simulării"}
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    {hasStarted
                      ? `Ai început la ${formatWhen(access?.startedAt ?? content?.startedAt)}. Deadline: ${formatWhen(
                          access?.deadlineAt ?? content?.deadlineAt
                        )}.`
                      : isBefore
                      ? "Simularea nu a început încă."
                      : canStart
                      ? `Poți începe acum. Fereastra de start mai este deschisă ${formatRemaining(
                          remainingStartWindowMs
                        )}.`
                      : startWindowClosed
                      ? "Fereastra de start s-a încheiat."
                      : "Programul nu poate fi determinat."}
                  </div>
	                  {hasStarted && isOpen ? (
	                    <div className="bac-timer-box">
	                      <div className="small">Timp rămas</div>
	                      <div className="bac-timer-value">{formatRemaining(remainingWorkMs)}</div>
	                    </div>
	                  ) : null}
                  {!hasStarted && canStart ? (
                    <div className="exam-actions" style={{ marginTop: 10 }}>
                      <OutlineButton onClick={startSimulation} disabled={startingExam}>
                        {startingExam ? "Se pornește…" : "Începe simularea"}
                      </OutlineButton>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {hasAccess && contentError ? (
                <div className="small" style={{ marginTop: 12 }}>
                  {contentError}
                </div>
              ) : null}

              {hasStarted && content?.instructions ? (
                <div className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
                  {content.instructions}
                </div>
              ) : null}

              {hasStarted && content?.promptText ? (
                <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <div className="section-title">Subiect</div>
                  <MathText className="task-question-text" text={content.promptText} />
                </div>
              ) : null}
            </Card>

            {hasAccess ? (
              <Card className="bac-card">
	              <div className="section-title">Soluția ta</div>
	              <div className="small" style={{ marginTop: 8 }}>
	                {!hasStarted && isBefore
	                  ? "Simularea nu a început încă."
	                  : !hasStarted && canStart
	                  ? "Începe simularea pentru a vedea subiectul și pentru a putea încărca soluția."
	                  : !hasStarted && startWindowClosed
	                  ? "Nu ai început simularea în fereastra disponibilă, deci încărcarea soluției nu mai este disponibilă."
	                  : hasStarted && isOpen
	                  ? `Poți încărca documentul soluției până la deadline. Timp rămas: ${formatRemaining(
	                      remainingWorkMs
	                    )}.`
	                  : isAfter
	                  ? "Timpul personal de lucru s-a încheiat."
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

	              {hasStarted && isOpen && !isGraded ? (
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
            ) : null}

            {hasAccess && evaluation ? (
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
                    {evaluation.evaluationFilePath ? (
                      <div className="exam-actions" style={{ marginTop: 12 }}>
                        <OutlineButton onClick={openEvaluationFile}>
                          Descarcă PDF evaluator
                        </OutlineButton>
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

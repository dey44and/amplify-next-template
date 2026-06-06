"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacRequest = Schema["BacRequest"]["type"];
type BacAccess = Schema["BacAccess"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];

const SUBMIT_GRACE_MS = 15 * 60_000;

function getBacWindow(simulation: BacSimulation) {
  const startMs = simulation.startAt ? toTimestamp(simulation.startAt) : Number.NaN;
  const startWindowMinutes = Number(simulation.accessWindowMinutes ?? simulation.durationMinutes ?? 0);
  const startWindowEndMs =
    Number.isFinite(startMs) && Number.isFinite(startWindowMinutes)
      ? startMs + startWindowMinutes * 60_000
      : Number.NaN;

  return { startMs, startWindowMinutes, startWindowEndMs };
}

function optionalTimestamp(iso?: string | null) {
  if (!iso) return Number.NaN;
  const ms = toTimestamp(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function formatLatestStartAt(simulation: BacSimulation) {
  const { startWindowEndMs } = getBacWindow(simulation);
  return Number.isFinite(startWindowEndMs)
    ? formatWhen(new Date(startWindowEndMs).toISOString())
    : formatWhen(null);
}

function getRequestWindowClosed(simulation: BacSimulation, nowMs: number) {
  const { startWindowMinutes, startWindowEndMs } = getBacWindow(simulation);

  return (
    !Number.isFinite(startWindowEndMs) ||
    startWindowMinutes <= 0 ||
    nowMs > startWindowEndMs
  );
}

function statusLabel(args: {
  simulation: BacSimulation;
  request?: BacRequest;
  access?: BacAccess;
  submission?: BacSubmission;
  evaluation?: BacEvaluation;
  nowMs: number;
}) {
  const { simulation, request, access, submission, evaluation, nowMs } = args;

  if (!access) {
    if (request?.status === "PENDING") return "Cerere în așteptare";
    if (request?.status === "REJECTED") return "Cerere respinsă";
    if (request?.status === "APPROVED") return "Aprobat";
    if (getRequestWindowClosed(simulation, nowMs)) return "Încheiat";
    return "Necesită aprobare";
  }

  if (evaluation?.status === "GRADED") return "Evaluat";
  if (evaluation?.status === "RETURNED") return "Returnat";
  if (submission) return "Trimis";

  const { startMs, startWindowEndMs } = getBacWindow(simulation);
  const startedMs = optionalTimestamp(access.startedAt);
  const deadlineMs = optionalTimestamp(access.deadlineAt);

  if (Number.isFinite(startedMs) && Number.isFinite(deadlineMs)) {
    if (nowMs <= deadlineMs + SUBMIT_GRACE_MS) return "În lucru";
    return "Încheiat";
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(startWindowEndMs)) {
    return "Program indisponibil";
  }
  if (nowMs < startMs) return "Programat";
  if (nowMs <= startWindowEndMs) return "Poți începe";
  return "Fereastră închisă";
}

export default function BacPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [simulations, setSimulations] = useState<BacSimulation[]>([]);
  const [requests, setRequests] = useState<BacRequest[]>([]);
  const [access, setAccess] = useState<BacAccess[]>([]);
  const [submissions, setSubmissions] = useState<BacSubmission[]>([]);
  const [evaluations, setEvaluations] = useState<BacEvaluation[]>([]);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      let userId: string;
      try {
        userId = (await getCurrentUser()).userId;
      } catch {
        router.replace("/login");
        return;
      }
      if (cancelled) return;

      setUserId(userId);

      const canLoadBac = hasBacModels(client.models);
      setBacBackendAvailable(canLoadBac);
      if (!canLoadBac) {
        setSimulations([]);
        setRequests([]);
        setAccess([]);
        setSubmissions([]);
        setEvaluations([]);
        setLoading(false);
        return;
      }

      const [simulationRes, requestRes, accessRes, submissionRes, evaluationRes] =
        await Promise.all([
        client.models.BacSimulation.list({ limit: 500 }),
        client.models.BacRequest.list({
          filter: { owner: { eq: userId } },
          limit: 500,
        }),
        client.models.BacAccess.list({
          filter: { owner: { eq: userId } },
          limit: 500,
        }),
        client.models.BacSubmission.list({
          filter: { owner: { eq: userId } },
          limit: 500,
        }),
        client.models.BacEvaluation.list({
          filter: { submissionOwner: { eq: userId } },
          limit: 500,
        }),
      ]);
      if (cancelled) return;

      if (simulationRes.errors?.length) console.error(simulationRes.errors);
      if (requestRes.errors?.length) console.error(requestRes.errors);
      if (accessRes.errors?.length) console.error(accessRes.errors);
      if (submissionRes.errors?.length) console.error(submissionRes.errors);
      if (evaluationRes.errors?.length) console.error(evaluationRes.errors);

      setSimulations((simulationRes.data ?? []).filter(notNull));
      setRequests((requestRes.data ?? []).filter(notNull));
      setAccess((accessRes.data ?? []).filter(notNull));
      setSubmissions((submissionRes.data ?? []).filter(notNull));
      setEvaluations((evaluationRes.data ?? []).filter(notNull));
      setLoading(false);
    })().catch((err) => {
      console.error(err);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function refreshParticipationState(currentUserId: string) {
    if (!bacBackendAvailable) return;

    const [requestRes, accessRes, submissionRes, evaluationRes] = await Promise.all([
      client.models.BacRequest.list({
        filter: { owner: { eq: currentUserId } },
        limit: 500,
      }),
      client.models.BacAccess.list({
        filter: { owner: { eq: currentUserId } },
        limit: 500,
      }),
      client.models.BacSubmission.list({
        filter: { owner: { eq: currentUserId } },
        limit: 500,
      }),
      client.models.BacEvaluation.list({
        filter: { submissionOwner: { eq: currentUserId } },
        limit: 500,
      }),
    ]);

    if (requestRes.errors?.length) console.error(requestRes.errors);
    if (accessRes.errors?.length) console.error(accessRes.errors);
    if (submissionRes.errors?.length) console.error(submissionRes.errors);
    if (evaluationRes.errors?.length) console.error(evaluationRes.errors);

    setRequests((requestRes.data ?? []).filter(notNull));
    setAccess((accessRes.data ?? []).filter(notNull));
    setSubmissions((submissionRes.data ?? []).filter(notNull));
    setEvaluations((evaluationRes.data ?? []).filter(notNull));
  }

  async function requestParticipation(simulation: BacSimulation) {
    if (!userId || !bacBackendAvailable) return;

    setRequestingId(simulation.id);
    try {
      const res = await client.mutations.requestBacAccess({ simulationId: simulation.id });
      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        alert("Solicitarea participării a eșuat.");
        return;
      }
      await refreshParticipationState(userId);
    } finally {
      setRequestingId(null);
    }
  }

  async function deleteRequest(req: BacRequest) {
    if (!bacBackendAvailable || !userId || !req.owner || !req.simulationId) return;
    if (!confirm("Ștergi această cerere de participare?")) return;

    const res = await client.models.BacRequest.delete({
      owner: req.owner,
      simulationId: req.simulationId,
    });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Ștergerea cererii a eșuat.");
      return;
    }
    await refreshParticipationState(userId);
  }

  const requestBySimulationId = useMemo(() => {
    const map = new Map<string, BacRequest>();
    for (const request of requests) {
      if (request.simulationId) map.set(request.simulationId, request);
    }
    return map;
  }, [requests]);

  const accessBySimulationId = useMemo(() => {
    const map = new Map<string, BacAccess>();
    for (const accessRow of access) {
      if (accessRow.simulationId) map.set(accessRow.simulationId, accessRow);
    }
    return map;
  }, [access]);

  const submissionBySimulationId = useMemo(() => {
    const map = new Map<string, BacSubmission>();
    for (const submission of submissions) {
      if (submission.simulationId) map.set(submission.simulationId, submission);
    }
    return map;
  }, [submissions]);

  const evaluationBySimulationId = useMemo(() => {
    const map = new Map<string, BacEvaluation>();
    for (const evaluation of evaluations) {
      if (evaluation.simulationId) map.set(evaluation.simulationId, evaluation);
    }
    return map;
  }, [evaluations]);

  const sortedSimulations = useMemo(
    () =>
      simulations
        .slice()
        .sort((a, b) => toTimestamp(a.startAt) - toTimestamp(b.startAt)),
    [simulations]
  );

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă simulările de Bac…</p>
        ) : (
          <div className="panel-stack bac-page">
            <section className="bac-hero">
              <div className="bac-hero-copy">
                <div className="bac-kicker">Bacalaureat</div>
                <div className="bac-title">Simulări Bac</div>
                <div className="bac-subtitle">
                  Subiecte scrise, soluții încărcate ca document PDF și evaluare detaliată.
                </div>
              </div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Înapoi
                </OutlineButton>
              </div>
            </section>

            <Card className="bac-card">
              <div className="section-title">Subiecte disponibile</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Încarcă soluția ca document unic, apoi așteaptă evaluarea automată.
              </div>
              {!bacBackendAvailable ? (
                <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                  Simulările de Bac nu sunt disponibile momentan deoarece configurația aplicației nu
                  include încă modelele de Bac.
                </div>
              ) : null}

              <div className="exam-list" style={{ marginTop: 14 }}>
                {!bacBackendAvailable ? (
                  <p className="small" style={{ margin: 0 }}>
                    Revino după sincronizarea backend-ului.
                  </p>
                ) : sortedSimulations.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări de Bac configurate.
                  </p>
                ) : (
                  sortedSimulations.map((simulation) => {
                    const submission = submissionBySimulationId.get(simulation.id);
                    const evaluation = evaluationBySimulationId.get(simulation.id);
                    const request = requestBySimulationId.get(simulation.id);
                    const accessRow = accessBySimulationId.get(simulation.id);
                    const requestWindowClosed = getRequestWindowClosed(simulation, nowMs);
                    const label = statusLabel({
                      simulation,
                      request,
                      access: accessRow,
                      submission,
                      evaluation,
                      nowMs,
                    });

                    return (
                      <div key={simulation.id} className="exam-item">
                        <div className="exam-item-title">{simulation.title}</div>
                        <div className="small">Materie: {simulation.subject}</div>
                        <div className="small" style={{ opacity: 0.85 }}>
                          Începe: {formatWhen(simulation.startAt)} • Poți începe cel târziu la:{" "}
                          {formatLatestStartAt(simulation)} • Timp de lucru:{" "}
                          {simulation.durationMinutes ?? "—"} min
                        </div>
                        {accessRow?.startedAt ? (
                          <div className="small" style={{ opacity: 0.85 }}>
                            Ai început la: {formatWhen(accessRow.startedAt)} • Deadline:{" "}
                            {formatWhen(accessRow.deadlineAt)}
                          </div>
                        ) : null}
                        <div className="small" style={{ opacity: 0.85 }}>
                          Stare: {label}
                          {evaluation?.status === "GRADED"
                            ? ` • Nota: ${evaluation.manualGrade ?? "—"} / ${evaluation.maxGrade ?? simulation.maxGrade ?? 10}`
                            : ""}
                        </div>

                        <div className="exam-actions">
                          {accessRow ? (
                            <OutlineButton onClick={() => router.push(`/bac/${simulation.id}`)}>
                              {submission ? "Vezi lucrarea" : accessRow.startedAt ? "Continuă" : "Deschide"}
                            </OutlineButton>
                          ) : request?.status === "PENDING" ? (
                            <>
                              <OutlineButton disabled>În așteptare</OutlineButton>
                              <OutlineButton onClick={() => deleteRequest(request)}>
                                Anulează
                              </OutlineButton>
                            </>
                          ) : request?.status === "REJECTED" ? (
                            <OutlineButton disabled>Cerere respinsă</OutlineButton>
                          ) : requestWindowClosed ? (
                            <OutlineButton disabled>Încheiat</OutlineButton>
                          ) : (
                            <OutlineButton
                              onClick={() => requestParticipation(simulation)}
                              disabled={requestingId === simulation.id}
                            >
                              {requestingId === simulation.id
                                ? "Se trimite…"
                                : "Solicită participare"}
                            </OutlineButton>
                          )}
                        </div>
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

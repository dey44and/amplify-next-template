"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { getExamState } from "@/lib/examWindow";
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
    return "Necesită aprobare";
  }

  if (evaluation?.status === "GRADED") return "Evaluat";
  if (evaluation?.status === "RETURNED") return "Returnat";
  if (submission) return "Trimis";

  const state = getExamState(simulation, nowMs);
  if (state === "before") return "Programat";
  if (state === "during") return "Deschis";
  if (state === "after") return "Încheiat";
  return "Program indisponibil";
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
    if (!userId) return;

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
    if (!userId || !req.owner || !req.simulationId) return;
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
          <p className="small">Se încarcă simulările Bac…</p>
        ) : (
          <div className="panel-stack bac-page">
            <section className="bac-hero">
              <div className="bac-hero-copy">
                <div className="bac-kicker">Bacalaureat</div>
                <div className="bac-title">Simulări Bac</div>
                <div className="bac-subtitle">
                  Subiecte scrise, soluții încărcate ca document și evaluare manuală.
                </div>
              </div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Înapoi la panou
                </OutlineButton>
              </div>
            </section>

            <Card className="bac-card">
              <div className="section-title">Subiecte disponibile</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Încarcă soluția ca document unic, apoi așteaptă evaluarea manuală.
              </div>

              <div className="exam-list" style={{ marginTop: 14 }}>
                {sortedSimulations.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări Bac configurate.
                  </p>
                ) : (
                  sortedSimulations.map((simulation) => {
                    const submission = submissionBySimulationId.get(simulation.id);
                    const evaluation = evaluationBySimulationId.get(simulation.id);
                    const request = requestBySimulationId.get(simulation.id);
                    const accessRow = accessBySimulationId.get(simulation.id);
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
                          Începe: {formatWhen(simulation.startAt)} • Durată:{" "}
                          {simulation.durationMinutes ?? "—"} min
                        </div>
                        <div className="small" style={{ opacity: 0.85 }}>
                          Stare: {label}
                          {evaluation?.status === "GRADED"
                            ? ` • Nota: ${evaluation.manualGrade ?? "—"} / ${evaluation.maxGrade ?? simulation.maxGrade ?? 10}`
                            : ""}
                        </div>

                        <div className="exam-actions">
                          {accessRow ? (
                            <OutlineButton onClick={() => router.push(`/bac/${simulation.id}`)}>
                              Deschide
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

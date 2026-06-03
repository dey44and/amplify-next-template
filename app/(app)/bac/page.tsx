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
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];

function statusLabel(args: {
  simulation: BacSimulation;
  submission?: BacSubmission;
  evaluation?: BacEvaluation;
  nowMs: number;
}) {
  const { simulation, submission, evaluation, nowMs } = args;
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
  const [simulations, setSimulations] = useState<BacSimulation[]>([]);
  const [submissions, setSubmissions] = useState<BacSubmission[]>([]);
  const [evaluations, setEvaluations] = useState<BacEvaluation[]>([]);
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

      const [simulationRes, submissionRes, evaluationRes] = await Promise.all([
        client.models.BacSimulation.list({ limit: 500 }),
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
      if (submissionRes.errors?.length) console.error(submissionRes.errors);
      if (evaluationRes.errors?.length) console.error(evaluationRes.errors);

      setSimulations((simulationRes.data ?? []).filter(notNull));
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
                    const label = statusLabel({
                      simulation,
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
                          <OutlineButton onClick={() => router.push(`/bac/${simulation.id}`)}>
                            Deschide
                          </OutlineButton>
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

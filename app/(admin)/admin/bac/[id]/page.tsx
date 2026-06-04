"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";
import { getUrl } from "aws-amplify/storage";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacSimulationContent = Schema["BacSimulationContent"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];
type Profile = Schema["UserProfile"]["type"];

type EvaluationDraft = {
  manualGrade: string;
  maxGrade: string;
  evaluationNotes: string;
};

function draftKey(submission: BacSubmission) {
  return submission.owner ?? "";
}

function formatRequester(owner: string | null | undefined, profilesByOwner: Map<string, Profile>) {
  const ownerId = String(owner ?? "").trim();
  if (!ownerId) return "—";

  const profile = profilesByOwner.get(ownerId);
  const firstName = String(profile?.firstName ?? "").trim();
  const lastName = String(profile?.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName ? `${fullName} (${ownerId})` : ownerId;
}

export default function AdminBacDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const simulationId = useMemo(() => String(params.id ?? ""), [params.id]);

  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState<BacSimulation | null>(null);
  const [simulationContent, setSimulationContent] = useState<BacSimulationContent | null>(null);
  const [submissions, setSubmissions] = useState<BacSubmission[]>([]);
  const [evaluations, setEvaluations] = useState<BacEvaluation[]>([]);
  const [profilesByOwner, setProfilesByOwner] = useState<Map<string, Profile>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, EvaluationDraft>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);

    let currentAdminId = adminUserId;
    if (!currentAdminId) {
      const user = await getCurrentUser();
      currentAdminId = user.userId;
      setAdminUserId(currentAdminId);
    }

    const [simulationRes, contentRes, submissionsRes, evaluationsRes] = await Promise.all([
      client.models.BacSimulation.get({ id: simulationId }),
      client.models.BacSimulationContent.get({ simulationId }),
      client.models.BacSubmission.list({
        filter: { simulationId: { eq: simulationId } },
        limit: 1000,
      }),
      client.models.BacEvaluation.list({
        filter: { simulationId: { eq: simulationId } },
        limit: 1000,
      }),
    ]);

    if (simulationRes.errors?.length) console.error(simulationRes.errors);
    if (contentRes.errors?.length) console.error(contentRes.errors);
    if (submissionsRes.errors?.length) console.error(submissionsRes.errors);
    if (evaluationsRes.errors?.length) console.error(evaluationsRes.errors);

    const nextSimulation = simulationRes.data ?? null;
    const nextSimulationContent = contentRes.data ?? null;
    const nextSubmissions = (submissionsRes.data ?? []).filter(notNull);
    const nextEvaluations = (evaluationsRes.data ?? []).filter(notNull);

    setSimulation(nextSimulation);
    setSimulationContent(nextSimulationContent);
    setSubmissions(nextSubmissions);
    setEvaluations(nextEvaluations);

    const ownerIds = Array.from(
      new Set(
        nextSubmissions
          .map((submission) => submission.owner)
          .filter((owner): owner is string => Boolean(owner))
      )
    );

    const profileResults = await Promise.all(
      ownerIds.map(async (ownerId) => {
        const res = await client.models.UserProfile.get({ id: ownerId });
        if (res.errors?.length) {
          console.error(`UserProfile.get failed for ${ownerId}:`, res.errors);
        }
        return [ownerId, res.data ?? null] as const;
      })
    );

    const profileMap = new Map<string, Profile>();
    for (const [ownerId, profile] of profileResults) {
      if (profile) profileMap.set(ownerId, profile);
    }
    setProfilesByOwner(profileMap);

    const evaluationsByOwner = new Map<string, BacEvaluation>();
    for (const evaluation of nextEvaluations) {
      if (evaluation.submissionOwner) {
        evaluationsByOwner.set(evaluation.submissionOwner, evaluation);
      }
    }

    const nextDrafts: Record<string, EvaluationDraft> = {};
    for (const submission of nextSubmissions) {
      const key = draftKey(submission);
      const evaluation = evaluationsByOwner.get(key);
      nextDrafts[key] = {
        manualGrade: evaluation?.manualGrade != null ? String(evaluation.manualGrade) : "",
        maxGrade:
          evaluation?.maxGrade != null
            ? String(evaluation.maxGrade)
            : nextSimulation?.maxGrade != null
            ? String(nextSimulation.maxGrade)
            : "10",
        evaluationNotes: evaluation?.evaluationNotes ?? "",
      };
    }
    setDrafts(nextDrafts);

    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((err) => {
      console.error(err);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationId]);

  const evaluationsByOwner = useMemo(() => {
    const map = new Map<string, BacEvaluation>();
    for (const evaluation of evaluations) {
      if (evaluation.submissionOwner) map.set(evaluation.submissionOwner, evaluation);
    }
    return map;
  }, [evaluations]);

  const sortedSubmissions = useMemo(
    () =>
      submissions
        .slice()
        .sort(
          (a, b) =>
            new Date(a.submittedAt ?? 0).getTime() -
            new Date(b.submittedAt ?? 0).getTime()
        ),
    [submissions]
  );

  function updateDraft(owner: string, patch: Partial<EvaluationDraft>) {
    setDrafts((prev) => {
      const base: EvaluationDraft = prev[owner] ?? {
        manualGrade: "",
        maxGrade: simulation?.maxGrade != null ? String(simulation.maxGrade) : "10",
        evaluationNotes: "",
      };

      return {
        ...prev,
        [owner]: {
          ...base,
          ...patch,
        },
      };
    });
  }

  async function openSubmission(submission: BacSubmission) {
    const path = submission.solutionFilePath;
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

  async function saveEvaluation(submission: BacSubmission) {
    const owner = submission.owner;
    if (!owner || !adminUserId) return;

    const draft = drafts[owner];
    const manualGrade = Number(draft?.manualGrade);
    const maxGrade = Number(draft?.maxGrade || simulation?.maxGrade || 10);

    if (!Number.isFinite(manualGrade) || manualGrade < 0) {
      alert("Nota trebuie să fie un număr pozitiv sau zero.");
      return;
    }
    if (!Number.isFinite(maxGrade) || maxGrade <= 0) {
      alert("Punctajul maxim trebuie să fie pozitiv.");
      return;
    }
    if (manualGrade > maxGrade) {
      alert("Nota nu poate depăși punctajul maxim.");
      return;
    }

    const nowIso = new Date().toISOString();
    setSavingKey(owner);
    try {
      const payload = {
        submissionOwner: owner,
        simulationId,
        status: "GRADED" as const,
        manualGrade,
        maxGrade,
        evaluationNotes: draft?.evaluationNotes.trim() || null,
        gradedBy: adminUserId,
        gradedAt: nowIso,
        updatedAt: nowIso,
      };

      const existing = evaluationsByOwner.get(owner);
      const res = existing
        ? await client.models.BacEvaluation.update(payload)
        : await client.models.BacEvaluation.create(payload);

      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        alert("Salvarea evaluării a eșuat.");
        return;
      }

      await refresh();
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă evaluările Bac…</p>
        ) : !simulation ? (
          <Card>
            <div className="section-title">Simularea nu a fost găsită</div>
            <div style={{ marginTop: 12 }}>
              <OutlineButton onClick={() => router.push("/admin/bac")}>Înapoi</OutlineButton>
            </div>
          </Card>
        ) : (
          <div className="panel-stack bac-page bac-page--admin">
            <section className="bac-hero bac-hero--compact bac-hero--admin">
              <div className="bac-hero-copy">
                <div className="bac-kicker">{simulation.subject}</div>
                <div className="bac-title">{simulation.title}</div>
                <div className="bac-subtitle">
                  {sortedSubmissions.length} lucrări trimise • Max {simulation.maxGrade ?? 10}
                </div>
              </div>
              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/admin/bac")}>
                  Înapoi
                </OutlineButton>
                <OutlineButton onClick={() => refresh()} disabled={loading}>
                  Reîncarcă
                </OutlineButton>
              </div>
            </section>

            <Card className="bac-card">
              <div className="section-title">Detalii</div>
              <div className="small" style={{ marginTop: 8 }}>
                Materie: {simulation.subject} • Începe: {formatWhen(simulation.startAt)} • Durată:{" "}
                {simulation.durationMinutes ?? "—"} min • Max: {simulation.maxGrade ?? 10}
              </div>

              {simulationContent?.instructions ? (
                <div className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
                  {simulationContent.instructions}
                </div>
              ) : null}

              {simulationContent?.promptText ? (
                <div style={{ marginTop: 14 }}>
                  <MathText className="task-question-text" text={simulationContent.promptText} />
                </div>
              ) : null}
            </Card>

            <Card className="bac-card">
              <div className="section-title">Lucrări trimise</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Deschide soluția elevului, apoi salvează nota manuală și observațiile.
              </div>

              <div className="exam-list" style={{ marginTop: 14 }}>
                {sortedSubmissions.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există lucrări trimise pentru această simulare.
                  </p>
                ) : (
                  sortedSubmissions.map((submission) => {
                    const owner = submission.owner ?? "";
                    const evaluation = evaluationsByOwner.get(owner);
                    const draft = drafts[owner] ?? {
                      manualGrade: "",
                      maxGrade: simulation.maxGrade != null ? String(simulation.maxGrade) : "10",
                      evaluationNotes: "",
                    };

                    return (
                      <div key={owner} className="exam-item">
                        <div className="exam-item-title">
                          {formatRequester(owner, profilesByOwner)}
                        </div>
                        <div className="small" style={{ opacity: 0.85 }}>
                          Trimis: {formatWhen(submission.submittedAt)} • Fișier:{" "}
                          {submission.solutionOriginalName ?? "solutie"}
                        </div>
                        {submission.studentNote ? (
                          <div className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                            Notă elev: {submission.studentNote}
                          </div>
                        ) : null}
                        <div className="small" style={{ marginTop: 6 }}>
                          Status evaluare: {evaluation?.status ?? "Neevaluat"}
                        </div>

                        <div
                          style={{
                            marginTop: 10,
                            display: "grid",
                            gap: 10,
                            maxWidth: 760,
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "160px 160px",
                              gap: 10,
                            }}
                          >
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              placeholder="Nota"
                              value={draft.manualGrade}
                              onChange={(e) =>
                                updateDraft(owner, { manualGrade: e.target.value })
                              }
                              className="field-input"
                            />
                            <input
                              type="number"
                              min={1}
                              step={0.01}
                              placeholder="Max"
                              value={draft.maxGrade}
                              onChange={(e) =>
                                updateDraft(owner, { maxGrade: e.target.value })
                              }
                              className="field-input"
                            />
                          </div>

                          <textarea
                            placeholder="Observații pentru elev"
                            value={draft.evaluationNotes}
                            onChange={(e) =>
                              updateDraft(owner, { evaluationNotes: e.target.value })
                            }
                            className="field-input"
                            style={{ minHeight: 110, resize: "vertical" }}
                          />
                        </div>

                        <div className="exam-actions">
                          <OutlineButton onClick={() => openSubmission(submission)}>
                            Deschide soluția
                          </OutlineButton>
                          <OutlineButton
                            onClick={() => saveEvaluation(submission)}
                            disabled={savingKey === owner}
                          >
                            {savingKey === owner ? "Se salvează…" : "Salvează evaluarea"}
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

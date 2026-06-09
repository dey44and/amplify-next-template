"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { getUrl, uploadData } from "aws-amplify/storage";

const client = generateClient<Schema>();

type BacSimulation = Schema["BacSimulation"]["type"];
type BacSimulationContent = Schema["BacSimulationContent"]["type"];
type BacRequest = Schema["BacRequest"]["type"];
type BacAccess = Schema["BacAccess"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];
type Profile = Schema["UserProfile"]["type"];

type EvaluationDraft = {
  manualGrade: string;
  maxGrade: string;
  evaluationNotes: string;
};

const MAX_EVALUATION_FILE_BYTES = 25 * 1024 * 1024;

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

function requestStatusLabel(status?: string | null) {
  if (status === "PENDING") return "În așteptare";
  if (status === "APPROVED") return "Aprobat";
  if (status === "REJECTED") return "Respins";
  return "—";
}

function safeFileName(name: string) {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "evaluare.pdf";
}

function getStudentIdentityId(submission: BacSubmission) {
  const path = submission.solutionFilePath ?? "";
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "bac-submissions" && parts[1] ? parts[1] : null;
}

function mapPublishEvaluationError(raw?: string) {
  const msg = String(raw ?? "");
  if (msg.includes("BAC_INVALID_GRADE")) return "Nota trebuie să fie un număr pozitiv sau zero.";
  if (msg.includes("BAC_INVALID_MAX_GRADE")) return "Punctajul maxim trebuie să fie pozitiv.";
  if (msg.includes("BAC_GRADE_OVER_MAX")) return "Nota nu poate depăși punctajul maxim.";
  if (msg.includes("BAC_SUBMISSION_NOT_FOUND")) return "Lucrarea elevului nu mai există.";
  if (msg.includes("BAC_SIMULATION_NOT_FOUND")) return "Simularea nu mai există.";
  return raw ?? "Salvarea evaluării a eșuat.";
}

type PublishBacEvaluationResult = {
  data?: BacEvaluation | null;
  errors?: Array<{ message?: string | null } | null> | null;
};

async function publishBacEvaluation(args: {
  submissionOwner: string;
  simulationId: string;
  manualGrade: number;
  maxGrade: number;
  evaluationNotes?: string;
  evaluationFilePath?: string;
  evaluationOriginalName?: string;
  evaluationContentType?: string;
  evaluationSizeBytes?: number;
}): Promise<PublishBacEvaluationResult> {
  const typedMutations = client.mutations as
    | {
        publishBacEvaluation?: (input: typeof args) => Promise<PublishBacEvaluationResult>;
      }
    | undefined;

  if (typeof typedMutations?.publishBacEvaluation === "function") {
    return typedMutations.publishBacEvaluation(args);
  }

  const clientWithGraphql = client as unknown as {
    graphql?: (input: {
      query: string;
      variables?: Record<string, unknown>;
    }) => Promise<{
      data?: { publishBacEvaluation?: BacEvaluation | null };
      errors?: Array<{ message?: string | null } | null> | null;
    }>;
  };

  if (typeof clientWithGraphql.graphql !== "function") {
    return {
      errors: [{ message: "PUBLISH_BAC_EVALUATION_UNAVAILABLE" }],
    };
  }

  const raw = await clientWithGraphql.graphql({
    query: /* GraphQL */ `
      mutation PublishBacEvaluation(
        $submissionOwner: String!
        $simulationId: ID!
        $manualGrade: Float!
        $maxGrade: Float!
        $evaluationNotes: String
        $evaluationFilePath: String
        $evaluationOriginalName: String
        $evaluationContentType: String
        $evaluationSizeBytes: Int
      ) {
        publishBacEvaluation(
          submissionOwner: $submissionOwner
          simulationId: $simulationId
          manualGrade: $manualGrade
          maxGrade: $maxGrade
          evaluationNotes: $evaluationNotes
          evaluationFilePath: $evaluationFilePath
          evaluationOriginalName: $evaluationOriginalName
          evaluationContentType: $evaluationContentType
          evaluationSizeBytes: $evaluationSizeBytes
        ) {
          submissionOwner
          simulationId
          status
          manualGrade
          maxGrade
          evaluationNotes
          evaluationFilePath
          evaluationOriginalName
          evaluationContentType
          evaluationSizeBytes
          gradedBy
          gradedAt
          updatedAt
          notificationEmailSentAt
          notificationEmailError
        }
      }
    `,
    variables: args,
  });

  return {
    data: raw.data?.publishBacEvaluation ?? null,
    errors: raw.errors,
  };
}

export default function AdminBacDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const simulationId = useMemo(() => String(params.id ?? ""), [params.id]);

  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState<BacSimulation | null>(null);
  const [simulationContent, setSimulationContent] = useState<BacSimulationContent | null>(null);
  const [requests, setRequests] = useState<BacRequest[]>([]);
  const [access, setAccess] = useState<BacAccess[]>([]);
  const [submissions, setSubmissions] = useState<BacSubmission[]>([]);
  const [evaluations, setEvaluations] = useState<BacEvaluation[]>([]);
  const [profilesByOwner, setProfilesByOwner] = useState<Map<string, Profile>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, EvaluationDraft>>({});
  const [evaluationFiles, setEvaluationFiles] = useState<Record<string, File | null>>({});
  const [evaluationUploadProgress, setEvaluationUploadProgress] = useState<Record<string, number | null>>({});
  const [evaluationErrors, setEvaluationErrors] = useState<Record<string, string | null>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  async function refresh() {
    setLoading(true);

    const canLoadBac = hasBacModels(client.models);
    setBacBackendAvailable(canLoadBac);
    if (!canLoadBac) {
      setSimulation(null);
      setSimulationContent(null);
      setRequests([]);
      setAccess([]);
      setSubmissions([]);
      setEvaluations([]);
      setProfilesByOwner(new Map());
      setDrafts({});
      setLoading(false);
      return;
    }

    let currentAdminId = adminUserId;
    if (!currentAdminId) {
      const user = await getCurrentUser();
      currentAdminId = user.userId;
      setAdminUserId(currentAdminId);
    }

    const [simulationRes, contentRes, submissionsRes, evaluationsRes, requestsRes, accessRes] = await Promise.all([
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
      client.models.BacRequest.list({
        filter: { simulationId: { eq: simulationId } },
        limit: 1000,
      }),
      client.models.BacAccess.list({
        filter: { simulationId: { eq: simulationId } },
        limit: 1000,
      }),
    ]);

    if (simulationRes.errors?.length) console.error(simulationRes.errors);
    if (contentRes.errors?.length) console.error(contentRes.errors);
    if (submissionsRes.errors?.length) console.error(submissionsRes.errors);
    if (evaluationsRes.errors?.length) console.error(evaluationsRes.errors);
    if (requestsRes.errors?.length) console.error(requestsRes.errors);
    if (accessRes.errors?.length) console.error(accessRes.errors);

    const nextSimulation = simulationRes.data ?? null;
    const nextSimulationContent = contentRes.data ?? null;
    const nextSubmissions = (submissionsRes.data ?? []).filter(notNull);
    const nextEvaluations = (evaluationsRes.data ?? []).filter(notNull);
    const nextRequests = (requestsRes.data ?? []).filter(notNull);
    const nextAccess = (accessRes.data ?? []).filter(notNull);

    setSimulation(nextSimulation);
    setSimulationContent(nextSimulationContent);
    setRequests(nextRequests);
    setAccess(nextAccess);
    setSubmissions(nextSubmissions);
    setEvaluations(nextEvaluations);

    const ownerIds = Array.from(
      new Set(
        [
          ...nextSubmissions.map((submission) => submission.owner),
          ...nextRequests.map((request) => request.owner),
          ...nextAccess.map((entry) => entry.owner),
        ].filter((owner): owner is string => Boolean(owner))
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
    setEvaluationFiles({});
    setEvaluationUploadProgress({});
    setEvaluationErrors({});

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

  const participantRows = useMemo(() => {
    const owners = new Set<string>();
    for (const request of requests) {
      if (request.owner) owners.add(request.owner);
    }
    for (const entry of access) {
      if (entry.owner) owners.add(entry.owner);
    }
    for (const submission of submissions) {
      if (submission.owner) owners.add(submission.owner);
    }
    for (const evaluation of evaluations) {
      if (evaluation.submissionOwner) owners.add(evaluation.submissionOwner);
    }

    return Array.from(owners)
      .map((owner) => {
        const request = requests.find((entry) => entry.owner === owner) ?? null;
        const accessEntry = access.find((entry) => entry.owner === owner) ?? null;
        const submission = submissions.find((entry) => entry.owner === owner) ?? null;
        const evaluation = evaluationsByOwner.get(owner) ?? null;

        return {
          owner,
          request,
          access: accessEntry,
          submission,
          evaluation,
          sortMs: Math.max(
            new Date(request?.requestedAt ?? 0).getTime(),
            new Date(accessEntry?.grantedAt ?? 0).getTime(),
            new Date(submission?.submittedAt ?? submission?.updatedAt ?? 0).getTime(),
            new Date(evaluation?.gradedAt ?? evaluation?.updatedAt ?? 0).getTime()
          ),
        };
      })
      .sort((a, b) => b.sortMs - a.sortMs);
  }, [access, evaluations, evaluationsByOwner, requests, submissions]);

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

  function onEvaluationFileChange(owner: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setEvaluationErrors((prev) => ({ ...prev, [owner]: null }));
    setEvaluationUploadProgress((prev) => ({ ...prev, [owner]: null }));

    if (!file) {
      setEvaluationFiles((prev) => ({ ...prev, [owner]: null }));
      return;
    }

    const looksLikePdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      event.target.value = "";
      setEvaluationFiles((prev) => ({ ...prev, [owner]: null }));
      setEvaluationErrors((prev) => ({
        ...prev,
        [owner]: "Atașamentul evaluatorului trebuie să fie un fișier PDF.",
      }));
      return;
    }

    if (file.size <= 0 || file.size > MAX_EVALUATION_FILE_BYTES) {
      event.target.value = "";
      setEvaluationFiles((prev) => ({ ...prev, [owner]: null }));
      setEvaluationErrors((prev) => ({
        ...prev,
        [owner]: "Fișierul PDF trebuie să fie între 1B și 25MB.",
      }));
      return;
    }

    setEvaluationFiles((prev) => ({ ...prev, [owner]: file }));
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

  async function openEvaluationFile(evaluation: BacEvaluation) {
    const path = evaluation.evaluationFilePath;
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

  async function saveEvaluation(submission: BacSubmission) {
    if (!bacBackendAvailable) {
      alert("Modelele Bac nu sunt disponibile în configurația Amplify curentă.");
      return;
    }

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

    setSavingKey(owner);
    setEvaluationErrors((prev) => ({ ...prev, [owner]: null }));
    try {
      const evaluationFile = evaluationFiles[owner] ?? null;
      let evaluationFilePayload:
        | {
            evaluationFilePath: string;
            evaluationOriginalName: string;
            evaluationContentType: string;
            evaluationSizeBytes: number;
          }
        | undefined;

      if (evaluationFile) {
        const studentIdentityId = getStudentIdentityId(submission);
        if (!studentIdentityId) {
          setEvaluationErrors((prev) => ({
            ...prev,
            [owner]:
              "Nu am putut determina identitatea de stocare a elevului din lucrarea trimisă.",
          }));
          return;
        }

        const session = await fetchAuthSession();
        const adminIdentityId = session.identityId ?? "admin";
        const objectPath = [
          "bac-evaluations",
          studentIdentityId,
          owner,
          simulationId,
          `${Date.now()}-${adminIdentityId}-${safeFileName(evaluationFile.name)}`,
        ].join("/");

        await uploadData({
          path: objectPath,
          data: evaluationFile,
          options: {
            contentType: "application/pdf",
            contentDisposition: {
              type: "attachment",
              filename: evaluationFile.name,
            },
            onProgress: ({ transferredBytes, totalBytes }) => {
              if (!totalBytes) return;
              setEvaluationUploadProgress((prev) => ({
                ...prev,
                [owner]: Math.round((transferredBytes / totalBytes) * 100),
              }));
            },
          },
        }).result;

        evaluationFilePayload = {
          evaluationFilePath: objectPath,
          evaluationOriginalName: evaluationFile.name,
          evaluationContentType: "application/pdf",
          evaluationSizeBytes: evaluationFile.size,
        };
      }

      const res = await publishBacEvaluation({
        submissionOwner: owner,
        simulationId,
        manualGrade,
        maxGrade,
        evaluationNotes: draft?.evaluationNotes.trim() || undefined,
        ...evaluationFilePayload,
      });

      if (res.errors?.length || !res.data) {
        console.error(res.errors);
        const message = mapPublishEvaluationError(res.errors?.[0]?.message ?? undefined);
        setEvaluationErrors((prev) => ({ ...prev, [owner]: message }));
        alert(message);
        return;
      }

      if (res.data.notificationEmailError) {
        alert(
          `Evaluarea a fost salvată, dar e-mailul nu a fost trimis: ${res.data.notificationEmailError}`
        );
      }

      await refresh();
    } finally {
      setSavingKey(null);
      setEvaluationUploadProgress((prev) => ({ ...prev, [owner]: null }));
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
            <div className="section-title">
              {bacBackendAvailable ? "Simularea nu a fost găsită" : "Bac indisponibil"}
            </div>
            {!bacBackendAvailable ? (
              <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                Modelele Bac nu sunt în configurația Amplify curentă. Regenerază{" "}
                <code>amplify_outputs.json</code> după ce backendul cu Bac este deployat.
              </div>
            ) : null}
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
                Materie: {simulation.subject} • Începe: {formatWhen(simulation.startAt)} • Fereastră start:{" "}
                {simulation.accessWindowMinutes ?? simulation.durationMinutes ?? "—"} min • Timp de lucru:{" "}
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
              <div className="section-title">Participanți și cereri</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Elevii înscriși sau interesați de această simulare de bacalaureat.
              </div>

              <div className="metric-grid">
                <div className="metric-tile soft-mint">
                  <div className="metric-label">Aprobați</div>
                  <div className="metric-value">{access.length}</div>
                  <div className="metric-helper">au primit confirmare</div>
                </div>
                <div className="metric-tile soft-lilac">
                  <div className="metric-label">Cereri în așteptare</div>
                  <div className="metric-value">
                    {requests.filter((request) => request.status === "PENDING").length}
                  </div>
                  <div className="metric-helper">neprocesate încă</div>
                </div>
                <div className="metric-tile">
                  <div className="metric-label">Cereri respinse</div>
                  <div className="metric-value">
                    {requests.filter((request) => request.status === "REJECTED").length}
                  </div>
                  <div className="metric-helper">istoric pentru simulare</div>
                </div>
                <div className="metric-tile soft-blue">
                  <div className="metric-label">Lucrări</div>
                  <div className="metric-value">{submissions.length}</div>
                  <div className="metric-helper">documente trimise</div>
                </div>
              </div>

              <div className="exam-list" style={{ marginTop: 14 }}>
                {participantRows.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există încă participanți sau cereri pentru această simulare.
                  </p>
                ) : (
                  participantRows.map((row) => (
                    <div key={row.owner} className="exam-item">
                      <div className="exam-item-title">
                        {formatRequester(row.owner, profilesByOwner)}
                      </div>
                      <div className="small" style={{ opacity: 0.85 }}>
                        Email: {row.request?.requesterEmail ?? "indisponibil"}
                      </div>
                      <div className="small" style={{ opacity: 0.85 }}>
                        Cerere: {requestStatusLabel(row.request?.status)}{" "}
                        {row.request?.requestedAt ? `• ${formatWhen(row.request.requestedAt)}` : ""}
                      </div>
                      <div className="small" style={{ opacity: 0.85 }}>
                        Acces: {row.access ? `aprobat la ${formatWhen(row.access.grantedAt)}` : "neaprobat"}
                      </div>
                      {row.access ? (
                        <div className="small" style={{ opacity: 0.85 }}>
                          Start elev: {formatWhen(row.access.startedAt)} • Deadline:{" "}
                          {formatWhen(row.access.deadlineAt)}
                        </div>
                      ) : null}
                      <div className="small" style={{ opacity: 0.85 }}>
                        Lucrare:{" "}
                        {row.submission
                          ? `${row.submission.solutionOriginalName ?? "document"} • ${formatWhen(
                              row.submission.submittedAt
                            )}`
                          : "netrimisă"}
                      </div>
                      <div className="small" style={{ opacity: 0.85 }}>
                        Evaluare:{" "}
                        {row.evaluation
                          ? `${row.evaluation.manualGrade ?? "—"}/${
                              row.evaluation.maxGrade ?? "—"
                            } • ${row.evaluation.status ?? "—"}`
                          : "neevaluată"}
                      </div>
                    </div>
                  ))
                )}
              </div>
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
                          {evaluation?.notificationEmailSentAt
                            ? ` • E-mail trimis: ${formatWhen(evaluation.notificationEmailSentAt)}`
                            : ""}
                          {evaluation?.notificationEmailError
                            ? ` • E-mail: ${evaluation.notificationEmailError}`
                            : ""}
                        </div>
                        {evaluation?.evaluationFilePath ? (
                          <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                            Document evaluator: {evaluation.evaluationOriginalName ?? "evaluare.pdf"}
                          </div>
                        ) : null}

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

                          <div style={{ display: "grid", gap: 6 }}>
                            <label className="field-label" htmlFor={`bac-evaluation-file-${owner}`}>
                              PDF evaluator
                            </label>
                            <input
                              id={`bac-evaluation-file-${owner}`}
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={(event) => onEvaluationFileChange(owner, event)}
                              disabled={savingKey === owner}
                              className="field-input"
                            />
                            <div className="small">
                              Atașează opțional un PDF cu observații, barem sau corectură.
                            </div>
                            {evaluationUploadProgress[owner] != null ? (
                              <div className="small">
                                Încărcare PDF: {evaluationUploadProgress[owner]}%
                              </div>
                            ) : null}
                            {evaluationErrors[owner] ? (
                              <div className="small" style={{ color: "rgba(180,0,0,0.85)" }}>
                                {evaluationErrors[owner]}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="exam-actions">
                          <OutlineButton onClick={() => openSubmission(submission)}>
                            Deschide soluția
                          </OutlineButton>
                          {evaluation?.evaluationFilePath ? (
                            <OutlineButton onClick={() => openEvaluationFile(evaluation)}>
                              Deschide PDF evaluator
                            </OutlineButton>
                          ) : null}
                          <OutlineButton
                            onClick={() => saveEvaluation(submission)}
                            disabled={savingKey === owner}
                          >
                            {savingKey === owner
                              ? "Se publică…"
                              : evaluation
                              ? "Actualizează evaluarea"
                              : "Publică evaluarea"}
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { PageShell } from "@/components/PageShell";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, OutlineButton } from "@/components/ui";
import { hasBacModels } from "@/lib/amplifyModelAvailability";
import { formatWhen, toTimestamp } from "@/lib/dateTime";
import { notNull } from "@/lib/notNull";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];
type Exam = Schema["MockExam"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];
type ExamAccess = Schema["ExamAccess"]["type"];
type ExamAttempt = Schema["ExamAttempt"]["type"];
type BacSimulation = Schema["BacSimulation"]["type"];
type BacRequest = Schema["BacRequest"]["type"];
type BacAccess = Schema["BacAccess"]["type"];
type BacSubmission = Schema["BacSubmission"]["type"];
type BacEvaluation = Schema["BacEvaluation"]["type"];

type PersonRow = {
  owner: string;
  profile: Profile | null;
  displayName: string;
  email: string | null;
  admissionRequests: ExamRequest[];
  admissionAccess: ExamAccess[];
  admissionAttempts: ExamAttempt[];
  bacRequests: BacRequest[];
  bacAccess: BacAccess[];
  bacSubmissions: BacSubmission[];
  bacEvaluations: BacEvaluation[];
  lastActivityMs: number;
};

function displayNameForProfile(owner: string, profile?: Profile | null) {
  const firstName = String(profile?.firstName ?? "").trim();
  const lastName = String(profile?.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || owner;
}

function compactOwner(owner: string) {
  return owner.length > 14 ? `${owner.slice(0, 8)}…${owner.slice(-4)}` : owner;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  return values.reduce((latest, value) => {
    const next = toTimestamp(value);
    return Number.isFinite(next) && next > latest ? next : latest;
  }, 0);
}

function statusLabel(status?: string | null) {
  if (status === "PENDING") return "În așteptare";
  if (status === "APPROVED") return "Aprobat";
  if (status === "REJECTED") return "Respins";
  return "—";
}

export default function AdminPeoplePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [bacSimulations, setBacSimulations] = useState<BacSimulation[]>([]);
  const [examRequests, setExamRequests] = useState<ExamRequest[]>([]);
  const [examAccess, setExamAccess] = useState<ExamAccess[]>([]);
  const [examAttempts, setExamAttempts] = useState<ExamAttempt[]>([]);
  const [bacRequests, setBacRequests] = useState<BacRequest[]>([]);
  const [bacAccess, setBacAccess] = useState<BacAccess[]>([]);
  const [bacSubmissions, setBacSubmissions] = useState<BacSubmission[]>([]);
  const [bacEvaluations, setBacEvaluations] = useState<BacEvaluation[]>([]);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  async function refresh() {
    setLoading(true);

    const canLoadBac = hasBacModels(client.models);
    setBacBackendAvailable(canLoadBac);

    const [
      profileRes,
      examRes,
      examRequestRes,
      examAccessRes,
      examAttemptRes,
    ] = await Promise.all([
      client.models.UserProfile.list({ limit: 1000 }),
      client.models.MockExam.list({ limit: 1000 }),
      client.models.ExamRequest.list({ limit: 2000 }),
      client.models.ExamAccess.list({ limit: 2000 }),
      client.models.ExamAttempt.list({ limit: 2000 }),
    ]);

    const [bacSimulationRes, bacRequestRes, bacAccessRes, bacSubmissionRes, bacEvaluationRes] =
      canLoadBac
        ? await Promise.all([
            client.models.BacSimulation.list({ limit: 1000 }),
            client.models.BacRequest.list({ limit: 2000 }),
            client.models.BacAccess.list({ limit: 2000 }),
            client.models.BacSubmission.list({ limit: 2000 }),
            client.models.BacEvaluation.list({ limit: 2000 }),
          ])
        : [null, null, null, null, null];

    if (profileRes.errors?.length) console.error(profileRes.errors);
    if (examRes.errors?.length) console.error(examRes.errors);
    if (examRequestRes.errors?.length) console.error(examRequestRes.errors);
    if (examAccessRes.errors?.length) console.error(examAccessRes.errors);
    if (examAttemptRes.errors?.length) console.error(examAttemptRes.errors);
    if (bacSimulationRes?.errors?.length) console.error(bacSimulationRes.errors);
    if (bacRequestRes?.errors?.length) console.error(bacRequestRes.errors);
    if (bacAccessRes?.errors?.length) console.error(bacAccessRes.errors);
    if (bacSubmissionRes?.errors?.length) console.error(bacSubmissionRes.errors);
    if (bacEvaluationRes?.errors?.length) console.error(bacEvaluationRes.errors);

    setProfiles((profileRes.data ?? []).filter(notNull));
    setExams((examRes.data ?? []).filter(notNull));
    setExamRequests((examRequestRes.data ?? []).filter(notNull));
    setExamAccess((examAccessRes.data ?? []).filter(notNull));
    setExamAttempts((examAttemptRes.data ?? []).filter(notNull));
    setBacSimulations((bacSimulationRes?.data ?? []).filter(notNull));
    setBacRequests((bacRequestRes?.data ?? []).filter(notNull));
    setBacAccess((bacAccessRes?.data ?? []).filter(notNull));
    setBacSubmissions((bacSubmissionRes?.data ?? []).filter(notNull));
    setBacEvaluations((bacEvaluationRes?.data ?? []).filter(notNull));

    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((err) => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const profilesByOwner = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const profile of profiles) {
      if (profile.id) map.set(profile.id, profile);
    }
    return map;
  }, [profiles]);

  const examTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const exam of exams) map.set(exam.id, exam.title ?? exam.id);
    return map;
  }, [exams]);

  const bacTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const simulation of bacSimulations) map.set(simulation.id, simulation.title ?? simulation.id);
    return map;
  }, [bacSimulations]);

  const people = useMemo<PersonRow[]>(() => {
    const owners = new Set<string>();

    for (const profile of profiles) {
      if (profile.id) owners.add(profile.id);
    }
    for (const request of examRequests) {
      if (request.owner) owners.add(request.owner);
    }
    for (const access of examAccess) {
      if (access.owner) owners.add(access.owner);
    }
    for (const attempt of examAttempts) {
      if (attempt.userId) owners.add(attempt.userId);
    }
    for (const request of bacRequests) {
      if (request.owner) owners.add(request.owner);
    }
    for (const access of bacAccess) {
      if (access.owner) owners.add(access.owner);
    }
    for (const submission of bacSubmissions) {
      if (submission.owner) owners.add(submission.owner);
    }
    for (const evaluation of bacEvaluations) {
      if (evaluation.submissionOwner) owners.add(evaluation.submissionOwner);
    }

    return Array.from(owners)
      .map((owner) => {
        const profile = profilesByOwner.get(owner) ?? null;
        const ownerExamRequests = examRequests.filter((request) => request.owner === owner);
        const ownerExamAccess = examAccess.filter((access) => access.owner === owner);
        const ownerExamAttempts = examAttempts.filter((attempt) => attempt.userId === owner);
        const ownerBacRequests = bacRequests.filter((request) => request.owner === owner);
        const ownerBacAccess = bacAccess.filter((access) => access.owner === owner);
        const ownerBacSubmissions = bacSubmissions.filter((submission) => submission.owner === owner);
        const ownerBacEvaluations = bacEvaluations.filter(
          (evaluation) => evaluation.submissionOwner === owner
        );
        const email =
          ownerBacRequests.find((request) => request.requesterEmail)?.requesterEmail ?? null;

        const lastActivityMs = latestTimestamp([
          ...ownerExamRequests.map((request) => request.requestedAt),
          ...ownerExamAccess.map((access) => access.grantedAt),
          ...ownerExamAttempts.map((attempt) => attempt.submittedAt ?? attempt.startedAt),
          ...ownerBacRequests.map((request) => request.requestedAt),
          ...ownerBacAccess.map((access) => access.grantedAt),
          ...ownerBacSubmissions.map((submission) => submission.updatedAt ?? submission.submittedAt),
          ...ownerBacEvaluations.map((evaluation) => evaluation.updatedAt ?? evaluation.gradedAt),
        ]);

        return {
          owner,
          profile,
          displayName: displayNameForProfile(owner, profile),
          email,
          admissionRequests: ownerExamRequests,
          admissionAccess: ownerExamAccess,
          admissionAttempts: ownerExamAttempts,
          bacRequests: ownerBacRequests,
          bacAccess: ownerBacAccess,
          bacSubmissions: ownerBacSubmissions,
          bacEvaluations: ownerBacEvaluations,
          lastActivityMs,
        };
      })
      .sort((a, b) => {
        if (b.lastActivityMs !== a.lastActivityMs) return b.lastActivityMs - a.lastActivityMs;
        return a.displayName.localeCompare(b.displayName, "ro");
      });
  }, [
    bacAccess,
    bacEvaluations,
    bacRequests,
    bacSubmissions,
    examAccess,
    examAttempts,
    examRequests,
    profiles,
    profilesByOwner,
  ]);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;

    return people.filter((person) => {
      const profile = person.profile;
      const searchable = [
        person.owner,
        person.displayName,
        person.email ?? "",
        profile?.county ?? "",
        profile?.highSchool ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(q);
    });
  }, [people, query]);

  const selectedPerson = useMemo(() => {
    return filteredPeople.find((person) => person.owner === selectedOwner) ?? filteredPeople[0] ?? null;
  }, [filteredPeople, selectedOwner]);

  useEffect(() => {
    if (!selectedPerson) {
      setSelectedOwner(null);
      return;
    }
    if (selectedOwner !== selectedPerson.owner) {
      setSelectedOwner(selectedPerson.owner);
    }
  }, [selectedOwner, selectedPerson]);

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack">
          <section className="panel-top-row">
            <div>
              <div className="page-title">Administrator • Persoane</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Profiluri, cereri, acces, lucrări și rezultate într-un singur loc.
              </div>
            </div>
            <div className="panel-actions">
              <OutlineButton onClick={() => router.push("/admin")}>Console</OutlineButton>
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Reîncarcă
              </OutlineButton>
            </div>
          </section>

          <Card>
            <div className="section-title">Căutare</div>
            {!bacBackendAvailable ? (
              <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                Activitatea Bac nu poate fi încărcată deoarece configurația Amplify curentă nu conține
                modelele Bac. Datele de admitere rămân disponibile.
              </div>
            ) : null}
            <div style={{ marginTop: 12, maxWidth: 680 }}>
              <input
                className="field-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Caută după nume, email Bac, județ, liceu sau ID"
              />
            </div>

            <div className="metric-grid">
              <div className="metric-tile soft-blue">
                <div className="metric-label">Persoane</div>
                <div className="metric-value">{people.length}</div>
                <div className="metric-helper">profile și utilizatori activi</div>
              </div>
              <div className="metric-tile soft-mint">
                <div className="metric-label">Accese admitere</div>
                <div className="metric-value">{examAccess.length}</div>
                <div className="metric-helper">aprobări acordate</div>
              </div>
              <div className="metric-tile soft-lilac">
                <div className="metric-label">Accese bacalaureat</div>
                <div className="metric-value">{bacAccess.length}</div>
                <div className="metric-helper">participări aprobate</div>
              </div>
              <div className="metric-tile">
                <div className="metric-label">Lucrări Bac</div>
                <div className="metric-value">{bacSubmissions.length}</div>
                <div className="metric-helper">documente încărcate</div>
              </div>
            </div>
          </Card>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              alignItems: "start",
            }}
          >
            <Card>
              <div className="section-title">Listă persoane</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                {loading ? "Se încarcă…" : `${filteredPeople.length} persoane afișate`}
              </div>

              <div className="exam-list" style={{ marginTop: 14 }}>
                {filteredPeople.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există persoane pentru filtrul curent.
                  </p>
                ) : (
                  filteredPeople.map((person) => {
                    const active = selectedPerson?.owner === person.owner;

                    return (
                      <button
                        key={person.owner}
                        type="button"
                        onClick={() => setSelectedOwner(person.owner)}
                        className="exam-item"
                        style={{
                          textAlign: "left",
                          cursor: "pointer",
                          borderColor: active ? "#5b7cfa" : "var(--border)",
                          boxShadow: active ? "0 0 0 3px rgba(91,124,250,0.12)" : "none",
                        }}
                      >
                        <span className="exam-item-title">{person.displayName}</span>
                        <span className="small">{person.email ?? "Email indisponibil"}</span>
                        <span className="small" style={{ opacity: 0.75 }}>
                          ID: {compactOwner(person.owner)}
                        </span>
                        <span className="small" style={{ opacity: 0.85 }}>
                          Admitere: {person.admissionAccess.length} accese,{" "}
                          {person.admissionAttempts.length} încercări
                        </span>
                        <span className="small" style={{ opacity: 0.85 }}>
                          Bac: {person.bacAccess.length} accese, {person.bacSubmissions.length} lucrări
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>

            <Card>
              {!selectedPerson ? (
                <p className="small" style={{ margin: 0 }}>
                  Selectează o persoană pentru detalii.
                </p>
              ) : (
                <div className="panel-stack">
                  <div>
                    <div className="section-title">{selectedPerson.displayName}</div>
                    <div className="small" style={{ marginTop: 6 }}>
                      ID complet: {selectedPerson.owner}
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      Email Bac: {selectedPerson.email ?? "nu este disponibil"}
                    </div>
                  </div>

                  <div className="metric-grid">
                    <div className="metric-tile soft-blue">
                      <div className="metric-label">Cereri admitere</div>
                      <div className="metric-value">{selectedPerson.admissionRequests.length}</div>
                      <div className="metric-helper">
                        {selectedPerson.admissionRequests.filter((r) => r.status === "PENDING").length} în așteptare
                      </div>
                    </div>
                    <div className="metric-tile soft-mint">
                      <div className="metric-label">Încercări admitere</div>
                      <div className="metric-value">{selectedPerson.admissionAttempts.length}</div>
                      <div className="metric-helper">simulări trimise</div>
                    </div>
                    <div className="metric-tile soft-lilac">
                      <div className="metric-label">Cereri Bac</div>
                      <div className="metric-value">{selectedPerson.bacRequests.length}</div>
                      <div className="metric-helper">
                        {selectedPerson.bacRequests.filter((r) => r.status === "PENDING").length} în așteptare
                      </div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-label">Evaluări Bac</div>
                      <div className="metric-value">{selectedPerson.bacEvaluations.length}</div>
                      <div className="metric-helper">note salvate</div>
                    </div>
                  </div>

                  <div className="exam-item">
                    <div className="exam-item-title">Profil</div>
                    <div className="small">Prenume: {selectedPerson.profile?.firstName ?? "—"}</div>
                    <div className="small">Nume: {selectedPerson.profile?.lastName ?? "—"}</div>
                    <div className="small">Județ: {selectedPerson.profile?.county ?? "—"}</div>
                    <div className="small">Vârstă: {selectedPerson.profile?.age ?? "—"}</div>
                    <div className="small">Liceu: {selectedPerson.profile?.highSchool ?? "—"}</div>
                  </div>

                  <div className="exam-item">
                    <div className="exam-item-title">Admitere</div>
                    {selectedPerson.admissionRequests.length === 0 &&
                    selectedPerson.admissionAccess.length === 0 &&
                    selectedPerson.admissionAttempts.length === 0 ? (
                      <p className="small" style={{ margin: 0 }}>
                        Nu există activitate la simulări de admitere.
                      </p>
                    ) : (
                      <div className="panel-stack">
                        {selectedPerson.admissionRequests.map((request) => (
                          <div key={`request-${request.owner}-${request.examId}`} className="small">
                            Cerere: {examTitleById.get(request.examId ?? "") ?? request.examId ?? "—"} •{" "}
                            {statusLabel(request.status)} • {formatWhen(request.requestedAt)}
                          </div>
                        ))}
                        {selectedPerson.admissionAccess.map((access) => (
                          <div key={`access-${access.owner}-${access.examId}`} className="small">
                            Acces: {examTitleById.get(access.examId ?? "") ?? access.examId ?? "—"} •{" "}
                            {formatWhen(access.grantedAt)}
                          </div>
                        ))}
                        {selectedPerson.admissionAttempts.map((attempt) => (
                          <div key={`attempt-${attempt.userId}-${attempt.examId}-${attempt.submittedAt}`} className="small">
                            Trimitere: {examTitleById.get(attempt.examId ?? "") ?? attempt.examId ?? "—"} •{" "}
                            {attempt.score ?? "—"}/{attempt.maxScore ?? "—"} •{" "}
                            {formatWhen(attempt.submittedAt)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="exam-item">
                    <div className="exam-item-title">Bacalaureat</div>
                    {selectedPerson.bacRequests.length === 0 &&
                    selectedPerson.bacAccess.length === 0 &&
                    selectedPerson.bacSubmissions.length === 0 &&
                    selectedPerson.bacEvaluations.length === 0 ? (
                      <p className="small" style={{ margin: 0 }}>
                        Nu există activitate la simulări de bacalaureat.
                      </p>
                    ) : (
                      <div className="panel-stack">
                        {selectedPerson.bacRequests.map((request) => (
                          <div key={`bac-request-${request.owner}-${request.simulationId}`} className="small">
                            Cerere: {bacTitleById.get(request.simulationId ?? "") ?? request.simulationId ?? "—"} •{" "}
                            {statusLabel(request.status)} • {formatWhen(request.requestedAt)}
                          </div>
                        ))}
                        {selectedPerson.bacAccess.map((access) => (
                          <div key={`bac-access-${access.owner}-${access.simulationId}`} className="small">
                            Acces: {bacTitleById.get(access.simulationId ?? "") ?? access.simulationId ?? "—"} •{" "}
                            {formatWhen(access.grantedAt)}
                          </div>
                        ))}
                        {selectedPerson.bacSubmissions.map((submission) => (
                          <div key={`bac-submission-${submission.owner}-${submission.simulationId}`} className="small">
                            Lucrare: {bacTitleById.get(submission.simulationId ?? "") ?? submission.simulationId ?? "—"} •{" "}
                            {submission.solutionOriginalName ?? "document"} •{" "}
                            {formatWhen(submission.submittedAt)}
                          </div>
                        ))}
                        {selectedPerson.bacEvaluations.map((evaluation) => (
                          <div key={`bac-evaluation-${evaluation.submissionOwner}-${evaluation.simulationId}`} className="small">
                            Evaluare: {bacTitleById.get(evaluation.simulationId ?? "") ?? evaluation.simulationId ?? "—"} •{" "}
                            {evaluation.manualGrade ?? "—"}/{evaluation.maxGrade ?? "—"} •{" "}
                            {formatWhen(evaluation.gradedAt ?? evaluation.updatedAt)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </PageShell>
    </>
  );
}

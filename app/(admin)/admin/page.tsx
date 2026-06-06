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

type Exam = Schema["MockExam"]["type"];
type BacSimulation = Schema["BacSimulation"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];
type BacRequest = Schema["BacRequest"]["type"];
type Profile = Schema["UserProfile"]["type"];

export default function AdminHomePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<Exam[]>([]);
  const [bacSimulations, setBacSimulations] = useState<BacSimulation[]>([]);
  const [examRequests, setExamRequests] = useState<ExamRequest[]>([]);
  const [bacRequests, setBacRequests] = useState<BacRequest[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bacBackendAvailable, setBacBackendAvailable] = useState(true);

  async function refresh() {
    setLoading(true);

    const canLoadBac = hasBacModels(client.models);
    setBacBackendAvailable(canLoadBac);

    const [examRes, examReqRes, profileRes] = await Promise.all([
      client.models.MockExam.list({ limit: 500 }),
      client.models.ExamRequest.list({ limit: 1000 }),
      client.models.UserProfile.list({ limit: 1000 }),
    ]);

    const [bacRes, bacReqRes] = canLoadBac
      ? await Promise.all([
          client.models.BacSimulation.list({ limit: 500 }),
          client.models.BacRequest.list({ limit: 1000 }),
        ])
      : [null, null];

    if (examRes.errors?.length) console.error(examRes.errors);
    if (examReqRes.errors?.length) console.error(examReqRes.errors);
    if (profileRes.errors?.length) console.error(profileRes.errors);
    if (bacRes?.errors?.length) console.error(bacRes.errors);
    if (bacReqRes?.errors?.length) console.error(bacReqRes.errors);

    setExams((examRes.data ?? []).filter(notNull));
    setExamRequests((examReqRes.data ?? []).filter(notNull));
    setProfiles((profileRes.data ?? []).filter(notNull));
    setBacSimulations((bacRes?.data ?? []).filter(notNull));
    setBacRequests((bacReqRes?.data ?? []).filter(notNull));
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((err) => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const pendingExamRequests = useMemo(
    () => examRequests.filter((request) => request.status === "PENDING"),
    [examRequests]
  );
  const pendingBacRequests = useMemo(
    () => bacRequests.filter((request) => request.status === "PENDING"),
    [bacRequests]
  );
  const upcomingExams = useMemo(
    () =>
      exams
        .filter((exam) => toTimestamp(exam.startAt) >= Date.now())
        .sort((a, b) => toTimestamp(a.startAt) - toTimestamp(b.startAt))
        .slice(0, 4),
    [exams]
  );
  const upcomingBac = useMemo(
    () =>
      bacSimulations
        .filter((simulation) => toTimestamp(simulation.startAt) >= Date.now())
        .sort((a, b) => toTimestamp(a.startAt) - toTimestamp(b.startAt))
        .slice(0, 4),
    [bacSimulations]
  );

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack">
          <section className="panel-top-row">
            <div>
              <div className="page-title">Admin Console</div>
              <div className="page-subtitle" style={{ marginTop: 6 }}>
                Centrul de control pentru simulări, cereri, participanți și elevi.
              </div>
            </div>
            <div className="panel-actions">
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Reîncarcă
              </OutlineButton>
            </div>
          </section>

          <Card>
            <div className="section-title">Privire de ansamblu</div>
            <div className="metric-grid">
              <div className="metric-tile soft-blue">
                <div className="metric-label">Simulări admitere</div>
                <div className="metric-value">{exams.length}</div>
                <div className="metric-helper">teste configurate</div>
              </div>
              <div className="metric-tile soft-mint">
                <div className="metric-label">Simulări bacalaureat</div>
                <div className="metric-value">{bacSimulations.length}</div>
                <div className="metric-helper">subiecte scrise</div>
              </div>
              <div className="metric-tile soft-lilac">
                <div className="metric-label">Cereri în așteptare</div>
                <div className="metric-value">
                  {pendingExamRequests.length + pendingBacRequests.length}
                </div>
                <div className="metric-helper">admitere și bacalaureat</div>
              </div>
              <div className="metric-tile">
                <div className="metric-label">Profile elevi</div>
                <div className="metric-value">{profiles.length}</div>
                <div className="metric-helper">persoane cu profil completat</div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="section-title">Acțiuni administrative</div>
            {!bacBackendAvailable ? (
              <div className="small" style={{ marginTop: 8, color: "#8a5b00" }}>
                Modelele Bac nu sunt în configurația Amplify curentă. Regenerază{" "}
                <code>amplify_outputs.json</code> după deploy-ul backendului.
              </div>
            ) : null}
            <div className="exam-actions">
              <OutlineButton onClick={() => router.push("/admin/exams")}>
                Creează simulare admitere
              </OutlineButton>
              <OutlineButton
                onClick={() => router.push("/admin/bac")}
                disabled={!bacBackendAvailable}
              >
                Creează simulare bacalaureat
              </OutlineButton>
              <OutlineButton onClick={() => router.push("/admin/requests")}>
                Aprobă cereri
              </OutlineButton>
              <OutlineButton onClick={() => router.push("/admin/people")}>
                Vezi persoane
              </OutlineButton>
            </div>
          </Card>

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <Card>
              <div className="section-title">Următoarele simulări de admitere</div>
              <div className="exam-list">
                {upcomingExams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări viitoare.
                  </p>
                ) : (
                  upcomingExams.map((exam) => (
                    <div key={exam.id} className="exam-item">
                      <div className="exam-item-title">{exam.title}</div>
                      <div className="small">{exam.admissionType}</div>
                      <div className="small">Începe: {formatWhen(exam.startAt)}</div>
                      <div className="exam-actions">
                        <OutlineButton onClick={() => router.push(`/admin/exams/${exam.id}`)}>
                          Detalii
                        </OutlineButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="section-title">Următoarele simulări de bacalaureat</div>
              <div className="exam-list">
                {upcomingBac.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există simulări viitoare.
                  </p>
                ) : (
                  upcomingBac.map((simulation) => (
                    <div key={simulation.id} className="exam-item">
                      <div className="exam-item-title">{simulation.title}</div>
                      <div className="small">{simulation.subject}</div>
                      <div className="small">Începe: {formatWhen(simulation.startAt)}</div>
                      <div className="exam-actions">
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
        </div>
      </PageShell>
    </>
  );
}

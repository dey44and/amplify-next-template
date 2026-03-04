"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen } from "@/lib/dateTime";
import { isAdmin } from "@/lib/isAdmin";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Exam = Schema["MockExam"]["type"];
type ExamRequest = Schema["ExamRequest"]["type"];
type Profile = Schema["UserProfile"]["type"];

export default function AdminRequestsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState<ExamRequest[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [profilesByOwner, setProfilesByOwner] = useState<Map<string, Profile>>(new Map());
  const [noteByKey, setNoteByKey] = useState<Record<string, string>>({});
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  const examTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of exams) m.set(e.id, e.title ?? e.id);
    return m;
  }, [exams]);

  async function refresh() {
    setLoading(true);

    const reqRes = await client.models.ExamRequest.list({
      filter: { status: { eq: "PENDING" } },
      limit: 500,
    });
    if (reqRes.errors?.length) console.error(reqRes.errors);
    const pendingRequests = reqRes.data ?? [];
    setRequests(pendingRequests);

    const examsRes = await client.models.MockExam.list({ limit: 500 });
    if (examsRes.errors?.length) console.error(examsRes.errors);
    setExams(examsRes.data ?? []);

    const ownerIds = Array.from(
      new Set(
        pendingRequests
          .map((r) => r.owner)
          .filter((owner): owner is string => Boolean(owner))
      )
    );

    if (ownerIds.length === 0) {
      setProfilesByOwner(new Map());
      setLoading(false);
      return;
    }

    const profileResults = await Promise.all(
      ownerIds.map(async (ownerId) => {
        const res = await client.models.UserProfile.get({ id: ownerId });
        if (res.errors?.length) {
          console.error(`UserProfile.get failed for ${ownerId}:`, res.errors);
        }
        return [ownerId, res.data ?? null] as const;
      })
    );

    const nextProfiles = new Map<string, Profile>();
    for (const [ownerId, profile] of profileResults) {
      if (profile) nextProfiles.set(ownerId, profile);
    }
    setProfilesByOwner(nextProfiles);

    setLoading(false);
  }

  function formatRequester(owner?: string | null) {
    const ownerId = String(owner ?? "").trim();
    if (!ownerId) return "—";

    const profile = profilesByOwner.get(ownerId);
    const firstName = String(profile?.firstName ?? "").trim();
    const lastName = String(profile?.lastName ?? "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    if (fullName) return `${fullName} (${ownerId})`;
    return ownerId;
  }

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Auth gate -> /login
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }

      // Admin gate -> /dashboard
      const ok = await isAdmin();
      if (!ok) {
        router.replace("/dashboard");
        return;
      }

      await refresh();
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function decide(req: ExamRequest, status: "APPROVED" | "REJECTED") {
    const owner = req.owner;
    const examId = req.examId;
    if (!owner || !examId) return;

    const key = `${owner}::${examId}`;
    const note = (noteByKey[key] ?? "").trim();

    setWorkingKey(key);
    try {
      const res = await client.mutations.decideExamRequest({
        owner,
        examId,
        status,
        note: note || undefined,
      });

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Actualizarea cererii a eșuat (verifică consola).");
        return;
      }

      // Remove from UI immediately
      setRequests((prev) =>
        prev.filter((r) => !(r.owner === owner && r.examId === examId))
      );
    } finally {
      setWorkingKey(null);
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    outline: "none",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    background: "#fff",
    color: "var(--fg)",
  };

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack">
          <div className="panel-top-row">
            <div className="page-title">Administrator • Cereri</div>

            <div className="small" style={{ marginLeft: 8 }}>
              Aprobă sau respinge cererile de acces la examene.
            </div>

            <div className="panel-actions">
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Reîncarcă
              </OutlineButton>
            </div>
          </div>

          <Card>
            <div className="section-title">Cereri în așteptare</div>

            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {loading ? (
                <p className="small" style={{ margin: 0 }}>
                  Se încarcă…
                </p>
              ) : requests.length === 0 ? (
                <p className="small" style={{ margin: 0 }}>
                  Nu există cereri în așteptare.
                </p>
              ) : (
                requests.map((r) => {
                  const owner = r.owner;
                  const examId = r.examId;
                  const key = `${owner ?? "?"}::${examId ?? "?"}`;

                  return (
                    <div
                      key={key}
                      style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: 12,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 760, letterSpacing: -0.2 }}>
                        {examTitleById.get(examId ?? "") ?? examId ?? "Simulare necunoscută"}
                      </div>

                      <div className="small" style={{ opacity: 0.85 }}>
                        ID simulare: {examId ?? "—"}
                      </div>

                      <div className="small">
                        Elev: <span style={{ opacity: 0.85 }}>{formatRequester(owner)}</span>
                      </div>

                      <div className="small" style={{ opacity: 0.85 }}>
                        Solicitat la: {formatWhen(r.requestedAt)}
                      </div>

                      <input
                        placeholder="Notă opțională (afișată elevului ulterior, dacă o folosești)"
                        value={noteByKey[key] ?? ""}
                        onChange={(e) => setNoteByKey((p) => ({ ...p, [key]: e.target.value }))}
                        style={inputStyle}
                      />

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <OutlineButton
                          onClick={() => decide(r, "APPROVED")}
                          disabled={workingKey === key}
                        >
                          {workingKey === key ? "Se procesează…" : "Aprobă"}
                        </OutlineButton>

                        <button
                          onClick={() => decide(r, "REJECTED")}
                          disabled={workingKey === key}
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
                          Respinge
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </PageShell>
    </>
  );
}

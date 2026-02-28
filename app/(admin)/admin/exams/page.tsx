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

export default function AdminExamsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [exams, setExams] = useState<Exam[]>([]);
  const [form, setForm] = useState({
    title: "",
    admissionType: "",
    startAt: "", // datetime-local
    durationMinutes: "", // string
  });
  const [creating, setCreating] = useState(false);

  const inputStyle = useMemo<React.CSSProperties>(
    () => ({
      padding: "12px 12px",
      borderRadius: 12,
      border: "1px solid var(--border)",
      outline: "none",
      fontSize: 14,
      width: "100%",
      boxSizing: "border-box",
      background: "#fff",
      color: "var(--fg)",
    }),
    []
  );

  async function refresh() {
    const res = await client.models.MockExam.list({ limit: 200 });
    if (res.errors?.length) console.error(res.errors);
    setExams(res.data ?? []);
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
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function createExam() {
    const title = form.title.trim();
    const admissionType = form.admissionType.trim();
    const startAtLocal = form.startAt.trim();
    const durStr = form.durationMinutes.trim();

    if (!title || !admissionType || !startAtLocal || !durStr) {
      alert("Completează titlul, tipul de admitere, ora de start și durata.");
      return;
    }

    const durationMinutes = Number(durStr);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      alert("Durata trebuie să fie un număr întreg pozitiv (minute).");
      return;
    }

    // datetime-local -> ISO string (UTC)
    const startAt = new Date(startAtLocal).toISOString();

    setCreating(true);
    try {
      const res = await client.models.MockExam.create({
        title,
        admissionType,
        startAt,
        durationMinutes,
      });

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Crearea simulării a eșuat (verifică consola).");
        return;
      }

      setForm({ title: "", admissionType: "", startAt: "", durationMinutes: "" });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function deleteExam(id: string) {
    if (!confirm("Ștergi această simulare?")) return;

    const res = await client.models.MockExam.delete({ id });
    if (res.errors?.length) {
      console.error(res.errors);
      alert("Ștergerea simulării a eșuat.");
      return;
    }
    setExams((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        <div className="panel-stack">
          <div className="panel-top-row">
            <div className="page-title">Administrator • Simulări</div>

            <div className="small" style={{ marginLeft: 8 }}>
              Creează și gestionează simulări.
            </div>
          </div>

          {/* Create */}
          <Card>
            <div className="section-title">Creează simulare</div>

            <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 720 }}>
              <input
                placeholder="Titlu"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                disabled={creating}
                style={inputStyle}
              />

              <input
                placeholder="Tip admitere (ex.: Inginerie Calculatoare)"
                value={form.admissionType}
                onChange={(e) => setForm({ ...form, admissionType: e.target.value })}
                disabled={creating}
                style={inputStyle}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 10 }}>
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  disabled={creating}
                  style={inputStyle}
                />

                {/* <input
                  inputMode="numeric"
                  placeholder="Durată (min)"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  disabled={creating}
                  style={inputStyle}
                /> */}
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Durată (min)"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <OutlineButton onClick={createExam} disabled={creating}>
                  {creating ? "Se creează…" : "Creează"}
                </OutlineButton>
              </div>
            </div>
          </Card>

          {/* List */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                <div className="section-title">Simulări existente</div>
                <div className="small" style={{ marginTop: 6 }}>
                  Apasă pe o simulare ca să gestionezi itemii (întrebările).
                </div>
              </div>
              <OutlineButton onClick={() => refresh()} disabled={loading}>
                Reîncarcă
              </OutlineButton>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {loading ? (
                <p className="small" style={{ margin: 0 }}>
                  Se încarcă…
                </p>
              ) : exams.length === 0 ? (
                <p className="small" style={{ margin: 0 }}>
                  Nu există simulări încă.
                </p>
              ) : (
                exams.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: 12,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ fontWeight: 760, letterSpacing: -0.2 }}>{e.title}</div>

                    <div className="small">Tip admitere: {e.admissionType}</div>

                    <div className="small" style={{ opacity: 0.85 }}>
                      Începe: {formatWhen(e.startAt)} • Durată: {e.durationMinutes ?? "—"} min
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      <OutlineButton onClick={() => router.push(`/admin/exams/${e.id}`)}>
                        Gestionează itemii
                      </OutlineButton>

                      <button
                        onClick={() => deleteExam(e.id)}
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
                        Șterge
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </PageShell>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import {
  deleteUser,
  fetchAuthSession,
  getCurrentUser,
  signOut,
} from "aws-amplify/auth";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];
type Exam = Schema["MockExam"]["type"];

async function checkIsAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

export default function DashboardPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginId, setLoginId] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);

      // auth gate: if signed out -> /login
      let current;
      try {
        current = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }

      setLoginId(current.signInDetails?.loginId ?? current.username ?? "");

      setIsAdmin(await checkIsAdmin());

      // owner-scoped, no filter needed
      const profileRes = await client.models.UserProfile.list({ limit: 1 });
      const p = profileRes.data?.[0] ?? null;

      if (!p) {
        router.replace("/profile");
        return;
      }
      setProfile(p);

      const examsRes = await client.models.MockExam.list({ limit: 200 });
      setExams(examsRes.data ?? []);

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function handleDeleteAccount() {
    const ok = window.confirm("Delete your profile + account? This cannot be undone.");
    if (!ok) return;

    const res = await client.models.UserProfile.list();
    for (const p of res.data ?? []) {
      await client.models.UserProfile.delete({ id: p.id });
    }
    await deleteUser();
    router.replace("/login");
  }

  return (
    <>
      <SiteHeader
        rightSlot={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="small" style={{ opacity: 0.75 }}>
              {loginId}
            </span>
            <OutlineButton
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </OutlineButton>
          </div>
        }
      />

      <PageShell>
        {loading ? (
          <p className="small">Loading dashboard…</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>
                Welcome, {profile?.firstName} {profile?.lastName}
              </div>

              <div style={{ display: "flex", gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
                {isAdmin && (
                  <OutlineButton onClick={() => router.push("/admin/exams")}>
                    Admin exams
                  </OutlineButton>
                )}
              </div>
            </div>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4 }}>
                    Available mock exams
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Choose an exam and start practicing.
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {exams.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No exams yet. (An Admin must create them.)
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
                      <div style={{ fontWeight: 900, letterSpacing: -0.2 }}>{e.title}</div>
                      <div className="small">Admission type: {e.admissionType}</div>

                      <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                        <OutlineButton onClick={() => router.push(`/exam/${e.id}`)}>
                          Start exam
                        </OutlineButton>

                        {isAdmin && (
                          <button
                            onClick={() => router.push(`/admin/exams/${e.id}`)}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "10px 0",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 700,
                              color: "rgba(0,0,0,0.7)",
                              textDecoration: "underline",
                            }}
                          >
                            Edit (Admin)
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Danger zone kept out of the header */}
            <div style={{ marginTop: 6 }}>
              <button
                onClick={handleDeleteAccount}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                  color: "rgba(0,0,0,0.55)",
                  textDecoration: "underline",
                }}
              >
                Delete account
              </button>
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}

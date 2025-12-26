"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { deleteUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];
type Exam = Schema["MockExam"]["type"];

function DashboardInner() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // 1) Ensure profile exists (owner() => only returns current user's profile)
      const profileRes = await client.models.UserProfile.list({ limit: 1 });
      const p = profileRes.data?.[0] ?? null;

      if (!p) {
        router.replace("/profile");
        return;
      }
      setProfile(p);

      // 2) Load mock exams (authenticated users can read per your schema)
      const examsRes = await client.models.MockExam.list({ limit: 50 });
      setExams(examsRes.data ?? []);

      setLoading(false);
    }

    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  if (loading) return <p style={{ padding: 24 }}>Loading dashboard…</p>;

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <p style={{ margin: "8px 0 0 0" }}>
            Welcome, {profile?.firstName} {profile?.lastName}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => router.push("/profile")}
            style={{ padding: "8px 12px" }}
          >
            Edit profile
          </button>
        </div>
      </header>

      <section style={{ padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>Available mock exams</h2>

        {exams.length === 0 ? (
          <p>No exams yet. (An Admin must create them.)</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {exams.map((e) => (
              <li key={e.id} style={{ margin: "10px 0" }}>
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  Admission type: {e.admissionType}
                </div>

                {/* Later you can create /exam/[id] and navigate there */}
                <button
                  onClick={() => router.push(`/exam/${e.id}`)}
                  style={{ marginTop: 8, padding: "6px 10px" }}
                >
                  Start exam
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function DashboardPage() {
  async function handleDeleteAccount() {
    const ok = window.confirm(
      "This will delete your account from Cognito. Continue?"
    );
    if (!ok) return;
    await deleteUser(); // deletes the currently signed-in user and signs them out
  }

  return (
    <Authenticator>
      {({ user, signOut }) => (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ padding: 24, display: "flex", gap: 8 }}>
            <button onClick={signOut} style={{ padding: "8px 12px" }}>
              Sign out
            </button>
            <button onClick={handleDeleteAccount} style={{ padding: "8px 12px" }}>
              Delete account
            </button>

            <div style={{ marginLeft: "auto", opacity: 0.7 }}>
              {user?.signInDetails?.loginId ?? user?.username}
            </div>
          </div>

          <DashboardInner />
        </div>
      )}
    </Authenticator>
  );
}

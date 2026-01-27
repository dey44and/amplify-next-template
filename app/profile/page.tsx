"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();
type Profile = Schema["UserProfile"]["type"];

export default function ProfilePage() {
  const router = useRouter();

  const [existing, setExisting] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    county: "",
    age: "",
    highSchool: "",
  });

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Protect route: if not logged in -> /login
      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId;
      } catch {
        router.replace("/login");
        return;
      }

      // With owner() auth, list() already returns only this user’s profile.
      const res = await client.models.UserProfile.list({ limit: 1 });
      if (res.errors?.length) console.error(res.errors);

      const p = res.data?.[0] ?? null;
      setExisting(p);

      if (p) {
        setForm({
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          county: p.county ?? "",
          age: p.age != null ? String(p.age) : "",
          highSchool: p.highSchool ?? "",
        });
      } else {
        // If no profile exists, keep empty form
        setForm({ firstName: "", lastName: "", county: "", age: "", highSchool: "" });
      }

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [router]);

  async function onSave() {
    setSaving(true);
    try {
      let userId: string;
      try {
        const u = await getCurrentUser();
        userId = u.userId;
      } catch {
        router.replace("/login");
        return;
      }

      const ageStr = form.age.trim();
      let age: number | undefined;

      if (ageStr !== "") {
        const n = Number(ageStr);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          alert("Age must be an integer number.");
          return;
        }
        age = n;
      }

      const payload = {
        userId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        county: form.county.trim(),
        highSchool: form.highSchool.trim(),
        ...(age === undefined ? {} : { age }),
      };

      const res = existing
        ? await client.models.UserProfile.update({ id: existing.id, ...payload })
        : await client.models.UserProfile.create(payload);

      if (res.errors?.length) {
        console.error(res.errors);
        alert("Failed to save profile. Check console for details.");
        return;
      }

      router.replace("/dashboard");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SiteHeader
        rightSlot={
          <div style={{ display: "flex", gap: 10 }}>
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
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: -0.8 }}>
              {existing ? "Edit profile" : "Complete your profile"}
            </div>
            <div className="small">This information is visible only to you.</div>
          </div>

          <Card>
            {loading ? (
              <p className="small" style={{ margin: 0 }}>
                Loading profile…
              </p>
            ) : (
              <div style={{ display: "grid", gap: 14, maxWidth: 520 }}>
                {(
                  [
                    ["firstName", "First name"],
                    ["lastName", "Last name"],
                    ["county", "County"],
                    ["age", "Age"],
                    ["highSchool", "High school"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} style={{ display: "grid", gap: 6 }}>
                    <label className="small" style={{ color: "var(--fg)", fontWeight: 700 }}>
                      {label}
                    </label>
                    <input
                      value={form[k]}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      disabled={saving}
                      style={{
                        padding: "12px 12px",
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        outline: "none",
                        fontSize: 14,
                      }}
                    />
                  </div>
                ))}

                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <OutlineButton onClick={onSave} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </OutlineButton>
                  <OutlineButton
                    onClick={() => router.push("/dashboard")}
                    disabled={saving}
                    style={{ borderColor: "rgba(0,0,0,0.08)" }}
                  >
                    Cancel
                  </OutlineButton>
                </div>
              </div>
            )}
          </Card>
        </div>
      </PageShell>
    </>
  );
}

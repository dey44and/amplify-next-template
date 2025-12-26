"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

type Profile = Schema["UserProfile"]["type"];

function ProfileForm() {
  const router = useRouter();

  const [existing, setExisting] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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

      const { data, errors } = await client.models.UserProfile.list({ limit: 1 });
      if (errors) console.error(errors);

      const p = data?.[0] ?? null;
      setExisting(p);

      if (p) {
        setForm({
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          county: p.county ?? "",
          age: p.age != null ? String(p.age) : "",
          highSchool: p.highSchool ?? "",
        });
      }

      setLoading(false);
    })();
  }, []);

  async function onSave() {
    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      county: form.county,
      age: Number(form.age),
      highSchool: form.highSchool,
    };

    if (existing) {
      await client.models.UserProfile.update({
        id: existing.id,
        ...payload,
      });
    } else {
      await client.models.UserProfile.create(payload);
    }

    router.push("/dashboard");
  }

  if (loading) return <p style={{ padding: 24 }}>Loading profile…</p>;

  return (
    <main style={{ padding: 24 }}>
      <h1>{existing ? "Edit your profile" : "Complete your profile"}</h1>

      {(["firstName", "lastName", "county", "age", "highSchool"] as const).map((k) => (
        <div key={k} style={{ marginTop: 12 }}>
          <label style={{ display: "block" }}>{k}</label>
          <input
            value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            style={{ padding: 8, width: 320 }}
          />
        </div>
      ))}

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={onSave}>Save</button>
        <button onClick={() => router.push("/dashboard")}>Cancel</button>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Authenticator>
      {() => <ProfileForm />}
    </Authenticator>
  );
}

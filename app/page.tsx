"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

function AfterAuthGate() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      // owner() auth: list() will only return the signed-in user's own profile
      const { data, errors } = await client.models.UserProfile.list({ limit: 1 });
      if (errors) console.error(errors);

      if (!data || data.length === 0) {
        router.replace("/profile");
      } else {
        router.replace("/dashboard");
      }
      setChecking(false);
    })();
  }, [router]);

  return <p>{checking ? "Loading…" : "Redirecting…"}</p>;
}

export default function HomePage() {
  return (
    <main style={{ padding: 24 }}>
      <Authenticator>
        {() => (
          // Once authenticated, decide where to send them
          <AfterAuthGate />
        )}
      </Authenticator>
    </main>
  );
}

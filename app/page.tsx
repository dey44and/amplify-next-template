"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

export default function HomePage() {
  return (
    <main style={{ padding: 24 }}>
      <Authenticator>
        {({ user, signOut }) => (
          <div style={{ display: "grid", gap: 12 }}>
            <h1>Dashboard</h1>
            <p>Signed in as: {user?.signInDetails?.loginId ?? user?.username}</p>

            {/* Replace this with your real dashboard UI */}
            <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
              <h2>Mock Exams</h2>
              <p>Coming soon…</p>
            </div>

            <button onClick={signOut}>Sign out</button>
          </div>
        )}
      </Authenticator>
    </main>
  );
}

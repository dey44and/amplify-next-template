"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { Card } from "@/components/ui";
import type { AuthUser } from "aws-amplify/auth";

function AuthRedirect({ user }: { user?: AuthUser }) {
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  // must return an Element, not null
  return <div />;
}

export default function LoginPage() {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "1.1fr 0.9fr",
        background: "var(--bg)",
      }}
    >
      {/* LEFT: form side */}
      <div
        style={{
          padding: "48px 22px",
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
        }}
      >
        <div style={{ width: "min(520px, 100%)" }}>
          {/* Brand */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 900, letterSpacing: -0.5 }}>MOCK EXAMS</div>
            <button
              onClick={() => router.push("/")}
              style={{
                border: "1px solid var(--border)",
                background: "#fff",
                color: "var(--fg)",
                borderRadius: 12,
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Home
            </button>
          </div>

          {/* Title + copy */}
          <div style={{ marginTop: 26, marginBottom: 16 }}>
            <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>
              Ready to start your{" "}
              <span style={{ textDecoration: "underline" }}>success story</span>?
            </div>
            <p className="small" style={{ margin: "12px 0 0 0", lineHeight: 1.5 }}>
              Sign in or create an account to access upcoming mock exams, track your results, and
              improve your performance.
            </p>
          </div>

          {/* Form container */}
          <Card>
            <div style={{ marginBottom: 10, fontWeight: 800 }}>Sign in / Sign up</div>

            <Authenticator
              hideSignUp={false}
              components={{
                Header() {
                  // MUST return an Element (not null) to satisfy typings in prod builds
                  return <></>;
                },
                Footer() {
                  return (
                    <div className="small" style={{ marginTop: 12 }}>
                      By continuing, you agree to the Terms & Conditions.
                    </div>
                  );
                },
              }}
              formFields={{
                signIn: {
                  username: {
                    label: "Email",
                    placeholder: "you@example.com",
                    isRequired: true,
                  },
                },
                signUp: {
                  username: {
                    label: "Email",
                    placeholder: "you@example.com",
                    isRequired: true,
                  },
                  password: {
                    label: "Password",
                    placeholder: "Create a password",
                    isRequired: true,
                  },
                  confirm_password: {
                    label: "Confirm password",
                    placeholder: "Repeat password",
                    isRequired: true,
                  },
                },
              }}
            >
              {({ user }) => <AuthRedirect user={user} />}
            </Authenticator>
          </Card>

          <div className="small" style={{ marginTop: 14, opacity: 0.75 }}>
            Tip: If you were recently added to the Admin group, sign out and sign in again.
          </div>
        </div>
      </div>

      {/* RIGHT: illustration side */}
      <div
        style={{
          borderLeft: "1px solid var(--border)",
          background: "#fff",
          display: "grid",
          alignItems: "center",
          justifyItems: "center",
          padding: 22,
        }}
      >
        <div style={{ width: "min(560px, 100%)" }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3" }}>
            <Image
              src="/illustrations/study.png"
              alt="Study illustration"
              fill
              style={{ objectFit: "contain" }}
              priority
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, letterSpacing: -0.3 }}>
              Practice. Measure. Improve.
            </div>
            <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Take mock exams designed for your admission type and track your progress over time.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

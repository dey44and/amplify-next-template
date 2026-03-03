"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Authenticator } from "@aws-amplify/ui-react";
import { translations } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { I18n } from "aws-amplify/utils";

import { Card } from "@/components/ui";
import type { AuthUser } from "aws-amplify/auth";

I18n.putVocabularies(translations);
I18n.putVocabulariesForLanguage("ro", {
  "Sign In": "Autentificare",
  "Sign in": "Autentificare",
  "Sign Up": "Înregistrare",
  "Sign up": "Înregistrare",
  "Create Account": "Creează cont",
  "Create account": "Creează cont",
  "Forgot your password?": "Ai uitat parola?",
  "Reset your password": "Resetează parola",
  "Enter your username": "Introdu adresa de email",
  "Enter your Password": "Introdu parola",
  Password: "Parolă",
  "Confirm Password": "Confirmă parola",
  "Confirm password": "Confirmă parola",
  "Back to Sign In": "Înapoi la autentificare",
  "Send code": "Trimite codul",
  Submit: "Trimite",
  "Resend Code": "Retrimite codul",
});
I18n.setLanguage("ro");

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
    <div className="loginGrid">
      {/* LEFT: form side */}
      <div className="loginLeft"
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
            <div style={{ fontWeight: 780, letterSpacing: -0.5, fontSize: 30 }}>Mock Exams</div>
          </div>

          {/* Title + copy */}
          <div style={{ marginTop: 26, marginBottom: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -1 }}>
              Ești gata să începi{" "}
              <span>povestea ta de succes</span>?
            </div>
          </div>

          {/* Form container */}
          <Card>
            <div style={{ marginBottom: 10, fontWeight: 700 }}>Autentificare / Înregistrare</div>

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
                      Continuând, ești de acord cu Termenii și condițiile.
                    </div>
                  );
                },
              }}
              formFields={{
                signIn: {
                  username: {
                    label: "Email",
                    placeholder: "tu@exemplu.com",
                    isRequired: true,
                  },
                },
                signUp: {
                  email: {
                    label: "Email",
                    placeholder: "Introdu adresa de email",
                    isRequired: true,
                  },
                  password: {
                    label: "Parolă",
                    placeholder: "Creează o parolă",
                    isRequired: true,
                  },
                  confirm_password: {
                    label: "Confirmă parola",
                    placeholder: "Reintrodu parola",
                    isRequired: true,
                  },
                },
              }}
            >
              {({ user }) => <AuthRedirect user={user} />}
            </Authenticator>
          </Card>
        </div>
      </div>

      {/* RIGHT: illustration side */}
      <div className="loginRight"
        style={{
          borderLeft: "1px solid var(--border)",
          background: "#fff",
          padding: 22,

          // key lines:
          position: "sticky",
          top: 0,
          alignSelf: "start",
          // height: "100vh",

          display: "grid",
          placeItems: "center",
        }}
      >
        <div style={{ width: "min(560px, 100%)" }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3" }}>
            <Image
              src="/illustrations/study.png"
              alt="Ilustrație studiu"
              fill
              style={{ objectFit: "contain" }}
              priority
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 760, letterSpacing: -0.3 }}>
              Exersează. Măsoară. Progresează.
            </div>
            <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Susține simulări adaptate profilului tău de admitere și urmărește-ți progresul în timp.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

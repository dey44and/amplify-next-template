"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace("/dashboard");
        return;
      } catch {
        // not signed in => show auth pages
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  // ✅ prevents the login page from flashing
  if (checking) return null;

  return <>{children}</>;
}

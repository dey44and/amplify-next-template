"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

async function checkIsAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      // 1) must be signed in
      try {
        await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }

      // 2) must be admin
      const admin = await checkIsAdmin();
      if (!admin) {
        router.replace("/dashboard");
        return;
      }

      setChecking(false);
    })();
  }, [router]);

  // ✅ prevents admin UI flash for regular users
  if (checking) return null;

  return <>{children}</>;
}

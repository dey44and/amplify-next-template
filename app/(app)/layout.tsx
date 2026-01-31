"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setChecking(false);
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  // ✅ prevents protected pages from flashing when not logged in
  if (checking) return null;

  return <>{children}</>;
}

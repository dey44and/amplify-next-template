"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAdmin } from "@/lib/isAdmin";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const admin = await isAdmin();
      if (!admin) {
        router.replace("/dashboard");
        return;
      }
      setOk(true);
    })().catch(() => {
      router.replace("/dashboard");
    });
  }, [router]);

  if (ok === null) return <p style={{ padding: 24 }}>Se verifică accesul de administrator…</p>;
  return <>{children}</>;
}

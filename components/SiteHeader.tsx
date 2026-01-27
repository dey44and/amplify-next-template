"use client";

import { useRouter } from "next/navigation";

export function SiteHeader({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const router = useRouter();

  return (
    <header
      style={{
        width: "100%",
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "18px 18px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          onClick={() => router.push("/dashboard")}
          style={{ fontWeight: 900, cursor: "pointer", letterSpacing: -0.5, fontSize: 32 }}
        >
          Mock Exams
        </div>

        <nav style={{ display: "flex", gap: 18, fontSize: 14 }}>
          <a style={{ cursor: "pointer" }} onClick={() => router.push("/dashboard")}>
            Dashboard
          </a>
          <a style={{ cursor: "pointer" }} onClick={() => router.push("/profile")}>
            Profile
          </a>
          <a style={{ cursor: "pointer" }} onClick={() => router.push("/stats")}>
            Stats
          </a>
        </nav>

        <div style={{ justifySelf: "end" }}>{rightSlot}</div>
      </div>
    </header>
  );
}

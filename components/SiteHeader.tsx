"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function SiteHeader({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = useMemo(
    () => [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Profile", href: "/profile" },
      { label: "Stats", href: "/stats" },
    ],
    []
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

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
        className="hdrBar"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "14px 16px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Left */}
        <div
          className="hdrBrand"
          onClick={() => go("/dashboard")}
          style={{
            justifySelf: "start",
            fontWeight: 900,
            cursor: "pointer",
            letterSpacing: -0.5,
            fontSize: 28,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          Mock Exams
        </div>

        {/* Center (desktop only) */}
        <nav
          className="hdrNavDesktop"
          style={{
            justifySelf: "center",
            display: "flex",
            gap: 22,
            fontSize: 14,
            alignItems: "center",
          }}
        >
          {links.map((l) => {
            const active = pathname?.startsWith(l.href);
            return (
              <a
                key={l.href}
                onClick={() => go(l.href)}
                style={{
                  cursor: "pointer",
                  fontWeight: active ? 900 : 700,
                  opacity: active ? 1 : 0.75,
                  textDecoration: active ? "underline" : "none",
                  textUnderlineOffset: 6,
                }}
              >
                {l.label}
              </a>
            );
          })}
        </nav>

        {/* Right column container */}
        <div
          className="hdrRight"
          style={{
            justifySelf: "end",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div className="hdrRightDesktop">{rightSlot}</div>

          <button
            className="hdrMenuBtn"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            style={{
              display: "none",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "8px 10px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <div
        className="hdrMobile"
        style={{
          display: open ? "block" : "none",
          borderTop: "1px solid var(--border)",
          padding: "12px 16px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <nav style={{ display: "grid", gap: 10, fontSize: 14 }}>
            {links.map((l) => {
              const active = pathname?.startsWith(l.href);
              return (
                <a
                  key={l.href}
                  onClick={() => go(l.href)}
                  style={{
                    cursor: "pointer",
                    fontWeight: active ? 900 : 700,
                    opacity: active ? 1 : 0.75,
                    textDecoration: active ? "underline" : "none",
                    textUnderlineOffset: 6,
                  }}
                >
                  {l.label}
                </a>
              );
            })}
          </nav>

          {rightSlot ? (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              {rightSlot}
            </div>
          ) : null}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 820px) {
          /* KEY FIX: turn the bar into TWO columns on mobile */
          .hdrBar {
            grid-template-columns: 1fr auto !important;
          }

          /* hide center nav entirely */
          .hdrNavDesktop {
            display: none !important;
          }

          /* hide rightSlot on mobile, show burger */
          .hdrRightDesktop {
            display: none !important;
          }
          .hdrMenuBtn {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
          }
        }
      `}</style>
    </header>
  );
}

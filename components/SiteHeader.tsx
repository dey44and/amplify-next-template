"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function SiteHeader({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = useMemo(
    () => [
      { label: "Panou", href: "/dashboard" },
      { label: "Profil", href: "/profile" },
      { label: "Statistici", href: "/stats" },
    ],
    []
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <header className="siteHeader">
      <div className="hdrBar">
        {/* Left */}
        <button
          type="button"
          className="hdrBrand"
          onClick={() => go("/dashboard")}
        >
          Mock Exams
        </button>

        {/* Center (desktop only) */}
        <nav className="hdrNavDesktop">
          {links.map((l) => {
            const active = pathname?.startsWith(l.href);
            return (
              <button
                type="button"
                key={l.href}
                onClick={() => go(l.href)}
                className={`hdrNavLink${active ? " active" : ""}`}
              >
                {l.label}
              </button>
            );
          })}
        </nav>

        {/* Right column container */}
        <div className="hdrRight">
          <div className="hdrRightDesktop">{rightSlot}</div>

          <button
            type="button"
            className="hdrMenuBtn"
            onClick={() => setOpen((v) => !v)}
            aria-label="Comută meniul"
            aria-expanded={open}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <div
        className="hdrMobile"
        data-open={open ? "true" : "false"}
      >
        <div className="hdrMobileInner">
          <nav className="hdrMobileNav">
            {links.map((l) => {
              const active = pathname?.startsWith(l.href);
              return (
                <button
                  type="button"
                  key={l.href}
                  onClick={() => go(l.href)}
                  className={`hdrNavLink${active ? " active" : ""}`}
                >
                  {l.label}
                </button>
              );
            })}
          </nav>

          {rightSlot ? (
            <div className="hdrMobileRight">
              {rightSlot}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

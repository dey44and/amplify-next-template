"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PageShell({
  titleTop,
  titleBottom,
  children,
}: {
  titleTop?: string;
  titleBottom?: string;
  children: React.ReactNode;
}) {
  const hasTitle = Boolean((titleTop && titleTop.trim()) || (titleBottom && titleBottom.trim()));
  const pathname = usePathname();
  const isAdminArea = pathname?.startsWith("/admin");

  const railLinks = isAdminArea
    ? [
        { href: "/dashboard", icon: "D", label: "Dashboard" },
        { href: "/admin/exams", icon: "E", label: "Admin exams" },
        { href: "/admin/requests", icon: "R", label: "Requests" },
      ]
    : [
        { href: "/dashboard", icon: "D", label: "Dashboard" },
        { href: "/profile", icon: "P", label: "Profile" },
        { href: "/stats", icon: "S", label: "Stats" },
      ];

  return (
    <div className="app-shell-layout">
      <aside className="app-rail" aria-label="Section navigation">
        {railLinks.map((link) => {
          const isActive = pathname?.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`app-rail-link${isActive ? " active" : ""}`}
              aria-label={link.label}
              title={link.label}
            >
              <span>{link.icon}</span>
            </Link>
          );
        })}
      </aside>

      <main className="page-shell">
        {hasTitle && (
          <div className="page-shell-title-wrap">
            {titleTop ? <div className="display page-shell-display">{titleTop}</div> : null}
            {titleBottom ? <div className="display page-shell-display">{titleBottom}</div> : null}
          </div>
        )}

        {children}
      </main>
    </div>
  );
}

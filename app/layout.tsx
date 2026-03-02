import type { Metadata } from "next";
import "./app.css";
import AmplifyClientProvider from "./amplify-client";

import { Bebas_Neue, Inter } from "next/font/google";

const display = Bebas_Neue({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-display",
});

const body = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Mock Exams",
  description: "Platformă de simulări pentru examene",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className={`${display.variable} ${body.variable}`}>
      <body>
        <AmplifyClientProvider>
          <div className="site-root">
            <div className="site-content">{children}</div>
            <footer className="site-footer">© 2026 Mock Exams</footer>
          </div>
        </AmplifyClientProvider>
      </body>
    </html>
  );
}

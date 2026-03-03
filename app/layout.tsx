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
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
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

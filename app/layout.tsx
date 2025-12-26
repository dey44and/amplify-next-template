import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./app.css";
import AmplifyClientProvider from "./amplify-client";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mock Exams",
  description: "Mock exams app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AmplifyClientProvider>{children}</AmplifyClientProvider>
      </body>
    </html>
  );
}

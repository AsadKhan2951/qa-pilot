import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Pilot",
  description: "AI-powered QA automation — UI, Figma reference, API and AI-feature testing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-[14px]">{children}</body>
    </html>
  );
}

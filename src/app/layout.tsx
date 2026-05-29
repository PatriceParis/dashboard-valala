import type { Metadata } from "next";
import "./globals.css";
import { CLIENT_TITLE, CLIENT_SUBTITLE } from "@/lib/constants";

export const metadata: Metadata = {
  title: CLIENT_TITLE,
  description: CLIENT_SUBTITLE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { getSession } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floe — Loan Dashboard",
  description: "Real-time view of every active loan on Floe's onchain credit protocol.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SiteHeader address={session.address ?? undefined} />
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}

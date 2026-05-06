import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floe — Loan Dashboard",
  description: "Real-time view of every active loan on Floe's onchain credit protocol.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}

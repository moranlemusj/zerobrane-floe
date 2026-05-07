"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to wherever in prod (Vercel logs catch this in dev console).
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-4 py-4 text-sm text-rose-200">
        <p className="font-medium">{error.message || "Unknown error"}</p>
        {error.digest && (
          <p className="mt-1 text-xs text-rose-200/60 font-mono">digest: {error.digest}</p>
        )}
      </div>
      <p className="text-sm text-[color:var(--muted)]">
        Most likely causes: indexer offline, Neon connection dropped, or a query referenced a
        column added after the last schema push. Try reloading; if it persists check the
        Vercel function logs and confirm <code>NEON_DATABASE_URL</code> is set.
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-3 py-1.5 rounded text-sm border border-white/10 hover:bg-white/[0.05]"
      >
        Try again
      </button>
    </main>
  );
}

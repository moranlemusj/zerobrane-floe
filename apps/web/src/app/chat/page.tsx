import { ChatClient } from "./ChatClient";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  const apiKeyConfigured =
    !!process.env.GOOGLE_GENERATIVE_AI_API_KEY || !!process.env.GOOGLE_API_KEY;
  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask the dashboard</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1">
          Natural-language Q&amp;A grounded in the indexer. Answers cite real loan IDs, link
          to detail pages, and never invent numbers.
        </p>
      </div>
      {apiKeyConfigured ? (
        <ChatClient />
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-6 py-8 text-sm text-amber-200">
          <p className="font-medium">Chatbot disabled — GOOGLE_API_KEY missing.</p>
          <p className="mt-2 text-xs text-amber-200/80">
            Add it to <code>.env</code> at the repo root (and to your Vercel project's environment
            variables for production), then restart the dev server.
          </p>
        </div>
      )}
    </main>
  );
}

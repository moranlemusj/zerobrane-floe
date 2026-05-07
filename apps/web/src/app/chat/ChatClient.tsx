"use client";

import { useChat } from "@ai-sdk/react";
import { useRef, useState } from "react";

const SUGGESTED = [
  "How many loans are currently active?",
  "Show me loans collateralized by cbBTC",
  "Tell me about loan #34",
  "What was the largest interest payment ever made?",
  "How would I borrow 50 USDC against 0.02 WETH?",
];

export function ChatClient() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, sendMessage, status, error } = useChat();
  const isStreaming = status === "submitted" || status === "streaming";

  function send(text: string) {
    if (!text.trim()) return;
    sendMessage({ text });
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {messages.length === 0 && <Welcome onPick={(q) => send(q)} />}
        {messages.map((m) => (
          <li
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                m.role === "user"
                  ? "bg-blue-500/15 text-blue-100 ring-1 ring-blue-500/30"
                  : "bg-white/[0.03] text-white ring-1 ring-white/10"
              }`}
            >
              {renderMessage(m)}
            </div>
          </li>
        ))}
        {isStreaming && messages[messages.length - 1]?.role === "user" && (
          <li className="flex justify-start">
            <div className="bg-white/[0.03] text-[color:var(--muted)] ring-1 ring-white/10 rounded-lg px-4 py-3 text-sm italic">
              thinking…
            </div>
          </li>
        )}
        {error && (
          <li className="flex justify-start">
            <div className="bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30 rounded-lg px-4 py-3 text-sm">
              <strong>Error:</strong> {error.message}
            </div>
          </li>
        )}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/95 backdrop-blur px-3 py-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about Floe loans, markets, or how to borrow…"
          disabled={isStreaming}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-[color:var(--muted)]"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="px-3 py-1 rounded text-xs border border-white/10 hover:bg-white/[0.05] disabled:opacity-40"
        >
          {isStreaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-6 py-8 text-sm space-y-4">
      <p>
        Ask anything about Floe's onchain credit protocol on Base. The bot reads from our
        indexer DB and Floe's public REST. It can also <strong>preview a borrow</strong> —
        construct the exact curl you'd run, without actually executing it.
      </p>
      <div>
        <p className="text-xs uppercase tracking-wide text-[color:var(--muted)] mb-2">
          Try one
        </p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="px-3 py-1.5 rounded text-xs border border-white/10 hover:bg-white/[0.05] text-left"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ChatPart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts?: ChatPart[];
}

function renderMessage(m: ChatMessage) {
  const parts = m.parts ?? [];
  // Tool-call parts (the wire-level "tool-foo" entries with their inputs and
  // raw outputs) are intentionally not rendered. Showing them leaked tool
  // names + input/output JSON to the end user, which (a) looked debug-y and
  // (b) revealed implementation detail. The pending-tool-call state is shown
  // by the typing indicator at the assistant level, not per part.
  const textParts = parts.filter((p) => p.type === "text");
  const isToolPending =
    m.role === "assistant" &&
    textParts.length === 0 &&
    parts.some((p) => p.type?.startsWith("tool-"));
  if (isToolPending) {
    return (
      <span className="italic text-[color:var(--muted)] text-xs">checking the data…</span>
    );
  }
  return (
    <div className="space-y-2">
      {textParts.map((p, i) => (
        <div key={i} className="whitespace-pre-wrap break-words text-sm">
          {linkifyLoanIds(p.text ?? "")}
        </div>
      ))}
    </div>
  );
}

function linkifyLoanIds(text: string): React.ReactNode {
  // Match #N or [#N](/loan/N) — render as a clickable link to /loan/N.
  const out: React.ReactNode[] = [];
  const regex = /\[#(\d+)\]\(\/loan\/\1\)|#(\d+)/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastEnd) out.push(text.slice(lastEnd, m.index));
    const id = m[1] ?? m[2];
    out.push(
      <a
        key={`${m.index}-${id}`}
        href={`/loan/${id}`}
        className="text-blue-300 underline decoration-blue-300/40 hover:decoration-blue-300"
      >
        #{id}
      </a>,
    );
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) out.push(text.slice(lastEnd));
  return out;
}

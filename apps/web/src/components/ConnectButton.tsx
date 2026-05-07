"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function ConnectButton({ initialAddress }: { initialAddress?: string }) {
  const router = useRouter();
  const [address, setAddress] = useState<string | undefined>(initialAddress);
  const [pending, setPending] = useState<"idle" | "signing" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);

  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && !!window.ethereum);
  }, []);

  async function connect() {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet detected — install MetaMask, Rabby, or another EIP-1193 wallet.");
      return;
    }
    try {
      setPending("signing");
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const addr = accounts[0];
      if (!addr) throw new Error("No account returned by wallet");

      const nonceRes = await fetch("/api/auth/nonce", { method: "POST" });
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = [
        "Sign in to Floe Dashboard.",
        "",
        `Address: ${addr.toLowerCase()}`,
        `Nonce: ${nonce}`,
        "",
        "Signing this message proves wallet ownership. No transaction is sent.",
      ].join("\n");

      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, addr],
      })) as string;

      setPending("verifying");
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr, signature }),
      });
      if (!verifyRes.ok) {
        const data = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "verify failed");
      }
      setAddress(addr.toLowerCase());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending("idle");
    }
  }

  async function disconnect() {
    setError(null);
    await fetch("/api/auth/logout", { method: "POST" });
    setAddress(undefined);
    router.refresh();
  }

  if (address) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-[color:var(--muted)]">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          className="px-2 py-1 rounded border border-white/10 hover:bg-white/[0.05]"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={connect}
        disabled={pending !== "idle" || hasWallet === false}
        className="px-3 py-1 rounded text-xs border border-white/10 hover:bg-white/[0.05] disabled:opacity-50 disabled:cursor-not-allowed"
        title={hasWallet === false ? "No EIP-1193 wallet detected" : undefined}
      >
        {pending === "signing"
          ? "Sign in wallet…"
          : pending === "verifying"
            ? "Verifying…"
            : "Connect wallet"}
      </button>
      {error && <span className="text-[11px] text-rose-300">{error}</span>}
    </div>
  );
}

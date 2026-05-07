import Link from "next/link";
import { ConnectButton } from "./ConnectButton";

export function SiteHeader({ address }: { address?: string }) {
  return (
    <header className="border-b border-white/10 bg-zinc-950/60 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-7xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <Link href="/" className="font-semibold tracking-tight hover:opacity-80">
          Floe Dashboard
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3 text-sm overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
          <NavLink href="/">Loans</NavLink>
          <NavLink href="/markets">Markets</NavLink>
          <NavLink href="/activity">Activity</NavLink>
          <NavLink href="/stress">Stress</NavLink>
          <NavLink href="/me">My loans</NavLink>
          <NavLink href="/chat">Chat</NavLink>
        </nav>
        <div className="sm:ml-auto">
          <ConnectButton initialAddress={address} />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-2 py-1 rounded text-[color:var(--muted)] hover:text-white hover:bg-white/[0.04] whitespace-nowrap"
    >
      {children}
    </Link>
  );
}

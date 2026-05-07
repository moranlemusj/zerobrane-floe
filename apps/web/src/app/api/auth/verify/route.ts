import { NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage } from "viem";
import { buildAuthMessage, getSession } from "@/lib/session";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { address?: string; signature?: string }
    | null;
  if (!body?.address || !body?.signature) {
    return NextResponse.json({ ok: false, error: "address and signature required" }, { status: 400 });
  }
  if (!isAddress(body.address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }
  const session = await getSession();
  if (!session.nonce || !session.nonceCreatedAt) {
    return NextResponse.json({ ok: false, error: "no nonce — POST /api/auth/nonce first" }, { status: 400 });
  }
  if (Date.now() - session.nonceCreatedAt > NONCE_TTL_MS) {
    session.destroy();
    return NextResponse.json({ ok: false, error: "nonce expired, try again" }, { status: 400 });
  }

  const checksumAddr = getAddress(body.address);
  const message = buildAuthMessage(checksumAddr, session.nonce);
  // viem throws on malformed signatures rather than returning false; collapse
  // both into a single 401 so callers can't distinguish bad-sig from
  // bad-input enumeration probes.
  const valid = await verifyMessage({
    address: checksumAddr,
    message,
    signature: body.signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "signature did not verify" }, { status: 401 });
  }

  // Authenticated — pin the address, drop the nonce.
  session.address = checksumAddr.toLowerCase() as `0x${string}`;
  session.nonce = undefined;
  session.nonceCreatedAt = undefined;
  await session.save();

  return NextResponse.json({ ok: true, address: session.address });
}

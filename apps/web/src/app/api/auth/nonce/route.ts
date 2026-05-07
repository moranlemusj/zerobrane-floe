import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  // 16 random bytes hex-encoded — enough to defeat replay.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  session.nonce = nonce;
  session.nonceCreatedAt = Date.now();
  await session.save();
  return NextResponse.json({ nonce });
}

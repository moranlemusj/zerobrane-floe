import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { CHAT_SYSTEM_PROMPT } from "@/lib/chat-system-prompt";
import { chatTools } from "@/lib/chat-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

// The AI SDK's default lookup is GOOGLE_GENERATIVE_AI_API_KEY; we
// accept the shorter GOOGLE_API_KEY too since that's what the user's
// existing key is named.
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;

export async function POST(req: Request) {
  if (!apiKey) {
    return Response.json(
      {
        error:
          "GOOGLE_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) not set on server. Add it to .env and restart.",
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { messages?: UIMessage[] } | null;
  if (!body?.messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const messages = await convertToModelMessages(body.messages);
  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: CHAT_SYSTEM_PROMPT,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}

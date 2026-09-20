import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../lib/auth";
import { speech, elevenConfigured } from "../../../lib/tts";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The cache key is derived from the text, so a given URL always returns the
// same audio — the browser may keep it forever.
const AUDIO_HEADERS = {
  "content-type": "audio/mpeg",
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff"
};

export async function GET(request) {
  if (!verifyToken(request.cookies.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!elevenConfigured()) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY puuttuu Vercelin ympäristömuuttujista." },
      { status: 503 }
    );
  }
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text") || "";
  const lang = searchParams.get("lang") === "fi" ? "fi" : "sv";
  if (!text.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });

  try {
    const out = await speech(text, lang);
    return new NextResponse(out.stream || out.buffer, { headers: AUDIO_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}

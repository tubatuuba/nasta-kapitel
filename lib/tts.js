import crypto from "crypto";
import { put, get } from "@vercel/blob";

const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

let voiceCache = null;

function apiKey() {
  return (
    process.env.ELEVENLABS_API_KEY ||
    process.env.ELEVEN_LABS_API_KEY ||
    process.env.ELEVEN_LABS ||
    process.env.ELEVENLABS ||
    ""
  );
}

export function elevenConfigured() {
  return !!apiKey();
}

async function firstAccountVoice() {
  if (voiceCache) return voiceCache;
  const res = await fetch(API + "/voices", { headers: { "xi-api-key": apiKey() } });
  if (!res.ok) throw new Error("ElevenLabs /voices " + res.status);
  const json = await res.json();
  const v = (json.voices || [])[0];
  if (!v) throw new Error("Tilillä ei ole yhtään ääntä");
  voiceCache = v.voice_id;
  return voiceCache;
}

export async function resolveVoice(lang) {
  const perLang =
    lang === "fi" ? process.env.ELEVENLABS_VOICE_ID_FI : process.env.ELEVENLABS_VOICE_ID_SV;
  if (perLang) return perLang;
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  return firstAccountVoice();
}

function cacheKey(voice, lang, text) {
  return crypto
    .createHash("sha256")
    .update([MODEL, voice, lang, text].join("|"))
    .digest("hex")
    .slice(0, 40);
}

// Each phrase is generated once and then kept as a PRIVATE blob, served only
// through the authenticated /api/tts route. The cache key is derived from the
// text, so the same word never costs a second ElevenLabs call.
export async function speech(text, lang) {
  const clean = String(text || "").trim().slice(0, 600);
  if (!clean) throw new Error("Tyhjä teksti");
  const voice = await resolveVoice(lang);
  const path = "tts/" + cacheKey(voice, lang, clean) + ".mp3";
  const canCache = !!process.env.BLOB_READ_WRITE_TOKEN;

  if (canCache) {
    // One round-trip, not two: get() already tells us whether it exists.
    try {
      const hit = await get(path, { access: "private" });
      if (hit && hit.statusCode === 200) return { stream: hit.stream, cached: true };
    } catch {
      /* not generated yet */
    }
  }

  const res = await fetch(API + "/text-to-speech/" + voice, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "content-type": "application/json",
      accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: clean,
      model_id: MODEL,
      language_code: lang === "fi" ? "fi" : "sv",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: lang === "fi" ? 1.0 : 0.9 }
    })
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error("ElevenLabs " + res.status + ": " + body.slice(0, 300));
    err.status = res.status;
    throw err;
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  if (canCache) {
    try {
      await put(path, buffer, {
        access: "private",
        contentType: "audio/mpeg",
        addRandomSuffix: false,
        allowOverwrite: true
      });
    } catch {
      /* serving it is more important than caching it */
    }
  }
  return { buffer, cached: false };
}

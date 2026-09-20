import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../../../lib/auth";
import { getChapter, saveChapter, getProgress } from "../../../../../lib/store";
import { ask, parseJson, anthropicConfigured } from "../../../../../lib/anthropic";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Adds the Swedish version of the Finnish summary to a chapter that was
// created before summaries were bilingual.
export async function POST(request, { params }) {
  if (!verifyToken(request.cookies.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY puuttuu." }, { status: 503 });
  }
  const { id } = await params;
  const chapter = await getChapter(id);
  if (!chapter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const fi = (chapter.summaryFi || []).map(String);
  if (!fi.length) return NextResponse.json({ error: "Kappaleessa ei ole tiivistelmää." }, { status: 400 });

  const prompt = [
    "Käännä nämä tiivistelmävirkkeet ruotsiksi 5.-luokkalaiselle, joka opiskelee ruotsinkielisessä kielikylvyssä.",
    "Kappale: " + String(chapter.titleSv || ""),
    "",
    "Virkkeet suomeksi:",
    ...fi.map((t, i) => i + 1 + ". " + t),
    "",
    "Säännöt:",
    "- Käännä virke virkkeeltä: tulokseen tulee TÄSMÄLLEEN " + fi.length + " virkettä samassa järjestyksessä.",
    "- Käytä yksinkertaista, selkeää ruotsia, jota 11-vuotias ymmärtää. Lyhyitä päälauseita.",
    "- Käytä kappaleen omia ruotsinkielisiä termejä.",
    '- Vastaa VAIN JSON-oliolla: {"summarySv":["",""]}',
    "- Älä kirjoita mitään muuta kuin JSON."
  ].join("\n");

  try {
    const out = await ask({ blocks: [{ type: "text", text: prompt }], maxTokens: 4000 });
    const data = parseJson(out.text) || {};
    const sv = Array.isArray(data.summarySv) ? data.summarySv.map(String).filter(Boolean) : [];
    if (!sv.length) return NextResponse.json({ error: "Käännöstä ei saatu." }, { status: 502 });

    const saved = await saveChapter(id, { ...chapter, summarySv: sv });
    const progress = await getProgress(id);
    return NextResponse.json({ chapter: { ...saved, known: progress.known, answers: progress.answers } });
  } catch (e) {
    return NextResponse.json(
      { error: "Käännös epäonnistui. " + String(e.message || e).slice(0, 200) },
      { status: 502 }
    );
  }
}

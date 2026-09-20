import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../lib/auth";
import { ask, parseJson, anthropicConfigured } from "../../../lib/anthropic";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  if (!verifyToken(request.cookies.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY puuttuu." }, { status: 503 });
  }
  const b = (await request.json()) || {};
  const answer = String(b.answer || "").slice(0, 2000).trim();
  if (!answer) return NextResponse.json({ error: "Kirjoita ensin vastaus." }, { status: 400 });

  const fi = b.lang === "fi";

  // Äidinkieli answers are in Finnish and judged on content and expression;
  // the Swedish-immersion version also translates the words the student
  // reached for in Finnish.
  const prompt = (fi
    ? [
        "Olet yst\u00e4v\u00e4llinen \u00e4idinkielen opettaja. Oppilas on suomalainen 5.-luokkalainen.",
        "Kappale: " + String(b.chapterTitle || "") + ".",
        "Teht\u00e4v\u00e4: " + String(b.questionSv || ""),
        "Oppilaan vastaus: " + answer,
        "",
        "Arvioi ensisijaisesti asiasis\u00e4lt\u00f6: ymm\u00e4rt\u00e4\u00e4k\u00f6 oppilas kappaleen s\u00e4\u00e4nn\u00f6n tai k\u00e4sitteen. Oppilas saa vastata omin sanoin.",
        "Jos teht\u00e4v\u00e4 vaatisi piirt\u00e4mist\u00e4, v\u00e4ritt\u00e4mist\u00e4 tai muuta tekemist\u00e4 paperilla, arvioi vain sit\u00e4, kuvaileeko oppilas asian oikein sanoin. \u00c4L\u00c4 KOSKAAN merkitse vastausta v\u00e4\u00e4r\u00e4ksi sen takia, ettei oppilas voinut piirt\u00e4\u00e4 t\u00e4h\u00e4n kentt\u00e4\u00e4n.",
        "",
        "Vastaa VAIN JSON-oliolla t\u00e4ss\u00e4 muodossa:",
        '{"verdict":"oikein","feedbackFi":"","swedishHelp":[],"modelAnswerSv":"","modelAnswerFi":""}',
        "",
        "S\u00e4\u00e4nn\u00f6t:",
        '- verdict: "oikein", "osittain" tai "vaarin" sen mukaan, onko asiasis\u00e4lt\u00f6 oikein.',
        "- feedbackFi: 1\u20133 lyhytt\u00e4, kannustavaa virkett\u00e4. Kerro mik\u00e4 meni oikein ja mit\u00e4 j\u00e4i puuttumaan. Mainitse enint\u00e4\u00e4n kaksi t\u00e4rkeint\u00e4 oikeinkirjoitus- tai lauserakennevirhett\u00e4 yst\u00e4v\u00e4llisesti.",
        "- swedishHelp: aina tyhj\u00e4 lista.",
        "- modelAnswerSv: hyv\u00e4 mallivastaus SUOMEKSI, 1\u20132 lyhytt\u00e4 virkett\u00e4 5.-luokkalaisen kielell\u00e4.",
        "- modelAnswerFi: aina tyhj\u00e4 merkkijono.",
        "- \u00c4l\u00e4 kirjoita mit\u00e4\u00e4n muuta kuin JSON."
      ]
    : [
        "Olet yst\u00e4v\u00e4llinen ruotsin opettaja. Oppilas on suomalainen 5.-luokkalainen ruotsinkielisess\u00e4 kielikylvyss\u00e4.",
        "Kappale: " + String(b.chapterTitle || "") + ".",
        "Kysymys ruotsiksi: " + String(b.questionSv || ""),
        "Kysymyksen merkitys suomeksi: " + String(b.questionFi || ""),
        "Oppilaan vastaus: " + answer,
        "",
        "Oppilas vastaa p\u00e4\u00e4osin ruotsiksi, mutta mukana voi olla suomenkielisi\u00e4 sanoja. Se on t\u00e4ysin sallittua \u2014 arvioi ensisijaisesti, onko asiasis\u00e4lt\u00f6 oikein, ei kielioppia.",
        "Jos teht\u00e4v\u00e4 vaatisi piirt\u00e4mist\u00e4, v\u00e4ritt\u00e4mist\u00e4 tai muuta tekemist\u00e4 paperilla, arvioi vain sit\u00e4, kuvaileeko oppilas asian oikein sanoin. \u00c4L\u00c4 KOSKAAN merkitse vastausta v\u00e4\u00e4r\u00e4ksi sen takia, ettei oppilas voinut piirt\u00e4\u00e4 t\u00e4h\u00e4n kentt\u00e4\u00e4n.",
        "",
        "Vastaa VAIN JSON-oliolla t\u00e4ss\u00e4 muodossa:",
        '{"verdict":"oikein","feedbackFi":"","swedishHelp":[{"fi":"","sv":""}],"modelAnswerSv":"","modelAnswerFi":""}',
        "",
        "S\u00e4\u00e4nn\u00f6t:",
        '- verdict: "oikein", "osittain" tai "vaarin" sen mukaan, onko asiasis\u00e4lt\u00f6 oikein.',
        "- feedbackFi: 1\u20133 lyhytt\u00e4, kannustavaa virkett\u00e4 SUOMEKSI. Kerro mik\u00e4 meni oikein ja mit\u00e4 j\u00e4i puuttumaan. Mainitse enint\u00e4\u00e4n kaksi t\u00e4rkeint\u00e4 ruotsin kieli- tai kirjoitusvirhett\u00e4 yst\u00e4v\u00e4llisesti.",
        "- swedishHelp: ne suomenkieliset sanat tai ilmaukset, joita oppilas k\u00e4ytti vastauksessaan, ja miten ne sanotaan ruotsiksi (fi = oppilaan sana, sv = ruotsiksi). Enint\u00e4\u00e4n 5. Jos oppilas vastasi kokonaan ruotsiksi, k\u00e4yt\u00e4 tyhj\u00e4\u00e4 listaa.",
        "- modelAnswerSv: hyv\u00e4 mallivastaus ruotsiksi, 1\u20132 lyhytt\u00e4 virkett\u00e4 5.-luokkalaisen kielell\u00e4.",
        "- modelAnswerFi: sama suomeksi.",
        "- \u00c4l\u00e4 kirjoita mit\u00e4\u00e4n muuta kuin JSON."
      ]
  ).join("\n");

  try {
    const out = await ask({ blocks: [{ type: "text", text: prompt }], maxTokens: 2000 });
    const d = parseJson(out.text) || {};
    return NextResponse.json({
      feedback: {
        verdict: ["oikein", "osittain", "vaarin"].includes(d.verdict) ? d.verdict : "osittain",
        feedbackFi: String(d.feedbackFi || ""),
        swedishHelp: Array.isArray(d.swedishHelp)
          ? d.swedishHelp.filter((h) => h && h.fi && h.sv).slice(0, 5)
          : [],
        modelAnswerSv: String(d.modelAnswerSv || ""),
        modelAnswerFi: String(d.modelAnswerFi || "")
      }
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Tarkistus epäonnistui. " + String(e.message || e).slice(0, 200) },
      { status: 502 }
    );
  }
}

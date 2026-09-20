import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../lib/auth";
import { listChapters, saveChapter, newId, blobConfigured } from "../../../lib/store";
import { validateModels } from "../../../lib/mathgen";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";

function guard(request) {
  return verifyToken(request.cookies.get(COOKIE)?.value);
}

const SUBJECTS = ["omg", "hist", "matte", "aidinkieli", "uskonto", "annat"];

// Muuttujat ovat joko lukuväli [min, max] tai lista sanoja. Mitään muuta ei
// päästetä läpi, jottei malliin voi ujuttaa outoa dataa.
function cleanVars(vars) {
  const out = {};
  if (!vars || typeof vars !== "object") return out;
  for (const key of Object.keys(vars).slice(0, 8)) {
    if (!/^[A-Za-zÅÄÖåäö_][A-Za-z0-9ÅÄÖåäö_]*$/.test(key) || key === "vastaus") continue;
    const v = vars[key];
    if (!Array.isArray(v) || !v.length) continue;
    if (v.every((x) => typeof x === "number" && Number.isFinite(x))) {
      // Kaksi lukua = väli, useampi = valmis lista vaihtoehtoja.
      out[key] = v.slice(0, 8).map((x) => Math.round(x));
      if (out[key].length === 2 && out[key][0] > out[key][1]) out[key].reverse();
    } else {
      out[key] = v.slice(0, 8).map((x) => String(x).slice(0, 40));
    }
  }
  return out;
}

export async function GET(request) {
  if (!guard(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobConfigured()) {
    return NextResponse.json({
      chapters: [],
      warning: "Tallennustila ei ole käytössä. Liitä Blob-store projektiin Vercelin Storage-välilehdeltä."
    });
  }
  try {
    return NextResponse.json({ chapters: await listChapters() });
  } catch (e) {
    return NextResponse.json({ chapters: [], warning: String(e.message || e) });
  }
}

export async function POST(request) {
  if (!guard(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobConfigured()) {
    return NextResponse.json({ error: "Tallennustila ei ole käytössä." }, { status: 500 });
  }
  const body = await request.json();
  const d = body || {};
  const doc = {
    subject: SUBJECTS.includes(d.subject) ? d.subject : "annat",
    chapterNo: String(d.chapterNo || "").slice(0, 40),
    titleSv: String(d.titleSv || "Nimetön kappale").slice(0, 140),
    titleFi: String(d.titleFi || "").slice(0, 140),
    summaryFi: (d.summaryFi || []).slice(0, 10).map(String),
    summarySv: (d.summarySv || []).slice(0, 10).map(String),
    words: (d.words || [])
      .slice(0, 30)
      .map((w) => ({
        sv: String(w.sv || ""),
        fi: String(w.fi || ""),
        exampleSv: String(w.exampleSv || ""),
        exampleFi: String(w.exampleFi || "")
      }))
      .filter((w) => w.sv && w.fi),
    phrases: (d.phrases || [])
      .slice(0, 10)
      .map((p) => ({ sv: String(p.sv || ""), fi: String(p.fi || "") }))
      .filter((p) => p.sv),
    concepts: (d.concepts || [])
      .slice(0, 20)
      .map((c) => ({
        term: String(c.term || ""),
        definition: String(c.definition || ""),
        example: String(c.example || "")
      }))
      .filter((c) => c.term && c.definition),
    drills: (d.drills || [])
      .slice(0, 20)
      .map((x) => ({
        prompt: String(x.prompt || ""),
        task: String(x.task || ""),
        answer: String(x.answer || ""),
        why: String(x.why || ""),
        strictCase: !!x.strictCase
      }))
      .filter((x) => x.prompt && x.answer),
    // Matikan tehtävämallit. Ne testataan vielä tallennushetkellä, jotta
    // kappaleeseen ei päädy mallia joka laskee väärin.
    models: validateModels(
      (d.models || []).slice(0, 12).map((m) => ({
        id: String(m.id || "").slice(0, 60),
        nameSv: String(m.nameSv || "").slice(0, 60),
        nameFi: String(m.nameFi || "").slice(0, 60),
        vars: cleanVars(m.vars),
        conds: (m.conds || []).slice(0, 6).map(String),
        sv: String(m.sv || "").slice(0, 400),
        fi: String(m.fi || "").slice(0, 400),
        answer: String(m.answer || "").slice(0, 200),
        format: String(m.format || "auto").slice(0, 20),
        unit: String(m.unit || "").slice(0, 12),
        steps: (m.steps || []).slice(0, 5).map((s) => String(s).slice(0, 240)),
        traps: (m.traps || [])
          .slice(0, 4)
          .map((t) => ({ when: String(t.when || "").slice(0, 200), why: String(t.why || "").slice(0, 200) }))
          .filter((t) => t.when && t.why)
      }))
    ),
    questions: (d.questions || [])
      .slice(0, 8)
      .map((q) => ({ sv: String(q.sv || ""), fi: String(q.fi || ""), note: String(q.note || "") }))
      .filter((q) => q.sv),
    known: {},
    answers: {},
    createdAt: Date.now()
  };
  const id = newId(doc.titleSv);
  const saved = await saveChapter(id, doc);
  return NextResponse.json({ chapter: saved });
}

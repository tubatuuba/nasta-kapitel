import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../lib/auth";
import { ask, parseJson, anthropicConfigured } from "../../../lib/anthropic";
import { validateModels } from "../../../lib/mathgen";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUBJECTS = {
  omg: { sv: "Omgivningslära", fi: "Ympäristöoppi" },
  hist: { sv: "Historia", fi: "Historia" },
  matte: { sv: "Matematik", fi: "Matematiikka" },
  aidinkieli: { sv: "Modersm\u00e5l och litteratur", fi: "\u00c4idinkieli ja kirjallisuus", fiOnly: true },
  uskonto: { sv: "Religion", fi: "Uskonto", fiOnly: true },
  annat: { sv: "Annat ämne", fi: "Muu aine" }
};

// Two kinds of chapter, two prompts. A Swedish-immersion chapter needs Finnish
// comprehension plus Swedish vocabulary; an Äidinkieli chapter is entirely in
// Finnish, so instead of translation it gets the chapter's own concepts and
// concrete rule-application exercises.
function sourceBlock(text, hasImages) {
  return hasImages
    ? "Oheisissa kuvissa on oppikirjan sivut tulevan tunnin kappaleesta. Lue niist\u00e4 kaikki teksti: kappaleen numero, otsikko, leip\u00e4teksti, sinisell\u00e4 pohjalla olevat s\u00e4\u00e4nt\u00f6laatikot, esimerkit, kuvatekstit ja TEHT\u00c4V\u00c4T-laatikko."
    : "Kappaleen teksti:\n" + String(text || "").slice(0, 24000);
}

// The Finnish-taught subjects share a shape — summary, the chapter's own
// concepts, open questions — but only Äidinkieli has rules to drill. Uskonto
// is read and discussed, so it gets no drill tab at all.
const FI_SUBJECTS = {
  aidinkieli: {
    fi: "\u00c4idinkieli ja kirjallisuus",
    conceptHint:
      "esim. yleisnimi, erisnimi, yhdyssana, yhdysmerkki, p\u00e4\u00e4lause, sivulause, alistuskonjunktio, relatiivipronomini",
    drills: true,
    questions: "3\u20135"
  },
  uskonto: {
    fi: "Uskonto",
    conceptHint:
      "esim. vertaus, profeetta, seurakunta, ehtoollinen, kirkkovuosi, Toora, synagoga, moskeija \u2014 my\u00f6s kappaleen keskeiset henkil\u00f6t ja paikat",
    drills: false,
    questions: "4\u20136"
  }
};

function finnishPrompt(subjectKey, title, text, hasImages) {
  const s = FI_SUBJECTS[subjectKey] || FI_SUBJECTS.aidinkieli;
  const key = FI_SUBJECTS[subjectKey] ? subjectKey : "aidinkieli";

  const shape = s.drills
    ? '{"subject":"' + key + '","chapterNo":"","titleFi":"","summaryFi":["",""],"concepts":[{"term":"","definition":"","example":""}],"drills":[{"prompt":"","task":"","answer":"","why":"","strictCase":false}],"questions":[{"sv":"","fi":"","note":""}]}'
    : '{"subject":"' + key + '","chapterNo":"","titleFi":"","summaryFi":["",""],"concepts":[{"term":"","definition":"","example":""}],"questions":[{"sv":"","fi":"","note":""}]}';

  return [
    "Olet apuopettaja suomalaiselle 11-vuotiaalle oppilaalle, joka k\u00e4y 5. luokkaa.",
    "Oppiaine on " + s.fi + ", ja kaikki materiaali on suomeksi. \u00c4L\u00c4 k\u00e4yt\u00e4 ruotsia miss\u00e4\u00e4n kent\u00e4ss\u00e4.",
    "Oppilas haluaa tutustua tulevan tunnin kappaleeseen etuk\u00e4teen.",
    "",
    title ? "Oppilaan antama kappaleen nimi: " + title : "",
    sourceBlock(text, hasImages),
    "",
    "Tee kappaleesta ennakkomateriaali. Vastaa VAIN JSON-oliolla t\u00e4ss\u00e4 muodossa:",
    shape,
    "",
    "S\u00e4\u00e4nn\u00f6t:",
    '- chapterNo = kappaleen numero ja sivut kuten kirjassa, esim. "2. luku \u00b7 s. 12\u201313". Jos numeroa ei n\u00e4y, j\u00e4t\u00e4 tyhj\u00e4ksi.',
    "- titleFi = kappaleen otsikko T\u00c4SM\u00c4LLEEN kuten kirjassa.",
    "- summaryFi = 5\u20137 lyhytt\u00e4 virkett\u00e4 selke\u00e4ll\u00e4 suomella. Kerro mit\u00e4 kappaleessa opetetaan ja mitk\u00e4 ovat sen t\u00e4rkeimm\u00e4t asiat.",
    "- concepts = 5\u201310 kappaleen omaa k\u00e4sitett\u00e4 tai termi\u00e4 (" + s.conceptHint + "). term = k\u00e4sitteen nimi yhten\u00e4 sanana tai lyhyen\u00e4 sanaliittona. definition = selitys yhdell\u00e4 virkkeell\u00e4, JOSSA EI SAA ESIINTY\u00c4 term-sanaa itse\u00e4\u00e4n eik\u00e4 sen taivutusmuotoa, koska oppilas arvaa termin selityksen perusteella. example = lyhyt esimerkki kappaleesta.",
    s.drills
      ? "- drills = 8\u201314 konkreettista harjoitusta, joissa oppilas soveltaa kappaleen s\u00e4\u00e4nt\u00f6\u00e4. Ota mallia kirjan omista TEHT\u00c4V\u00c4T-kohdista ja k\u00e4yt\u00e4 kirjan omia esimerkkej\u00e4, kun ne n\u00e4kyv\u00e4t."
      : "",
    s.drills
      ? '- drills.prompt = se mit\u00e4 oppilaalle n\u00e4ytet\u00e4\u00e4n, esim. "hiiren korva" tai "panda \u2013 panda". drills.task = lyhyt ohje, esim. "Kirjoita yhdyssanana" tai "Kirjoita isolla tai pienell\u00e4 alkukirjaimella".'
      : "",
    s.drills
      ? "- drills.answer = TASAN YKSI oikea vastaus, lyhyt (1\u20134 sanaa). Vastausta verrataan kirjoitettuun tekstiin merkki merkilt\u00e4, joten \u00e4l\u00e4 tee teht\u00e4vi\u00e4, joihin on monta yht\u00e4 oikeaa vastausta. Jos hyv\u00e4ksytt\u00e4vi\u00e4 muotoja on kaksi, erota ne pilkulla."
      : "",
    s.drills ? "- drills.why = yhden virkkeen perustelu, miksi vastaus on oikein." : "",
    s.drills
      ? "- drills.strictCase = true niiss\u00e4 teht\u00e4viss\u00e4, joissa nimenomaan iso tai pieni alkukirjain on opeteltava asia (esim. yleisnimet ja erisnimet). Muuten false."
      : "",
    "- questions = " + s.questions + " avointa kysymyst\u00e4, joihin oppilas vastaa omin sanoin. K\u00e4yt\u00e4 ensisijaisesti kirjan omia pohdintateht\u00e4vi\u00e4. Kirjoita kysymys kentt\u00e4\u00e4n sv ja j\u00e4t\u00e4 fi tyhj\u00e4ksi.",
    key === "uskonto"
      ? "- Kerro kappaleen sis\u00e4lt\u00f6 kunnioittavasti ja kuvaillen: mit\u00e4 t\u00e4m\u00e4 uskonto tai kertomus opettaa ja mit\u00e4 sen edustajat uskovat. \u00c4l\u00e4 ota kantaa siihen, onko jokin uskonto tosi tai oikea, \u00e4l\u00e4k\u00e4 aseta uskontoja paremmuusj\u00e4rjestykseen. Kysymykset saavat olla pohtivia."
      : "",
    "- T\u00c4RKE\u00c4\u00c4: oppilas vastaa KIRJOITTAMALLA, joten jokaiseen kysymykseen on voitava vastata sanoin. Jos kirjan teht\u00e4v\u00e4 on piirt\u00e4mis-, v\u00e4ritys-, yhdist\u00e4mis- tai muu toiminnallinen teht\u00e4v\u00e4, \u00c4L\u00c4 ota sit\u00e4 sellaisenaan vaan muotoile siit\u00e4 sanallinen versio, joka harjoittaa samaa asiaa. Kirjoita silloin note-kentt\u00e4\u00e4n, mit\u00e4 kirjassa oikeasti pyydet\u00e4\u00e4n tekem\u00e4\u00e4n. Muuten note on tyhj\u00e4 merkkijono.",
    "- \u00c4l\u00e4 keksi sis\u00e4lt\u00f6\u00e4, jota kappaleessa ei ole.",
    "- \u00c4l\u00e4 kirjoita mit\u00e4\u00e4n muuta kuin JSON."
  ]
    .filter(Boolean)
    .join("\n");
}

// Matematiikassa kappaleesta ei poimita sisältöä vaan RESEPTI. Claude kirjoittaa
// tehtävämallit — lukualueet, ehdot, vastauslausekkeen, askeleet ja tyypilliset
// virheet — ja sovellus arpoo niistä uudet luvut joka kerta ja laskee vastauksen
// itse. Yksi kutsu kappaletta kohden, sen jälkeen harjoittelu on rajatonta.
function mathPrompt(title, text, hasImages) {
  return [
    "Olet apuopettaja suomalaiselle 11-vuotiaalle oppilaalle, joka käy 5. luokkaa ruotsinkielisessä kielikylvyssä.",
    "Matematiikan tunnit ovat ruotsiksi. Laskeminen sujuu, mutta ruotsinkieliset sanalliset tehtävät ovat vaikeita.",
    "",
    title ? "Oppilaan antama kappaleen nimi: " + title : "",
    sourceBlock(text, hasImages),
    "",
    "Tehtäväsi on kirjoittaa kappaleesta TEHTÄVÄMALLIT, ei valmiita laskuja. Sovellus arpoo malleista uudet luvut ja laskee vastauksen itse.",
    "Vastaa VAIN JSON-oliolla tässä muodossa:",
    '{"subject":"matte","chapterNo":"","titleSv":"","titleFi":"","summaryFi":["",""],"summarySv":["",""],"words":[{"sv":"","fi":"","exampleSv":"","exampleFi":""}],"models":[{"id":"","nameSv":"","nameFi":"","vars":{},"conds":[],"sv":"","fi":"","answer":"","format":"","unit":"","steps":[""],"traps":[{"when":"","why":""}]}],"questions":[{"sv":"","fi":"","note":""}]}',
    "",
    "Säännöt:",
    '- chapterNo = kappaleen numero ja sivut kuten kirjassa, esim. "Kapitel 4 · s. 16–19". Jos numeroa ei näy, jätä tyhjäksi.',
    "- titleSv = otsikko ruotsiksi TÄSMÄLLEEN kuten kirjassa. titleFi = sama suomeksi.",
    "- summaryFi = 5–7 lyhyttä virkettä SUOMEKSI siitä, mitä kappale opettaa ja miten lasku tehdään. Viimeinen virke on malliesimerkki kirjan omilla luvuilla askel askeleelta.",
    "- summarySv = täsmälleen samat virkkeet ruotsiksi, samassa järjestyksessä ja yhtä monta.",
    '- words = 8–14 kappaleen ruotsinkielistä matematiikan termiä (esim. "täljare", "nämnare", "produkt", "liksidig"). fi = suomennos, exampleSv = lyhyt esimerkkilause, exampleFi = sen suomennos.',
    "",
    "- models = 4–8 tehtävämallia, jotka kattavat kappaleen laskutyypit. Ota mallia kirjan omista tehtävistä ja käytä samoja lukualueita kuin kirja.",
    '- models.id = lyhyt tunniste ilman välilyöntejä, esim. "kertolasku-3x1". nameSv ja nameFi = tehtävätyypin nimi, esim. "Multiplikation" / "Kertolasku".',
    '- models.vars = arvottavat muuttujat. Numeromuuttuja annetaan välinä: "a": [100, 999] arpoo kokonaisluvun väliltä. Sanallinen muuttuja annetaan listana: "namn": ["Elsa", "Otto", "Vera"]. Anna sanallisiin listoihin 4–6 vaihtoehtoa, jotta tehtävät eivät toistu.',
    '- models.conds = ehdot, joiden pitää toteutua, jotta luvut ovat järkeviä, esim. ["a > b", "hinta % kg == 0"]. Ilman ehtoja tulee helposti negatiivisia tai rumia vastauksia.',
    '- models.sv = tehtävä ruotsiksi ja models.fi = SAMA tehtävä suomeksi. Luvut merkitään aaltosulkeilla: "{namn} köper {kg} kg äpplen för {hinta/100:desimaali2} €. Vad kostar 1 kg?". Aaltosulkeiden sisällä saa laskea.',
    '- models.answer = lauseke, joka antaa oikean vastauksen, esim. "hinta / kg / 100". ÄLÄ anna lukua vaan lauseke.',
    '- models.format = "kokonaisluku", "desimaali1", "desimaali2", "murtoluku", "sievennetty" tai "auto". models.unit = yksikkö jos tehtävä sitä vaatii, esim. "€" tai "cm", muuten tyhjä.',
    '- models.steps = 2–4 ratkaisun askelta SUOMEKSI. Näytetään vihjeenä yksi kerrallaan, joten kirjoita ne oikeassa järjestyksessä ja käytä niissäkin aaltosulkeita, esim. "{hinta/100:desimaali2} : {kg} = ?".',
    '- models.traps = 1–3 tyypillistä virhettä. when = lauseke, jonka oppilas saisi vastaukseksi jos tekisi juuri sen virheen, esim. "hinta * kg / 100". why = yhdellä virkkeellä SUOMEKSI mitä hän teki, esim. "Kerroit jakamisen sijaan."',
    "",
    "Lausekkeissa saa käyttää VAIN: muuttujien nimiä, kokonaislukuja, merkkejä + - * / % ( ) , vertailuja == != < <= > >= sekä && ja ||, ja funktioita abs, round, floor, ceil, min, max, gcd, sqrt.",
    "Jakolaskut lasketaan tarkkoina murtolukuina, joten \"1 / 3\" on tarkka kolmasosa.",
    "ÄLÄ käytä muuttujanimeä vastaus — se on varattu.",
    "",
    "- questions = 2–4 kappaleen omaa tehtävää, joihin vastataan SANOIN eikä laskemalla (esim. selitä miksi, vertaa, päättele). sv = kysymys ruotsiksi, fi = sama suomeksi. Geometriset piirtämistehtävät ja taulukon tulkinta kuuluvat tänne, EIVÄT models-listaan.",
    "- TÄRKEÄÄ: oppilas vastaa kysymyksiin kirjoittamalla. Jos kirjan tehtävä vaatii piirtämistä tai mittaamista, muotoile siitä sanallinen versio ja kerro note-kentässä SUOMEKSI mitä kirjassa oikeasti pyydetään. Muuten note on tyhjä.",
    "- Älä keksi laskutyyppejä, joita kappaleessa ei ole.",
    "- Älä kirjoita mitään muuta kuin JSON."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(subjectKey, title, text, hasImages) {
  if (FI_SUBJECTS[subjectKey]) return finnishPrompt(subjectKey, title, text, hasImages);
  if (subjectKey === "matte") return mathPrompt(title, text, hasImages);
  const s = SUBJECTS[subjectKey];
  const auto = !s;
  return [
    "Olet apuopettaja suomalaiselle 11-vuotiaalle oppilaalle, joka k\u00e4y 5. luokkaa ruotsinkielisess\u00e4 kielikylvyss\u00e4.",
    "Oppitunnit ovat ruotsiksi. Oppilas haluaa tutustua tulevan tunnin kappaleeseen etuk\u00e4teen, jotta tunnilla on helpompi pysy\u00e4 mukana.",
    "",
    auto ? "Oppiaine ei ole tiedossa \u2014 p\u00e4\u00e4ttele se itse aineistosta." : "Oppiaine: " + s.sv + " (" + s.fi + ").",
    auto
      ? 'Osa aineista k\u00e4sitell\u00e4\u00e4n eri tavalla. Jos aineisto on jokin n\u00e4ist\u00e4, vastaa TASAN yhdell\u00e4 n\u00e4ist\u00e4 rivist\u00e4 eik\u00e4 mill\u00e4\u00e4n muulla: matematiikkaa (laskuja, lukuja, geometriaa) k\u00e4sittelev\u00e4 aineisto \u2192 {"subject":"matte"}; suomen kielt\u00e4, kielioppia tai kirjallisuutta k\u00e4sittelev\u00e4 suomenkielinen aineisto \u2192 {"subject":"aidinkieli"}; uskontoa, Raamattua tai etiikkaa k\u00e4sittelev\u00e4 suomenkielinen aineisto \u2192 {"subject":"uskonto"}'
      : "",
    title ? "Oppilaan antama kappaleen nimi: " + title : "",
    sourceBlock(text, hasImages),
    "",
    "Tee kappaleesta ennakkomateriaali. Vastaa VAIN JSON-oliolla t\u00e4ss\u00e4 muodossa:",
    '{"subject":"","chapterNo":"","titleSv":"","titleFi":"","summaryFi":["",""],"summarySv":["",""],"words":[{"sv":"","fi":"","exampleSv":"","exampleFi":""}],"phrases":[{"sv":"","fi":""}],"questions":[{"sv":"","fi":"","note":""}]}',
    "",
    "S\u00e4\u00e4nn\u00f6t:",
    auto
      ? '- subject = yksi n\u00e4ist\u00e4: "omg" (Omgivningsl\u00e4ra), "hist" (Historia) tai "matte" (Matematik). Jos mik\u00e4\u00e4n ei sovi, "annat".'
      : '- subject = "' + subjectKey + '".',
    '- chapterNo = kappaleen numero ja sivut sellaisena kuin ne kirjassa lukevat, esim. "Kapitel 4 \u00b7 s. 16\u201319". Jos numeroa ei n\u00e4y, j\u00e4t\u00e4 tyhj\u00e4ksi.',
    "- titleSv = kappaleen otsikko ruotsiksi T\u00c4SM\u00c4LLEEN kuten kirjassa. titleFi = sama suomeksi.",
    "- summaryFi = 5\u20137 lyhytt\u00e4 virkett\u00e4 SELKE\u00c4LL\u00c4 SUOMELLA. Selit\u00e4 kappaleen t\u00e4rkeimm\u00e4t asiat niin, ett\u00e4 oppilas ymm\u00e4rt\u00e4\u00e4 sis\u00e4ll\u00f6n ennen tuntia. Ei ruotsia n\u00e4iss\u00e4.",
    "- summarySv = T\u00c4SM\u00c4LLEEN samat virkkeet ruotsiksi, samassa j\u00e4rjestyksess\u00e4 ja yht\u00e4 monta. Yksinkertaista ruotsia, lyhyit\u00e4 p\u00e4\u00e4lauseita, kappaleen omia termej\u00e4. Oppilas lukee n\u00e4m\u00e4 rinnakkain suomenkielisten kanssa.",
    '- words = 12\u201318 kappaleen t\u00e4rkeint\u00e4 ruotsinkielist\u00e4 sanaa tai termi\u00e4. sv-kent\u00e4ss\u00e4 substantiivit muodossa "moln (ett)" ja verbit muodossa "att stiga". fi = suomennos; anna yksi selke\u00e4 vastine, vaihtoehdot pilkulla erotettuna. exampleSv = lyhyt esimerkkilause ruotsiksi kappaleen aiheesta, exampleFi = sen suomennos.',
    "- phrases = 4\u20136 lausetta tai sanontaa, joita t\u00e4st\u00e4 aiheesta todenn\u00e4k\u00f6isesti k\u00e4ytet\u00e4\u00e4n tunnilla.",
    "- questions = 3\u20135 kysymyst\u00e4, joita opettaja voi kysy\u00e4. K\u00e4yt\u00e4 ensisijaisesti kirjan omia Uppgifter-teht\u00e4vi\u00e4, jos ne n\u00e4kyv\u00e4t. sv = kysymys ruotsiksi, fi = mit\u00e4 se tarkoittaa suomeksi.",
    "- T\u00c4RKE\u00c4\u00c4: oppilas vastaa kysymyksiin KIRJOITTAMALLA, joten jokaiseen on voitava vastata sanoin. Jos kirjan teht\u00e4v\u00e4 on piirt\u00e4mis-, v\u00e4ritys-, yhdist\u00e4mis-, mittaus- tai muu toiminnallinen teht\u00e4v\u00e4, \u00c4L\u00c4 ota sit\u00e4 sellaisenaan. Muotoile siit\u00e4 sanallinen versio, joka harjoittaa samaa asiaa (esim. \"Rita olika fr\u00f6n\" \u2192 \"Beskriv tv\u00e5 olika fr\u00f6n. Hur ser de ut?\"), ja kirjoita note-kentt\u00e4\u00e4n SUOMEKSI, mit\u00e4 kirjassa oikeasti pyydet\u00e4\u00e4n tekem\u00e4\u00e4n. Muuten note on tyhj\u00e4 merkkijono.",
    "- K\u00e4yt\u00e4 sit\u00e4 sanastoa, joka oikeasti esiintyy kappaleessa. \u00c4l\u00e4 keksi sis\u00e4lt\u00f6\u00e4, jota kappaleessa ei ole.",
    "- \u00c4l\u00e4 kirjoita mit\u00e4\u00e4n muuta kuin JSON. \u00c4l\u00e4 kirjoita selityksi\u00e4 tai koodilohkoja JSONin ymp\u00e4rille."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request) {
  if (!verifyToken(request.cookies.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!anthropicConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY puuttuu Vercelin ympäristömuuttujista." },
      { status: 503 }
    );
  }
  const body = (await request.json()) || {};
  const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
  const blocks = [];

  for (const img of images) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(img));
    if (!m) continue;
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: m[1], data: m[2] }
    });
  }
  const media = blocks.slice();
  const withPrompt = (subjectKey) =>
    media.concat([
      { type: "text", text: buildPrompt(subjectKey, body.title, body.text, media.length > 0) }
    ]);

  // Kolme aineryhmää, kolme eri vastausmuotoa.
  const ownPrompt = (s) => !!FI_SUBJECTS[s] || s === "matte";
  const hasContent = (d) =>
    d &&
    (FI_SUBJECTS[d.subject]
      ? Array.isArray(d.concepts) && d.concepts.length
      : d.subject === "matte"
      ? Array.isArray(d.models) && d.models.length
      : Array.isArray(d.words) && d.words.length);

  try {
    let out = await ask({ blocks: withPrompt(body.subject), maxTokens: 16000 });
    let data = parseJson(out.text);

    // On auto-detect the model answers with just the subject name when the
    // pages turn out to need a different shape; ask again with that prompt.
    if (data && ownPrompt(data.subject) && data.subject !== body.subject && !hasContent(data)) {
      out = await ask({ blocks: withPrompt(data.subject), maxTokens: 16000 });
      data = parseJson(out.text);
    }

    if (!hasContent(data)) {
      return NextResponse.json(
        { error: "Kappaleesta ei saatu sisältöä. Kokeile teräviä kuvia." },
        { status: 422 }
      );
    }

    // Väärin laskeva harjoitus on pahempi kuin ei harjoitusta lainkaan, joten
    // jokainen malli koeajetaan viidellä arvonnalla ennen kuin se päästetään
    // läpi. Hylätyistä kerrotaan suoraan.
    let dropped = 0;
    if (data.subject === "matte" && Array.isArray(data.models)) {
      const before = data.models.length;
      data.models = validateModels(data.models);
      dropped = before - data.models.length;
      if (!data.models.length) {
        return NextResponse.json(
          { error: "Tehtävämalleista ei saatu toimivia. Kokeile uudelleen tai terävimmillä kuvilla." },
          { status: 422 }
        );
      }
    }

    // If the answer was cut short, what survived is still a usable chapter —
    // say so rather than throwing the whole thing away.
    return NextResponse.json({
      chapter: data,
      warning: out.truncated
        ? "Kappale oli pitkä, joten loppu jäi lyhyeksi. Tarkista listat ja lisää tarvittaessa kappale uudelleen pienemmissä osissa."
        : dropped
        ? dropped + (dropped === 1 ? " tehtävämalli hylättiin" : " tehtävämallia hylättiin") + ", koska se ei laskenut oikein. Loput toimivat."
        : ""
    });
  } catch (e) {
    const msg =
      e.code === "bad_key"
        ? "Anthropic-avain ei kelpaa."
        : e.code === "invalid_json"
        ? "Vastausta ei saatu luettua. Kokeile uudelleen."
        : "Kappaleen luonti epäonnistui. " + String(e.message || e).slice(0, 200);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

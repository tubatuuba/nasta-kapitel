"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { makeTask, checkAnswer, diagnose } from "../lib/mathgen";

const SUBJECTS = {
  omg: { sv: "Omgivningslära", fi: "Ympäristöoppi", color: "var(--geo)" },
  hist: { sv: "Historia", fi: "Historia", color: "var(--hist)" },
  matte: { sv: "Matematik", fi: "Matematiikka", color: "var(--math)" },
  // Äidinkieli is taught in Finnish, so it gets Finnish-only material and its
  // own exercise types (concepts and rule practice) instead of a word drill.
  aidinkieli: {
    sv: "Modersmål och litteratur",
    fi: "Äidinkieli ja kirjallisuus",
    color: "var(--lang)",
    fiOnly: true
  },
  // Uskonto is taught in Finnish too, but unlike äidinkieli it has no rules to
  // drill — only the chapter's own terms and things worth thinking about.
  uskonto: { sv: "Religion", fi: "Uskonto", color: "var(--rel)", fiOnly: true },
  annat: { sv: "Annat ämne", fi: "Muu aine", color: "var(--ink-3)" }
};

/* ---------- answer checking ---------- */
function clean(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[.,;:!?"'’`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function stripLead(s) {
  return s.replace(/^(en|ett|att|den|det)\s+/, "");
}
function targets(field) {
  const out = [];
  String(field || "")
    .split(/[,/;]| tai | eller /i)
    .forEach((part) => {
      const c = clean(part);
      if (!c) return;
      out.push(c);
      const s = stripLead(c);
      if (s !== c) out.push(s);
    });
  return out;
}
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}
function judge(input, field) {
  const got = clean(input);
  if (!got) return "empty";
  const gots = [got];
  const g2 = stripLead(got);
  if (g2 !== got) gots.push(g2);
  const ts = targets(field);
  for (const g of gots) if (ts.includes(g)) return "correct";
  let best = 99;
  let bestLen = 0;
  for (const g of gots)
    for (const t of ts) {
      const d = lev(g, t);
      if (d < best) {
        best = d;
        bestLen = t.length;
      }
    }
  if (best === 1 || (best === 2 && bestLen >= 8)) return "close";
  return "wrong";
}
// Capitalisation IS the lesson in the erisnimi/yleisnimi chapter, so those
// exercises are checked letter for letter and a wrong initial gets its own
// verdict instead of passing as correct.
function judgeExact(input, answer) {
  const tidy = (x) => String(x || "").trim().replace(/\s+/g, " ");
  const got = tidy(input);
  if (!got) return "empty";
  const ts = String(answer || "")
    .split(/[,/;]| tai /i)
    .map(tidy)
    .filter(Boolean);
  if (ts.includes(got)) return "correct";
  if (ts.some((t) => t.toLowerCase() === got.toLowerCase())) return "case";
  return judge(input, answer) === "close" ? "close" : "wrong";
}

const isFi = (c) => !!(SUBJECTS[c && c.subject] || {}).fiOnly;
const subjectName = (s) => (s.fiOnly ? s.fi : s.sv + " · " + s.fi);

// Progress is stored as a flat map of keys, so each subject just needs a stable
// key per practisable item.
const conceptKey = (x) => "k:" + String((x && x.term) || "");
const drillKey = (x) => "h:" + String((x && x.prompt) || "");
function practiceKeys(c) {
  if (!c) return [];
  if (isFi(c))
    return (c.concepts || []).map(conceptKey).concat((c.drills || []).map(drillKey));
  return (c.words || []).map((w) => w.sv);
}

const bare = (sv) => String(sv || "").replace(/\s*\((en|ett)\)\s*/i, "").trim();

// The server returns chapters in teaching order (Kapitel 4 before Kapitel 9).
// A newly created chapter has to be slotted into that same order, not stuck on
// top, or the list disagrees with itself until the next reload.
function chapterOrder(c) {
  const m = String((c && c.chapterNo) || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}
const SUBJECT_RANK = ["omg", "hist", "matte", "aidinkieli", "uskonto", "annat"];
function subjectRank(c) {
  const i = SUBJECT_RANK.indexOf((c && c.subject) || "annat");
  return i < 0 ? SUBJECT_RANK.length : i;
}
// Subjects stay together, and inside a subject the chapters run in teaching
// order — two books can both have a chapter 4 without interleaving.
function sortChapters(list) {
  return list
    .slice()
    .sort(
      (a, b) =>
        subjectRank(a) - subjectRank(b) ||
        chapterOrder(a) - chapterOrder(b) ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );
}

const ttsUrl = (text, lang) =>
  "/api/tts?lang=" + (lang === "fi" ? "fi" : "sv") + "&text=" + encodeURIComponent(String(text).slice(0, 600));

/* ---------- small pieces ---------- */
const SpeakerIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M7 2.5 3.8 5H1.5v6h2.3L7 13.5zM10.2 4.6a.75.75 0 0 1 1.05.14 5.4 5.4 0 0 1 0 6.52.75.75 0 1 1-1.19-.91 3.9 3.9 0 0 0 0-4.7.75.75 0 0 1 .14-1.05" />
  </svg>
);

function Speak({ text, lang, play, className }) {
  const [busy, setBusy] = useState(false);
  if (!text) return null;
  const fi = lang === "fi";
  return (
    <button
      type="button"
      className={"speak" + (className ? " " + className : "") + (busy ? " busy" : "")}
      title={fi ? "Kuuntele suomeksi" : "Kuuntele ruotsiksi"}
      aria-label={(fi ? "Kuuntele suomeksi: " : "Kuuntele ruotsiksi: ") + text}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        Promise.resolve(play(text, lang)).finally(() => setBusy(false));
      }}
    >
      <SpeakerIcon />
    </button>
  );
}

function Listen({ label, text, lang, play }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={"listen" + (busy ? " busy" : "")}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        Promise.resolve(play(text, lang)).finally(() => setBusy(false));
      }}
    >
      <SpeakerIcon />
      <span>{busy ? "Haetaan ääntä…" : label}</span>
    </button>
  );
}

function SecLabel({ children, sub, action }) {
  return (
    <p className="sec-label">
      {children}
      {sub ? <b>{sub}</b> : null}
      {action}
    </p>
  );
}

/* ---------- main ---------- */
export default function App() {
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");
  const [filter, setFilter] = useState("all");
  const [currentId, setCurrentId] = useState(null);
  const [tab, setTab] = useState("summary");
  const [dirMode, setDirMode] = useState("mix");
  const [drill, setDrill] = useState(null);
  const [qState, setQState] = useState({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [audioErr, setAudioErr] = useState("");
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef(null);
  const inputRef = useRef(null);

  // Audio is fetched ahead of time and kept in memory as object URLs, so a tap
  // plays instantly instead of waiting for a round-trip. Playback still starts
  // synchronously inside the click handler, which iOS requires.
  const clips = useRef(new Map());
  const inflight = useRef(new Set());
  const queue = useRef([]);
  const running = useRef(0);

  const pump = useCallback(() => {
    while (running.current < 2 && queue.current.length) {
      const url = queue.current.shift();
      if (clips.current.has(url)) {
        inflight.current.delete(url);
        continue;
      }
      running.current++;
      fetch(url, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (b && b.size) clips.current.set(url, URL.createObjectURL(b));
        })
        .catch(() => {})
        .finally(() => {
          running.current--;
          inflight.current.delete(url);
          pump();
        });
    }
  }, []);

  const prefetch = useCallback(
    (text, lang) => {
      if (!text) return;
      const url = ttsUrl(text, lang);
      if (clips.current.has(url) || inflight.current.has(url)) return;
      inflight.current.add(url);
      queue.current.push(url);
      pump();
    },
    [pump]
  );

  const currentUrl = useRef("");

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
    } catch {}
    currentUrl.current = "";
    setPlaying(false);
  }, []);

  // Tapping the speaker that is already playing stops it; there is also a
  // stop button on screen for as long as something is playing.
  const play = useCallback(
    (text, lang) => {
      const a = audioRef.current;
      if (!a || !text) return Promise.resolve();
      const url = ttsUrl(text, lang);
      if (currentUrl.current === url && !a.paused) {
        stop();
        return Promise.resolve();
      }
      setAudioErr("");
      try {
        a.pause();
      } catch {}
      currentUrl.current = url;
      a.src = clips.current.get(url) || url;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      return new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          a.removeEventListener("playing", done);
          a.removeEventListener("error", done);
          resolve();
        };
        a.addEventListener("playing", done);
        a.addEventListener("error", done);
        setTimeout(done, 20000);
      });
    },
    [stop]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chapters", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const j = await res.json();
      setChapters(sortChapters(j.chapters || []));
      setWarning(j.warning || "");
    } catch {
      setWarning("Kappaleiden lataus ei onnistunut.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = chapters;
  const shown = filter === "all" ? visible : visible.filter((c) => c.subject === filter);
  const ch = visible.find((c) => c.id === currentId) || shown[0] || null;

  useEffect(() => {
    if (ch && ch.id !== currentId) setCurrentId(ch.id);
  }, [ch, currentId]);

  const knownMap = (c) => (c && c.known) || {};
  const knownCount = (c) => practiceKeys(c).filter((k) => knownMap(c)[k]).length;

  // Progress is written to the server in batches: answering a word updates the
  // screen at once, and the save is flushed once the tapping stops (or when the
  // page is hidden). Without this every single word would cost a write.
  const pendingRef = useRef({});
  const timerRef = useRef(null);

  const flushProgress = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = {};
    clearTimeout(timerRef.current);
    for (const id of Object.keys(pending)) {
      try {
        fetch("/api/chapters/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending[id]),
          keepalive: true
        }).catch(() => {});
      } catch {}
    }
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushProgress);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushProgress);
      flushProgress();
    };
  }, [flushProgress]);

  function patchChapter(id, patch) {
    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    pendingRef.current[id] = { ...(pendingRef.current[id] || {}), ...patch };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flushProgress, 2000);
  }

  function setKnown(c, key, val) {
    const known = { ...(c.known || {}) };
    if (val) known[key] = true;
    else delete known[key];
    patchChapter(c.id, { known });
  }

  function saveAnswer(c, idx, rec) {
    const answers = { ...(c.answers || {}) };
    answers[idx] = rec;
    patchChapter(c.id, { answers });
    flushProgress();
  }

  // Matikassa vastauksia tulee kymmeniä minuutissa, joten tallennus jää
  // eräajoon eikä lähde joka laskun jälkeen kuten avoimissa kysymyksissä.
  function setMastery(c, modelId, rec) {
    const answers = { ...(c.answers || {}) };
    answers["m:" + modelId] = rec;
    patchChapter(c.id, { answers });
  }

  async function addSwedish(id) {
    try {
      const res = await fetch("/api/chapters/" + encodeURIComponent(id) + "/sv", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.chapter) return false;
      setChapters((prev) =>
        prev.map((c) => (c.id === id ? { ...c, summarySv: j.chapter.summarySv || [] } : c))
      );
      return true;
    } catch {
      return false;
    }
  }

  async function removeChapter(c) {
    setChapters((prev) => prev.filter((x) => x.id !== c.id));
    setCurrentId(null);
    try {
      await fetch("/api/chapters/" + encodeURIComponent(c.id), { method: "DELETE" });
    } catch {}
  }

  /* ---- drill ---- */
  const startDrill = useCallback(
    (c, mode) => {
      const km = knownMap(c);
      let pool = (c.words || []).filter((w) => !km[w.sv]);
      if (!pool.length) pool = (c.words || []).slice();
      pool = pool.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i];
        pool[i] = pool[j];
        pool[j] = t;
      }
      const m = mode || dirMode;
      setDrill({
        chapterId: c.id,
        queue: pool.map((w) => ({ w, dir: m === "mix" ? (Math.random() < 0.5 ? "fi2sv" : "sv2fi") : m })),
        i: 0,
        phase: "ask",
        result: null,
        typed: "",
        tries: 0,
        right: 0
      });
    },
    [dirMode]
  );

  useEffect(() => {
    if (tab === "words" && ch && !isFi(ch) && (!drill || drill.chapterId !== ch.id)) startDrill(ch);
  }, [tab, ch, drill, startDrill]);

  useEffect(() => {
    if (tab === "words" && drill && drill.phase === "ask" && inputRef.current) {
      try {
        inputRef.current.focus();
      } catch {}
    }
  }, [tab, drill]);

  function switchChapter(id) {
    setCurrentId(id);
    setTab("summary");
    setDrill(null);
    setQState({});
  }

  /* ---------- render ---------- */
  const subjectsInUse = new Set(visible.map((c) => c.subject));

  return (
    <div className="wrap">
      <audio
        ref={audioRef}
        hidden
        onPlaying={() => setPlaying(true)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setAudioErr("Ääntä ei saatu toistettua.");
        }}
      />

      <header className="topbar">
        <div className="brand">
          <h1>
            Nästa <span className="k">kapitel</span>
          </h1>
          <p>Katso kappale läpi ennen tuntia — suomeksi selitys, ruotsiksi sanat.</p>
        </div>
        <div className="topbar-actions">
          <button className="btn primary" onClick={() => setSheetOpen(true)}>
            + Uusi kappale
          </button>
        </div>
      </header>

      {warning ? <div className="notice" style={{ marginBottom: 18 }}>{warning}</div> : null}

      <div className="layout">
        <aside className="rail">
          <div>
            <p className="rail-label">Aine</p>
            {/* Nämä ovat toisensa poissulkevia valintoja, eivät päälle/pois-
                kytkimiä. Radiovalintana avustava teknologia lukee ne
                "valittu / ei valittu" eikä "ei käytössä". */}
            <div className="filters" role="radiogroup" aria-label="Aine">
              <button
                type="button"
                role="radio"
                className="chip"
                aria-checked={filter === "all"}
                onClick={() => setFilter("all")}
              >
                Kaikki
              </button>
              {Object.keys(SUBJECTS)
                .filter((k) => k !== "annat" || subjectsInUse.has("annat"))
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {SUBJECTS[k].fi}
                  </button>
                ))}
            </div>
          </div>
          <div>
            <p className="rail-label">Kappaleet</p>
            <div className="chapter-list">
              {loading ? (
                <p className="ch-meta">Ladataan…</p>
              ) : !shown.length ? (
                <p className="ch-meta">Ei vielä kappaleita.</p>
              ) : (
                shown.map((c) => {
                  const s = SUBJECTS[c.subject] || SUBJECTS.annat;
                  const total = practiceKeys(c).length;
                  const k = knownCount(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="ch-card"
                      style={{ "--sub": s.color }}
                      aria-current={c.id === currentId}
                      onClick={() => switchChapter(c.id)}
                    >
                      <div className="ch-sub">{(s.fiOnly ? s.fi : s.sv) + (c.chapterNo ? " · " + c.chapterNo : "")}</div>
                      <div className="ch-title">{c.titleSv || "Nimetön kappale"}</div>
                      <div className="ch-meta">
                        <span className="mini-bar">
                          <i style={{ width: total ? Math.round((k / total) * 100) + "%" : "0%" }} />
                        </span>
                        <span>
                          {k}/{total}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        <main>
          {loading ? (
            <div className="panel">
              <div className="loading">Ladataan kappaleita…</div>
            </div>
          ) : !ch ? (
            <div className="panel">
              <div className="empty">
                <h3>Ei vielä kappaleita</h3>
                <p>
                  Kuvaa tulevan tunnin kappale oppikirjasta, niin saat siitä suomenkielisen selityksen,
                  sanaharjoituksen ja opettajan kysymykset.
                </p>
                <button className="btn primary" onClick={() => setSheetOpen(true)}>
                  + Uusi kappale
                </button>
              </div>
            </div>
          ) : (
            <ChapterPanel
              ch={ch}
              tab={tab}
              setTab={setTab}
              play={play}
              knownCount={knownCount}
              drill={drill}
              setDrill={setDrill}
              startDrill={startDrill}
              dirMode={dirMode}
              setDirMode={setDirMode}
              setKnown={setKnown}
              inputRef={inputRef}
              qState={qState}
              setQState={setQState}
              saveAnswer={saveAnswer}
              setMastery={setMastery}
              removeChapter={removeChapter}
              addSwedish={addSwedish}
              prefetch={prefetch}
            />
          )}
          {audioErr ? <p className="audio-err">{audioErr}</p> : null}
          {playing ? (
            <button type="button" className="stopbar" onClick={stop} aria-label="Pysäytä ääni">
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
              </svg>
              <span>Pysäytä</span>
            </button>
          ) : null}
        </main>
      </div>

      <p className="footnote">
        Kappaleet, sanaharjoitukset ja vastaukset tallentuvat tälle sivulle. Kaiutinpainike lukee
        ruotsinkieliset sanat ruotsiksi ja suomenkieliset suomeksi.
      </p>

      {sheetOpen ? (
        <NewChapterSheet
          onClose={() => setSheetOpen(false)}
          onCreated={(c, note) => {
            setChapters((prev) => sortChapters([...prev, c]));
            setWarning(note || "");
            setCurrentId(c.id);
            setTab("summary");
            setDrill(null);
            setQState({});
            setSheetOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- chapter panel ---------- */
function ChapterPanel(props) {
  const {
    ch, tab, setTab, play, knownCount, drill, setDrill, startDrill,
    dirMode, setDirMode, setKnown, inputRef, qState, setQState, saveAnswer, setMastery,
    removeChapter, addSwedish, prefetch
  } = props;

  const s = SUBJECTS[ch.subject] || SUBJECTS.annat;
  const total = (ch.words || []).length;
  const k = knownCount(ch);
  const [armed, setArmed] = useState(false);

  const fi = isFi(ch);
  const nConcepts = (ch.concepts || []).length;
  const nDrills = (ch.drills || []).length;
  const nq = (ch.questions || []).length;
  const models = (ch.models || []).filter((m) => m && m.id);
  const mastered = models.filter(
    (m) => (((ch.answers || {})["m:" + m.id] || {}).streak || 0) >= 3
  ).length;

  // A chapter only shows the tabs it actually has content for: uskonto has no
  // rule practice, and a thin chapter should not offer an empty shelf.
  const tabs = (fi
    ? [
        ["summary", "Tiivistelmä", "", true],
        ["concepts", "Käsitteet", nConcepts ? String(nConcepts) : "", nConcepts > 0],
        ["practice", "Harjoitus", nDrills ? String(nDrills) : "", nDrills > 0],
        ["questions", "Tehtävät", nq ? String(nq) : "", nq > 0]
      ]
    : [
        // Matikassa tiivistelmä on sääntö ja malliesimerkki, ja laskeminen on
        // oma välilehtensä — sanat ja kysymykset toimivat kuten muissakin.
        ["summary", ch.subject === "matte" ? "Säännöt" : "Tiivistelmä", "", true],
        ["words", "Sanat", total ? k + "/" + total : "", total > 0],
        ["math", "Laske", models.length ? mastered + "/" + models.length : "", models.length > 0],
        ["phrases", "Lauseet", (ch.phrases || []).length ? String((ch.phrases || []).length) : "", (ch.phrases || []).length > 0],
        ["questions", "Kysymykset", nq ? String(nq) : "", nq > 0]
      ]
  ).filter((t) => t[3]);

  const active = tabs.some((t) => t[0] === tab) ? tab : "summary";

  return (
    <div className="panel">
      <div className="panel-head" style={{ "--sub": s.color }}>
        <div className="eyebrow">
          <span>{subjectName(s)}</span>
          {ch.chapterNo ? <span className="tag">{ch.chapterNo}</span> : null}
        </div>
        <div className="head-row">
          <div>
            <h2>{ch.titleSv || "Nimetön kappale"}</h2>
            {ch.titleFi ? <p className="fi-title">{ch.titleFi}</p> : null}
          </div>
          <button
            className="btn ghost small"
            onClick={() => {
              if (!armed) {
                setArmed(true);
                setTimeout(() => setArmed(false), 4000);
                return;
              }
              removeChapter(ch);
            }}
          >
            {armed ? "Poista varmasti?" : "Poista"}
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className="tab"
            aria-selected={active === key}
            onClick={() => setTab(key)}
          >
            <span>{label}</span>
            {n ? <span className="n">{n}</span> : null}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {active === "summary" ? (
          <SummaryTab ch={ch} play={play} addSwedish={addSwedish} prefetch={prefetch} />
        ) : active === "concepts" ? (
          <ConceptsTab ch={ch} play={play} setKnown={setKnown} inputRef={inputRef} />
        ) : active === "practice" ? (
          <PracticeTab ch={ch} play={play} setKnown={setKnown} inputRef={inputRef} />
        ) : active === "words" ? (
          <WordsTab
            ch={ch}
            play={play}
            drill={drill}
            setDrill={setDrill}
            startDrill={startDrill}
            dirMode={dirMode}
            setDirMode={setDirMode}
            setKnown={setKnown}
            knownCount={knownCount}
            inputRef={inputRef}
            prefetch={prefetch}
          />
        ) : active === "math" ? (
          <MathTab ch={ch} setMastery={setMastery} inputRef={inputRef} />
        ) : active === "phrases" ? (
          <PhrasesTab ch={ch} play={play} prefetch={prefetch} />
        ) : (
          <QuestionsTab ch={ch} play={play} qState={qState} setQState={setQState} saveAnswer={saveAnswer} prefetch={prefetch} fi={fi} />
        )}
      </div>
    </div>
  );
}

/* ---------- tab 1 ---------- */
function SummaryTab({ ch, play, addSwedish, prefetch }) {
  const fi = ch.summaryFi || [];
  const sv = ch.summarySv || [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (fi.length) prefetch(fi.join(" "), "fi");
    if (sv.length) {
      prefetch(sv.join(" "), "sv");
      sv.forEach((t) => prefetch(t, "sv"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, sv.length]);

  if (!fi.length) return <p>Tässä kappaleessa ei ole tiivistelmää.</p>;

  // Sentence i in Finnish and Swedish say the same thing, so they are shown as
  // one pair: read the Finnish to understand it, then the Swedish to learn it.
  return (
    <section>
      <SecLabel
        sub={sv.length ? "suomeksi ja ruotsiksi" : "suomeksi"}
        action={
          <span className="listen-pair">
            <Listen label="Kuuntele suomeksi" text={fi.join(" ")} lang="fi" play={play} />
            {sv.length ? <Listen label="Lyssna på svenska" text={sv.join(" ")} lang="sv" play={play} /> : null}
          </span>
        }
      >
        Mistä kappaleessa on kyse
      </SecLabel>

      <ul className="summary">
        {fi.map((t, i) => (
          <li key={i}>
            <div className="s-fi">
              <span>{t}</span>
              <Speak text={t} lang="fi" play={play} className="inline-fi" />
            </div>
            {sv[i] ? (
              <div className="s-sv">
                <Speak text={sv[i]} lang="sv" play={play} />
                <span>{sv[i]}</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!sv.length && !isFi(ch) ? (
        <div className="qrow" style={{ marginTop: 18 }}>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              const ok = await addSwedish(ch.id);
              if (!ok) setErr("Käännös ei onnistunut. Kokeile uudelleen.");
              setBusy(false);
            }}
          >
            {busy ? "Käännetään…" : "Lisää ruotsinkielinen tiivistelmä"}
          </button>
          {busy ? <span className="dot" /> : null}
          {err ? <span className="counter">{err}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- tab 2 ---------- */
function WordsTab({ ch, play, drill, setDrill, startDrill, dirMode, setDirMode, setKnown, knownCount, inputRef, prefetch }) {
  const total = (ch.words || []).length;

  // Warm the current card and the next two, so "Seuraava" is never a wait.
  useEffect(() => {
    if (!drill || drill.chapterId !== ch.id) return;
    for (let n = 0; n < 3; n++) {
      const it = drill.queue[drill.i + n];
      if (!it) break;
      prefetch(bare(it.w.sv), "sv");
      if (it.w.exampleSv) prefetch(it.w.exampleSv, "sv");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, drill && drill.i, drill && drill.queue.length]);

  if (!total) return <p>Tässä kappaleessa ei ole sanoja.</p>;
  if (!drill || drill.chapterId !== ch.id) return <div className="loading">Valmistellaan harjoitusta…</div>;

  const done = drill.i >= drill.queue.length;
  const item = done ? null : drill.queue[drill.i];
  const w = item ? item.w : null;
  const toSv = item ? item.dir === "fi2sv" : true;
  const answerField = w ? (toSv ? w.sv : w.fi) : "";

  function check() {
    const v = judge(drill.typed, answerField);
    if (v === "empty") return;
    if (v === "correct") {
      setKnown(ch, w.sv, true);
      setDrill({ ...drill, result: v, phase: "checked", right: drill.tries === 0 ? drill.right + 1 : drill.right });
    } else {
      setKnown(ch, w.sv, false);
      setDrill({ ...drill, result: v, phase: "checked" });
    }
  }

  return (
    <>
      <div className="drill-top">
        <div className="seg" role="radiogroup" aria-label="Harjoituksen suunta">
          {[
            ["fi2sv", "Suomi → Ruotsi"],
            ["sv2fi", "Ruotsi → Suomi"],
            ["mix", "Sekaisin"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              className="chip"
              aria-checked={dirMode === key}
              onClick={() => {
                setDirMode(key);
                startDrill(ch, key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="drill-top" style={{ flex: 1 }}>
          <span className="counter">
            Osaat {knownCount(ch)}/{total}
          </span>
          <span className="bar">
            <i style={{ width: Math.round((knownCount(ch) / total) * 100) + "%" }} />
          </span>
        </div>
      </div>

      <div className="drill">
        {done ? (
          <div className="empty">
            <h3>Kierros valmis.</h3>
            <p>
              Sait oikein {drill.right}/{drill.queue.length} ensimmäisellä yrityksellä. Osaat nyt{" "}
              {knownCount(ch)}/{total} sanaa.
            </p>
            <button className="btn primary" onClick={() => startDrill(ch)}>
              Uusi kierros
            </button>
          </div>
        ) : (
          <div className="qcard">
            <div className="dir-note">
              Harjoittele {drill.i + 1}/{drill.queue.length} ·{" "}
              {toSv ? "kirjoita ruotsiksi" : "kirjoita suomeksi"}
            </div>

            <div className={"prompt" + (toSv ? "" : " sv")}>
              <span>{toSv ? w.fi : w.sv}</span>
              {!toSv ? <Speak text={bare(w.sv)} lang="sv" play={play} /> : null}
            </div>

            {drill.phase === "ask" ? (
              <>
                <div className="answer-row">
                  <input
                    ref={inputRef}
                    type="text"
                    value={drill.typed}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={toSv ? "sana ruotsiksi" : "sana suomeksi"}
                    onChange={(e) => setDrill({ ...drill, typed: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        check();
                      }
                    }}
                  />
                  <button className="btn primary" onClick={check}>
                    Tarkista
                  </button>
                </div>
                <div className="drill-actions">
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setKnown(ch, w.sv, false);
                      setDrill({ ...drill, typed: "", result: "wrong", phase: "checked" });
                    }}
                  >
                    En tiedä
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  className={
                    "verdict " + (drill.result === "correct" ? "ok" : drill.result === "close" ? "close" : "bad")
                  }
                >
                  <div className="v-head">
                    {drill.result === "correct"
                      ? "Oikein!"
                      : drill.result === "close"
                      ? "Melkein oikein"
                      : "Ei aivan"}
                  </div>
                  {drill.result !== "correct" && clean(drill.typed) ? (
                    <div className="v-you">
                      Kirjoitit: <s>{drill.typed}</s>
                    </div>
                  ) : null}
                  <div className="v-answer">
                    <span>{answerField}</span>
                    <Speak text={toSv ? bare(w.sv) : w.fi} lang={toSv ? "sv" : "fi"} play={play} />
                  </div>
                  {w.exampleSv ? (
                    <div className="v-ex">
                      <span className="sv">{w.exampleSv}</span>
                      <Speak text={w.exampleSv} lang="sv" play={play} className="inline-fi" />
                      {w.exampleFi ? <div>{w.exampleFi}</div> : null}
                    </div>
                  ) : null}
                </div>

                <div className="drill-actions">
                  {drill.result !== "correct" ? (
                    <button
                      className="btn"
                      onClick={() => setDrill({ ...drill, phase: "ask", typed: "", tries: drill.tries + 1 })}
                    >
                      Yritä uudelleen
                    </button>
                  ) : null}
                  <button
                    className="btn primary"
                    onClick={() => {
                      const queue = drill.queue.slice();
                      if (drill.result !== "correct") queue.push(item);
                      setDrill({
                        ...drill,
                        queue,
                        i: drill.i + 1,
                        phase: "ask",
                        typed: "",
                        tries: 0,
                        result: null
                      });
                    }}
                  >
                    Seuraava
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <details className="wordlist">
        <summary>Näytä koko sanalista ({total})</summary>
        <div className="wl">
          {(ch.words || []).map((x, i) => (
            <div className="wl-row" key={i}>
              <Speak text={bare(x.sv)} lang="sv" play={play} />
              <span className="wl-sv">{x.sv}</span>
              <span className="wl-fi">{x.fi}</span>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}


/* ---------- Finnish subjects: one typed drill, two uses ---------- */
// Concepts ask for a term from its explanation; practice asks the student to
// apply a rule to a concrete item. Both are one short typed answer, so they
// share the checking, the queue and the progress bookkeeping.
function FiDrill({ ch, items, setKnown, inputRef, label, hint, emptyText, play }) {
  const [st, setSt] = useState(null);

  const start = useCallback(() => {
    const km = ch.known || {};
    let pool = items.filter((it) => !km[it.key]);
    if (!pool.length) pool = items.slice();
    pool = pool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    setSt({ chapterId: ch.id, queue: pool, i: 0, phase: "ask", typed: "", result: null, tries: 0, right: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, items.length]);

  useEffect(() => {
    if (!st || st.chapterId !== ch.id) start();
  }, [ch.id, st, start]);

  useEffect(() => {
    if (st && st.phase === "ask" && inputRef.current) {
      try {
        inputRef.current.focus();
      } catch {}
    }
  }, [st, inputRef]);

  if (!items.length) return <p>{emptyText}</p>;
  if (!st || st.chapterId !== ch.id) return <div className="loading">Valmistellaan harjoitusta…</div>;

  const total = items.length;
  const done = st.i >= st.queue.length;
  const item = done ? null : st.queue[st.i];
  const knownNow = items.filter((it) => (ch.known || {})[it.key]).length;

  function check() {
    const v = item.strictCase ? judgeExact(st.typed, item.answer) : judge(st.typed, item.answer);
    if (v === "empty") return;
    setKnown(ch, item.key, v === "correct");
    setSt({ ...st, result: v, phase: "checked", right: v === "correct" && st.tries === 0 ? st.right + 1 : st.right });
  }

  return (
    <>
      <div className="drill-top">
        <span className="counter">
          Osaat {knownNow}/{total}
        </span>
        <span className="bar">
          <i style={{ width: Math.round((knownNow / total) * 100) + "%" }} />
        </span>
      </div>

      <div className="drill">
        {done ? (
          <div className="empty">
            <h3>Kierros valmis.</h3>
            <p>
              Sait oikein {st.right}/{st.queue.length} ensimmäisellä yrityksellä. Osaat nyt {knownNow}/{total}.
            </p>
            <button className="btn primary" onClick={start}>
              Uusi kierros
            </button>
          </div>
        ) : (
          <div className="qcard">
            <div className="dir-note">
              {label} {st.i + 1}/{st.queue.length} · {hint}
            </div>

            <div className="prompt">
              <span>{item.prompt}</span>
            </div>
            {item.sub ? <div className="counter">{item.sub}</div> : null}

            {st.phase === "ask" ? (
              <>
                <div className="answer-row">
                  <input
                    ref={inputRef}
                    type="text"
                    value={st.typed}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="kirjoita vastaus"
                    onChange={(e) => setSt({ ...st, typed: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        check();
                      }
                    }}
                  />
                  <button className="btn primary" onClick={check}>
                    Tarkista
                  </button>
                </div>
                <div className="drill-actions">
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setKnown(ch, item.key, false);
                      setSt({ ...st, typed: "", result: "wrong", phase: "checked" });
                    }}
                  >
                    En tiedä
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  className={
                    "verdict " +
                    (st.result === "correct"
                      ? "ok"
                      : st.result === "close" || st.result === "case"
                      ? "close"
                      : "bad")
                  }
                >
                  <div className="v-head">
                    {st.result === "correct"
                      ? "Oikein!"
                      : st.result === "case"
                      ? "Oikea sana — tarkista alkukirjain"
                      : st.result === "close"
                      ? "Melkein oikein"
                      : "Ei aivan"}
                  </div>
                  {st.result !== "correct" && clean(st.typed) ? (
                    <div className="v-you">
                      Kirjoitit: <s>{st.typed}</s>
                    </div>
                  ) : null}
                  <div className="v-answer">
                    <span>{item.answer}</span>
                    <Speak text={item.answer} lang="fi" play={play} />
                  </div>
                  {item.why ? <div className="v-ex">{item.why}</div> : null}
                </div>

                <div className="drill-actions">
                  {st.result !== "correct" ? (
                    <button
                      className="btn"
                      onClick={() => setSt({ ...st, phase: "ask", typed: "", tries: st.tries + 1 })}
                    >
                      Yritä uudelleen
                    </button>
                  ) : null}
                  <button
                    className="btn primary"
                    onClick={() => {
                      const queue = st.queue.slice();
                      if (st.result !== "correct") queue.push(item);
                      setSt({ ...st, queue, i: st.i + 1, phase: "ask", typed: "", tries: 0, result: null });
                    }}
                  >
                    Seuraava
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ConceptsTab({ ch, play, setKnown, inputRef }) {
  const list = ch.concepts || [];
  const items = list.map((c) => ({
    key: conceptKey(c),
    prompt: c.definition,
    sub: c.example ? "Esimerkki: " + c.example : "",
    answer: c.term,
    why: c.example ? "Esimerkki: " + c.example : ""
  }));

  return (
    <section>
      <SecLabel sub="lue selitys ja kirjoita käsitteen nimi">Kappaleen käsitteet</SecLabel>
      <FiDrill
        ch={ch}
        items={items}
        setKnown={setKnown}
        inputRef={inputRef}
        play={play}
        label="Käsite"
        hint="mikä käsite tämä on?"
        emptyText="Tässä kappaleessa ei ole käsitteitä."
      />
      {list.length ? (
        <details className="wordlist">
          <summary>Näytä kaikki käsitteet ({list.length})</summary>
          <div className="qs" style={{ marginTop: 12 }}>
            {list.map((c, i) => (
              <div className="phrase" key={i}>
                <div className="sv">
                  <Speak text={c.term} lang="fi" play={play} />
                  <span>{c.term}</span>
                </div>
                <div className="fi">{c.definition}</div>
                {c.example ? <div className="fi">Esimerkki: {c.example}</div> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function PracticeTab({ ch, play, setKnown, inputRef }) {
  const list = ch.drills || [];
  const items = list.map((d) => ({
    key: drillKey(d),
    prompt: d.prompt,
    sub: d.task || "",
    answer: d.answer,
    why: d.why || "",
    strictCase: !!d.strictCase
  }));

  return (
    <section>
      <SecLabel sub="sovella kappaleen sääntöä">Harjoittele sääntöä</SecLabel>
      <FiDrill
        ch={ch}
        items={items}
        setKnown={setKnown}
        inputRef={inputRef}
        play={play}
        label="Tehtävä"
        hint="kirjoita oikea muoto"
        emptyText="Tässä kappaleessa ei ole harjoituksia."
      />
    </section>
  );
}

/* ---------- tab 3 ---------- */
/* ---------- matikka ---------- */

// Kolme peräkkäin oikein ensimmäisellä yrityksellä ilman vihjettä = tyyppi on
// hallussa ja alkaa tulla harvemmin. Yksikin virhe pudottaa sen takaisin
// kiertoon, joten osaaminen pitää näyttää uudelleen eikä vain kerran.
const MASTER = 3;
const masteryKey = (id) => "m:" + String(id || "");

function MathTab({ ch, setMastery, inputRef }) {
  const models = (ch.models || []).filter((m) => m && m.id);
  const stats = (id) => (ch.answers || {})[masteryKey(id)] || { streak: 0, right: 0, wrong: 0 };

  const [task, setTask] = useState(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState("ask");
  const [result, setResult] = useState(null);
  const [hints, setHints] = useState(0);
  const [showFi, setShowFi] = useState(false);
  const [count, setCount] = useState(1);
  const [tries, setTries] = useState(0);

  const draw = useCallback(() => {
    if (!models.length) return null;
    // Osaamaton tyyppi painaa neljä kertaa enemmän kuin hallittu.
    const pool = [];
    for (const m of models) {
      const w = ((ch.answers || {})[masteryKey(m.id)] || {}).streak >= MASTER ? 1 : 4;
      for (let i = 0; i < w; i++) pool.push(m);
    }
    let m = pool[Math.floor(Math.random() * pool.length)];
    return makeTask(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, ch.answers, models.length]);

  useEffect(() => {
    setTask(draw());
    setTyped("");
    setPhase("ask");
    setResult(null);
    setHints(0);
    setShowFi(false);
    setCount(1);
    setTries(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id]);

  if (!models.length) return <p>Tässä kappaleessa ei ole laskettavia tehtäviä.</p>;
  if (!task) return <div className="loading">Arvotaan tehtävää…</div>;

  function next() {
    setTask(draw());
    setTyped("");
    setPhase("ask");
    setResult(null);
    setHints(0);
    setShowFi(false);
    setTries(0);
    setCount(count + 1);
  }

  function check() {
    if (phase === "checked") return next();
    const out = checkAnswer(typed, task);
    if (out.verdict === "empty") return;
    const st = stats(task.id);
    if (out.verdict === "correct") {
      const flawless = tries === 0 && hints === 0;
      setMastery(ch, task.id, {
        streak: flawless ? (st.streak || 0) + 1 : st.streak || 0,
        right: (st.right || 0) + 1,
        wrong: st.wrong || 0
      });
      setResult({ verdict: "correct" });
      setPhase("checked");
      return;
    }
    if (out.verdict === "format") {
      setResult({ verdict: "format", why: out.why, shown: typed });
      setTries(tries + 1);
      return;
    }
    setMastery(ch, task.id, { streak: 0, right: st.right || 0, wrong: (st.wrong || 0) + 1 });
    setResult({ verdict: "wrong", why: diagnose(out.got, task), shown: typed });
    setPhase("checked");
  }

  const tap = (key) => {
    if (key === "ok") return check();
    if (phase === "checked") return;
    if (key === "del") return setTyped(typed.slice(0, -1));
    setTyped(typed + key);
  };

  const model = models.find((m) => m.id === task.id) || {};

  return (
    <>
      <div className="drill-top">
        <span className="drill-count">
          Tehtävä {count} · {model.nameFi || model.nameSv || "Lasku"}
        </span>
        <div className="seg">
          <button className="chip" type="button" aria-pressed={showFi} onClick={() => setShowFi(!showFi)}>
            {showFi ? "Ruotsiksi" : "Näytä suomeksi"}
          </button>
          <button
            className="chip"
            type="button"
            disabled={hints >= task.steps.length}
            onClick={() => setHints(Math.min(hints + 1, task.steps.length))}
          >
            Vinkki
          </button>
        </div>
      </div>

      <div className="math-card">
        <p className="math-q">{showFi && task.fi ? task.fi : task.sv}</p>
        {showFi && task.fi ? <p className="math-q-sv">{task.sv}</p> : null}

        {hints > 0 ? (
          <ol className="math-steps">
            {task.steps.slice(0, hints).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : null}

        <div className="math-answer">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={typed}
            placeholder="Vastaus"
            disabled={phase === "checked"}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
          />
          {task.unit ? <span className="math-unit">{task.unit}</span> : null}
        </div>

        {result ? (
          <div className={"verdict " + (result.verdict === "correct" ? "ok" : result.verdict === "format" ? "close" : "bad")}>
            <div className="v-head">
              {result.verdict === "correct"
                ? "Oikein!"
                : result.why || (result.verdict === "format" ? "Muoto ei ole oikea." : "Ei vielä oikein.")}
            </div>
            {result.verdict !== "correct" ? (
              <>
                <p className="v-you">Kirjoitit: {result.shown}</p>
                {result.verdict === "wrong" ? (
                  <p className="v-answer">
                    Oikea vastaus: <b>{task.answerText}</b>
                    {task.unit ? " " + task.unit : ""}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <div className="keypad" role="group" aria-label="Numeronäppäimistö">
          {[
            ["7", "8", "9", "/"],
            ["4", "5", "6", "-"],
            ["1", "2", "3", "del"],
            ["0", ",", "ok"]
          ].map((row, ri) => (
            <div className="keyrow" key={ri}>
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={"key" + (key === "ok" ? " key-ok" : "")}
                  onClick={() => tap(key)}
                >
                  {key === "del" ? "⌫" : key === "ok" ? (phase === "checked" ? "Seuraava" : "OK") : key === "-" ? "−" : key}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <SecLabel sub="Kolme peräkkäin oikein ilman vihjettä riittää.">Osaaminen</SecLabel>
      <ul className="mastery">
        {models.map((m) => {
          const st = stats(m.id);
          const s = Math.min(st.streak || 0, MASTER);
          return (
            <li key={m.id} className={s >= MASTER ? "done" : ""}>
              <span>{m.nameFi || m.nameSv || m.id}</span>
              <span className="pips">
                {[0, 1, 2].map((i) => (
                  <i key={i} className={i < s ? "on" : ""} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PhrasesTab({ ch, play, prefetch }) {
  const list = ch.phrases || [];
  useEffect(() => {
    list.forEach((p) => prefetch(p.sv, "sv"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id]);
  if (!list.length) return <p>Tässä kappaleessa ei ole lauseita.</p>;
  return (
    <section>
      <SecLabel sub="sano nämä ruotsiksi">Tunnilla kuuluvia lauseita</SecLabel>
      <div className="phrases">
        {list.map((p, i) => (
          <div className="phrase" key={i}>
            <div className="sv">
              <Speak text={p.sv} lang="sv" play={play} />
              <span>{p.sv}</span>
            </div>
            <div className="fi">{p.fi}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- tab 4 ---------- */
function QuestionsTab({ ch, play, qState, setQState, saveAnswer, prefetch, fi }) {
  const list = ch.questions || [];
  useEffect(() => {
    list.forEach((q) => prefetch(q.sv, fi ? "fi" : "sv"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id]);
  if (!list.length) return <p>Tässä kappaleessa ei ole kysymyksiä.</p>;

  function stateFor(i) {
    if (qState[i]) return qState[i];
    const saved = (ch.answers || {})[i] || null;
    return { busy: false, text: saved ? saved.text : "", fb: saved ? saved.fb : null, err: "" };
  }
  function update(i, patch) {
    setQState((prev) => ({ ...prev, [i]: { ...stateFor(i), ...patch } }));
  }

  async function check(i, q) {
    const st = stateFor(i);
    const text = (st.text || "").trim();
    if (!text) {
      update(i, { err: "Kirjoita ensin vastaus." });
      return;
    }
    update(i, { busy: true, err: "" });
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer: text,
          questionSv: q.sv,
          questionFi: q.fi,
          chapterTitle: ch.titleSv,
          lang: fi ? "fi" : "sv"
        })
      });
      const j = await res.json();
      if (!res.ok) {
        update(i, { busy: false, err: j.error || "Tarkistus ei onnistunut." });
        return;
      }
      update(i, { busy: false, fb: j.feedback, err: "" });
      saveAnswer(ch, i, { text, fb: j.feedback });
    } catch {
      update(i, { busy: false, err: "Yhteys ei toiminut." });
    }
  }

  return (
    <section>
      <SecLabel
        sub={fi ? "vastaa omin sanoin suomeksi" : "vastaa ruotsiksi — suomenkieliset sanat saa sekoittaa mukaan"}
      >
        {fi ? "Kirjan tehtäviä" : "Mitä opettaja voi kysyä"}
      </SecLabel>
      <div className="qs">
        {list.map((q, i) => {
          const st = stateFor(i);
          const f = st.fb;
          return (
            <div className="qbox" key={i}>
              <div className="q-n">Kysymys {i + 1}</div>
              <div className="q-sv">
                <Speak text={q.sv} lang={fi ? "fi" : "sv"} play={play} />
                <span>{q.sv}</span>
              </div>
              {fi ? null : <div className="q-fi">{q.fi}</div>}
              {q.note ? <div className="q-note">Kirjassa: {q.note}</div> : null}
              <textarea
                value={st.text}
                placeholder={fi ? "Kirjoita vastauksesi tähän…" : "Skriv ditt svar här…"}
                onChange={(e) => update(i, { text: e.target.value })}
              />
              <div className="qrow">
                <button className="btn primary" disabled={st.busy} onClick={() => check(i, q)}>
                  {st.busy ? "Claude lukee…" : "Tarkista vastaus"}
                </button>
                {st.busy ? <span className="dot" /> : null}
                {st.err ? <span className="counter">{st.err}</span> : null}
              </div>

              {f ? (
                <div
                  className={
                    "feedback " + (f.verdict === "oikein" ? "ok" : f.verdict === "osittain" ? "part" : "bad")
                  }
                >
                  <div className="f-head">
                    {f.verdict === "oikein"
                      ? "Hyvä — oikein!"
                      : f.verdict === "osittain"
                      ? "Osittain oikein"
                      : "Ei ihan vielä"}
                  </div>
                  {f.feedbackFi ? <div>{f.feedbackFi}</div> : null}

                  {!fi && (f.swedishHelp || []).length ? (
                    <div className="f-block">
                      <div className="f-label">Nämä sanoit suomeksi — näin ne sanotaan ruotsiksi</div>
                      <ul className="help-list">
                        {f.swedishHelp.map((h, j) => (
                          <li key={j}>
                            <span className="from">{h.fi}</span>
                            <span className="arrow">→</span>
                            <span className="to">{h.sv}</span>
                            <Speak text={h.sv} lang="sv" play={play} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {f.modelAnswerSv ? (
                    <div className="f-block">
                      <div className="f-label">Näin voisi vastata</div>
                      <div className="f-sv">
                        <span>{f.modelAnswerSv}</span>
                        <Speak text={f.modelAnswerSv} lang={fi ? "fi" : "sv"} play={play} />
                      </div>
                      {!fi && f.modelAnswerFi ? <div className="f-fi">{f.modelAnswerFi}</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- new chapter ---------- */
// iPhone photos come out of the library as HEIC, which createImageBitmap cannot
// decode in Safari. An <img> element can, so that is the fallback — and either
// way the picture is re-encoded to JPEG. The old code fell back to sending the
// untouched original, which blew past the 4.5 MB request limit and made the
// upload fail before it ever reached the server.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Kuvaa ei saatu avattua"));
    };
    img.src = url;
  });
}

async function shrink(file, maxSide, quality) {
  let src = null;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await loadImage(file);
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error("Kuvan kokoa ei saatu selville");

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return c.toDataURL("image/jpeg", quality);
}

// Vercel rejects request bodies over 4.5 MB, so the pictures are shrunk until
// they fit a safe share of that. Textbook text stays readable well below the
// first step.
const UPLOAD_BUDGET = 3000000;
const STEPS = [
  [1500, 0.72],
  [1300, 0.68],
  [1100, 0.62],
  [900, 0.55],
  [700, 0.5]
];

async function prepareImages(files, onProgress) {
  const budget = Math.floor(UPLOAD_BUDGET / Math.max(1, files.length));
  const out = [];
  for (let i = 0; i < files.length; i++) {
    if (onProgress) onProgress(i, files.length);
    let best = null;
    for (const [side, q] of STEPS) {
      best = await shrink(files[i], side, q);
      if (best.length <= budget) break;
    }
    out.push(best);
  }
  return out;
}

const megabytes = (chars) => (chars * 0.75) / 1000000;

function NewChapterSheet({ onClose, onCreated }) {
  const [subject, setSubject] = useState("auto");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("photo");
  const [files, setFiles] = useState([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  function addFiles(list) {
    const incoming = Array.from(list || []).filter((f) => /^image\//.test(f.type));
    if (!incoming.length) {
      setStatus("Valitse kuvatiedostoja.");
      return;
    }
    setFiles((prev) => prev.concat(incoming).slice(0, 6));
    setStatus("");
  }

  useEffect(() => {
    function onPaste(e) {
      if (mode !== "photo" || !e.clipboardData) return;
      const imgs = Array.from(e.clipboardData.files || []).filter((f) => /^image\//.test(f.type));
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [mode]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (mode === "photo" && !files.length) {
      setStatus("Valitse ainakin yksi kuva.");
      return;
    }
    if (mode === "text" && !text.trim()) {
      setStatus("Liitä kappaleen teksti ensin.");
      return;
    }
    setBusy(true);
    setStatus(mode === "photo" ? "Valmistellaan kuvia…" : "Claude lukee kappaletta…");
    try {
      let images = [];
      if (mode === "photo") {
        images = await prepareImages(files, (i, n) =>
          setStatus("Valmistellaan kuvia… " + (i + 1) + "/" + n)
        );
        const mb = megabytes(images.reduce((n, d) => n + d.length, 0));
        setStatus("Claude lukee kappaletta (" + mb.toFixed(1) + " Mt)… tämä kestää noin minuutin.");
      }
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: subject === "auto" ? "" : subject, title, text, images })
      });
      const j = await res.json();
      if (!res.ok) {
        setStatus(j.error || "Kappaleen luonti epäonnistui.");
        setBusy(false);
        return;
      }
      const data = j.chapter;
      if (subject !== "auto") data.subject = subject;
      if (title && !data.titleSv) data.titleSv = title;

      setStatus("Tallennetaan…");
      const save = await fetch("/api/chapters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data)
      });
      const sj = await save.json();
      if (!save.ok) {
        setStatus(sj.error || "Tallennus epäonnistui.");
        setBusy(false);
        return;
      }
      onCreated(sj.chapter, j.warning || "");
    } catch (e) {
      const msg = String((e && e.message) || e);
      setStatus(
        /load failed|networkerror|failed to fetch|network request/i.test(msg)
          ? "Kuvien lähetys ei onnistunut. Kokeile vähemmällä määrällä kuvia tai paremmalla yhteydellä."
          : "Jokin meni pieleen. " + msg.slice(0, 120)
      );
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h3>Uusi kappale</h3>
          <button className="btn ghost small" onClick={onClose}>
            Sulje
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor="subject">Oppiaine</label>
            <select id="subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="auto">Tunnista kuvista</option>
              {Object.keys(SUBJECTS).map((k) => (
                <option key={k} value={k}>
                  {SUBJECTS[k].fiOnly ? SUBJECTS[k].fi : SUBJECTS[k].fi + " — " + SUBJECTS[k].sv}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="title">Kappaleen nimi tai numero — valinnainen</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Jätä tyhjäksi, niin nimi ja numero luetaan kuvista"
            />
          </div>

          <div className="seg" role="radiogroup" aria-label="Mistä kappale luodaan">
            <button type="button" role="radio" className="chip" aria-checked={mode === "photo"} onClick={() => setMode("photo")}>
              Kuvat kirjasta
            </button>
            <button type="button" role="radio" className="chip" aria-checked={mode === "text"} onClick={() => setMode("text")}>
              Liitä teksti
            </button>
          </div>

          {mode === "photo" ? (
            <div className="field">
              <label htmlFor="photos">Kuvat kappaleen sivuista</label>
              <div
                className={"drop" + (over ? " over" : "")}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  addFiles(e.dataTransfer.files);
                }}
              >
                <input
                  id="photos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => addFiles(e.target.files)}
                />
                <p className="drop-hint">
                  Valitse tiedostot, ota kuvat puhelimella, vedä ne tähän tai liitä leikepöydältä.
                  Kappaleen numero ja otsikko luetaan kuvista.
                </p>
              </div>
              <div className="thumbs">
                {files.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    className="thumb"
                    title="Poista kuva"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <img alt="" src={URL.createObjectURL(f)} />
                    <span className="x">×</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="ptext">Kappaleen teksti</label>
              <textarea
                id="ptext"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Liitä tähän kappaleen teksti."
              />
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <div className="status">
            {busy ? <span className="dot" /> : null}
            {status}
          </div>
          <button className="btn primary" disabled={busy} onClick={submit}>
            Tee ennakkomateriaali
          </button>
        </div>
      </div>
    </div>
  );
}

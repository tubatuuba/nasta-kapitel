// Matikan tehtävägeneraattori.
//
// Kappale ei tallenna valmiita laskuja vaan MALLEJA: lukualueet, ehdot,
// vastauslauseke, ratkaisun askeleet ja tyypilliset virheet. Sovellus arpoo
// luvut ja laskee oikean vastauksen itse — ei API-kutsua, ei arvailua.
//
// Kaikki laskenta tehdään tarkkoina murtolukuina (osoittaja/nimittäjä), jotta
// 7,20 : 4 on täsmälleen 1,8 eikä 1.7999999999999998. Ei eval(), ei kirjastoja:
// tämä moduuli ajetaan sekä palvelimella (mallien tarkistus tallennettaessa)
// että selaimessa (harjoittelu).

/* ---------------------------------------------------------------- rational */

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

export function rat(n, d = 1) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  // Desimaaliluvut tulevat sisään kokonaislukuina skaalaamalla.
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    const scale = Math.pow(10, Math.max(decimals(n), decimals(d)));
    n = Math.round(n * scale);
    d = Math.round(d * scale);
    if (d === 0) return null;
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function decimals(x) {
  const s = String(x);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(9, s.length - i - 1);
}

const R = {
  add: (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => rat(a.n * b.n, a.d * b.d),
  div: (a, b) => (b.n === 0 ? null : rat(a.n * b.d, a.d * b.n)),
  cmp: (a, b) => {
    const x = a.n * b.d - b.n * a.d;
    return x < 0 ? -1 : x > 0 ? 1 : 0;
  }
};

export const toNumber = (r) => (r ? r.n / r.d : NaN);
export const isWhole = (r) => !!r && r.d === 1;

/* ----------------------------------------------------------------- parser */

// Tavallinen rekursiivinen jäsennin. Tukee peruslaskut, vertailut, ja/tai sekä
// pienen joukon funktioita, jotka riittävät alakoulun matematiikkaan.
function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-zÅÄÖåäö_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9ÅÄÖåäö_]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%(),<>".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null; // tuntematon merkki — malli hylätään
  }
  return out;
}

export function parseExpr(src) {
  const ts = tokenize(src);
  if (!ts || !ts.length) return null;
  let p = 0;
  const peek = () => ts[p];
  const eat = (v) => {
    if (ts[p] && ts[p].t === "op" && ts[p].v === v) {
      p++;
      return true;
    }
    return false;
  };

  function primary() {
    const t = peek();
    if (!t) return null;
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if (eat("(")) {
        const args = [];
        if (!eat(")")) {
          do {
            const a = orExpr();
            if (!a) return null;
            args.push(a);
          } while (eat(","));
          if (!eat(")")) return null;
        }
        return { k: "call", name: t.v, args };
      }
      return { k: "var", name: t.v };
    }
    if (eat("(")) {
      const e = orExpr();
      if (!e || !eat(")")) return null;
      return e;
    }
    if (eat("-")) {
      const e = primary();
      return e && { k: "neg", a: e };
    }
    if (eat("+")) return primary();
    return null;
  }

  function mul() {
    let left = primary();
    if (!left) return null;
    for (;;) {
      let op = null;
      for (const o of ["*", "/", "%"]) if (eat(o)) op = o;
      if (!op) return left;
      const right = primary();
      if (!right) return null;
      left = { k: "bin", op, a: left, b: right };
    }
  }

  function add() {
    let left = mul();
    if (!left) return null;
    for (;;) {
      let op = null;
      for (const o of ["+", "-"]) if (eat(o)) op = o;
      if (!op) return left;
      const right = mul();
      if (!right) return null;
      left = { k: "bin", op, a: left, b: right };
    }
  }

  function cmp() {
    const left = add();
    if (!left) return null;
    for (const o of ["==", "!=", "<=", ">=", "<", ">"]) {
      if (eat(o)) {
        const right = add();
        return right && { k: "bin", op: o, a: left, b: right };
      }
    }
    return left;
  }

  function andExpr() {
    let left = cmp();
    if (!left) return null;
    while (eat("&&")) {
      const right = cmp();
      if (!right) return null;
      left = { k: "bin", op: "&&", a: left, b: right };
    }
    return left;
  }

  function orExpr() {
    let left = andExpr();
    if (!left) return null;
    while (eat("||")) {
      const right = andExpr();
      if (!right) return null;
      left = { k: "bin", op: "||", a: left, b: right };
    }
    return left;
  }

  const out = orExpr();
  return out && p === ts.length ? out : null;
}

const FUNCS = {
  abs: (a) => rat(Math.abs(a.n), a.d),
  floor: (a) => rat(Math.floor(a.n / a.d)),
  ceil: (a) => rat(Math.ceil(a.n / a.d)),
  round: (a) => rat(Math.round(a.n / a.d)),
  sqrt: (a) => {
    const v = Math.sqrt(a.n / a.d);
    return Number.isFinite(v) ? rat(Math.round(v * 1e6) / 1e6) : null;
  },
  min: (a, b) => (R.cmp(a, b) <= 0 ? a : b),
  max: (a, b) => (R.cmp(a, b) >= 0 ? a : b),
  gcd: (a, b) => (isWhole(a) && isWhole(b) ? rat(gcd(a.n, b.n)) : null)
};

export function evalNode(node, vars) {
  if (!node) return null;
  if (node.k === "num") return rat(node.v);
  if (node.k === "var") {
    const v = vars[node.name];
    if (v === undefined) return null;
    return typeof v === "object" && v && "n" in v ? v : rat(v);
  }
  if (node.k === "neg") {
    const a = evalNode(node.a, vars);
    return a && rat(-a.n, a.d);
  }
  if (node.k === "call") {
    const f = FUNCS[node.name];
    if (!f) return null;
    const args = node.args.map((a) => evalNode(a, vars));
    if (args.some((a) => !a)) return null;
    return f(...args);
  }
  const a = evalNode(node.a, vars);
  const b = evalNode(node.b, vars);
  if (!a || !b) return null;
  switch (node.op) {
    case "+":
      return R.add(a, b);
    case "-":
      return R.sub(a, b);
    case "*":
      return R.mul(a, b);
    case "/":
      return R.div(a, b);
    case "%": {
      if (!isWhole(a) || !isWhole(b) || b.n === 0) return null;
      return rat(((a.n % b.n) + b.n) % b.n);
    }
    case "==":
      return rat(R.cmp(a, b) === 0 ? 1 : 0);
    case "!=":
      return rat(R.cmp(a, b) !== 0 ? 1 : 0);
    case "<":
      return rat(R.cmp(a, b) < 0 ? 1 : 0);
    case "<=":
      return rat(R.cmp(a, b) <= 0 ? 1 : 0);
    case ">":
      return rat(R.cmp(a, b) > 0 ? 1 : 0);
    case ">=":
      return rat(R.cmp(a, b) >= 0 ? 1 : 0);
    case "&&":
      return rat(a.n !== 0 && b.n !== 0 ? 1 : 0);
    case "||":
      return rat(a.n !== 0 || b.n !== 0 ? 1 : 0);
    default:
      return null;
  }
}

const cache = new Map();
export function evalExpr(src, vars) {
  const key = String(src);
  if (!cache.has(key)) cache.set(key, parseExpr(key));
  return evalNode(cache.get(key), vars);
}

/* ---------------------------------------------------------------- muotoilu */

// Suomalainen (ja ruotsalainen) desimaalierotin on pilkku. Tuhaterotinta ei
// käytetä: 1250 on luettavampi kuin 1 250 kapeassa tehtäväruudussa.
export function formatValue(r, format) {
  if (!r) return "";
  const f = String(format || "auto");
  if (f === "murtoluku" || f === "sievennetty") {
    if (r.d === 1) return String(r.n);
    return r.n + "/" + r.d;
  }
  if (f === "kokonaisluku") return String(Math.round(toNumber(r)));
  const dec = f === "desimaali1" ? 1 : f === "desimaali2" ? 2 : null;
  if (dec !== null) return toNumber(r).toFixed(dec).replace(".", ",");
  if (r.d === 1) return String(r.n);
  // auto: näytä lyhimmällä tarkkuudella joka on tarkka, korkeintaan 4 desimaalia
  for (let k = 1; k <= 4; k++) {
    const s = toNumber(r).toFixed(k);
    if (Math.abs(parseFloat(s) - toNumber(r)) < 1e-9) return s.replace(".", ",");
  }
  return toNumber(r).toFixed(2).replace(".", ",");
}

// "{kg} kg äpplen kostar {hinta/100} €" → luvut paikoilleen.
// Paikan voi muotoilla: {hinta/100:desimaali2} antaa "7,20" eikä "7,2".
// Sanalliset muuttujat (nimet, esineet) menevät läpi sellaisenaan.
export function fill(template, vars) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (m, body) => {
    const parts = String(body).split(":");
    const expr = parts[0].trim();
    const fmt = (parts[1] || "auto").trim();
    const direct = vars ? vars[expr] : undefined;
    if (typeof direct === "string") return direct;
    const v = evalExpr(expr, vars);
    return v ? formatValue(v, fmt) : m;
  });
}

/* --------------------------------------------------------------- arvonta */

function pick(range, rnd) {
  if (Array.isArray(range)) {
    if (range.length === 2 && range.every((x) => typeof x === "number")) {
      const [lo, hi] = range;
      return Math.floor(rnd() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo);
    }
    return range[Math.floor(rnd() * range.length)];
  }
  return range;
}

// Arpoo yhden tehtävän mallista. Ehdot testataan arvonnan jälkeen ja arpa
// heitetään uudelleen — yksinkertaista ja riittävän nopeaa näillä lukualueilla.
export function makeTask(model, rnd = Math.random) {
  if (!model || !model.answer) return null;
  const names = Object.keys(model.vars || {});
  for (let tries = 0; tries < 400; tries++) {
    const vars = {};
    let ok = true;
    for (const name of names) {
      const v = pick(model.vars[name], rnd);
      if (typeof v === "number") vars[name] = v;
      else {
        // sanalliset listat (nimet, esineet) pidetään erillään laskennasta
        vars[name] = v;
      }
    }
    const numeric = {};
    for (const k of Object.keys(vars)) if (typeof vars[k] === "number") numeric[k] = vars[k];
    for (const cond of model.conds || []) {
      const r = evalExpr(cond, numeric);
      if (!r || r.n === 0) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const answer = evalExpr(model.answer, numeric);
    if (!answer) continue;
    numeric.vastaus = answer;
    const text = { ...vars, ...numeric };
    return {
      id: model.id,
      vars: text,
      numeric,
      answer,
      answerText: formatValue(answer, model.format),
      format: model.format || "auto",
      unit: model.unit || "",
      sv: fill(model.sv, text),
      fi: fill(model.fi, text),
      steps: (model.steps || []).map((s) => fill(s, text)),
      traps: (model.traps || []).map((t) => ({ when: t.when, why: t.why }))
    };
  }
  return null;
}

/* ------------------------------------------------------------- tarkistus */

// 12,5 · 12.5 · 12,50 · " 12,5 " · −12,5 ovat kaikki sama vastaus.
export function parseAnswer(input) {
  let s = String(input == null ? "" : input).trim();
  if (!s) return null;
  s = s.replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(/€|kg|cm|mm|km|m²|m|st|kpl/gi, "");
  s = s.replace(",", ".");
  const frac = s.match(/^(-?\d+)\/(\d+)$/);
  if (frac) return { value: rat(parseInt(frac[1], 10), parseInt(frac[2], 10)), raw: "frac" };
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return { value: rat(parseFloat(s)), raw: s.includes(".") ? "dec" : "int" };
}

// Palauttaa: correct | format | wrong | empty.
// "format" tarkoittaa että arvo on oikein mutta muoto ei — se sanotaan
// ääneen eikä merkitä pelkäksi virheeksi.
export function checkAnswer(input, task) {
  const got = parseAnswer(input);
  if (!got || !got.value) return { verdict: String(input || "").trim() ? "wrong" : "empty", got: null };
  const same = R.cmp(got.value, task.answer) === 0;
  if (!same) return { verdict: "wrong", got: got.value };
  if (task.format === "sievennetty" && got.raw === "frac") {
    const g = got.value;
    const typed = String(input).replace(/\s/g, "").match(/^(-?\d+)\/(\d+)$/);
    if (typed && Math.abs(parseInt(typed[2], 10)) !== g.d) {
      return { verdict: "format", got: got.value, why: "Arvo on oikein, mutta murtolukua ei ole sievennetty." };
    }
  }
  if (task.format === "murtoluku" && got.raw === "dec" && task.answer.d !== 1) {
    return { verdict: "format", got: got.value, why: "Vastaus pyydettiin murtolukuna." };
  }
  return { verdict: "correct", got: got.value };
}

// Virhe nimetään, ei vain merkitä. Ensin mallin omat ansat, sitten yleiset.
export function diagnose(got, task) {
  if (!got) return "";
  for (const t of task.traps || []) {
    const v = evalExpr(t.when, task.numeric);
    if (v && R.cmp(v, got) === 0) return t.why;
  }
  const a = toNumber(task.answer);
  const g = toNumber(got);
  if (a !== 0) {
    const ratio = g / a;
    if (Math.abs(ratio - 10) < 1e-6 || Math.abs(ratio - 0.1) < 1e-6)
      return "Pilkku meni yhden pykälän väärään suuntaan.";
    if (Math.abs(ratio - 100) < 1e-6 || Math.abs(ratio - 0.01) < 1e-6)
      return "Pilkku meni kahden pykälän verran väärään suuntaan.";
  }
  const ai = String(Math.abs(Math.round(a)));
  const gi = String(Math.abs(Math.round(g)));
  if (ai.length === gi.length && ai !== gi) {
    if (ai.split("").sort().join("") === gi.split("").sort().join(""))
      return "Numerot ovat oikeat mutta väärässä järjestyksessä.";
    let diff = 0;
    for (let i = 0; i < ai.length; i++) if (ai[i] !== gi[i]) diff++;
    if (diff === 1 && ai[ai.length - 1] !== gi[gi.length - 1])
      return "Vain viimeinen numero on pielessä — tarkista muistinumero.";
  }
  if (Math.abs(g - a) === 1) return "Vastaus on yhden pielessä — laske viimeinen askel uudelleen.";
  return "";
}

/* ------------------------------------------------------------ tarkastus */

// Väärin laskeva harjoitus on pahempi kuin ei harjoitusta lainkaan, joten
// jokainen malli koeajetaan ennen tallennusta: viisi arvontaa, ja jokaisesta
// pitää syntyä laskettava vastaus ja täydellinen tehtäväteksti.
export function validateModel(model) {
  if (!model || !model.id || !model.sv || !model.answer) return false;
  if (!parseExpr(model.answer)) return false;
  for (const c of model.conds || []) if (!parseExpr(c)) return false;
  for (const t of model.traps || []) if (!t.when || !parseExpr(t.when)) return false;
  for (let i = 0; i < 5; i++) {
    const t = makeTask(model);
    if (!t) return false;
    if (!Number.isFinite(toNumber(t.answer))) return false;
    if (/\{[^{}]+\}/.test(t.sv)) return false; // täyttämättä jäänyt paikka
    if (t.fi && /\{[^{}]+\}/.test(t.fi)) return false;
    if (t.steps.some((s) => /\{[^{}]+\}/.test(s))) return false;
  }
  return true;
}

export function validateModels(models) {
  const good = [];
  for (const m of models || []) if (validateModel(m)) good.push(m);
  return good;
}

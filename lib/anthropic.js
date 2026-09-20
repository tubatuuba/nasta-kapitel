const API = "https://api.anthropic.com/v1";

let cachedModel = null;

export function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY || "",
    "anthropic-version": "2023-06-01"
  };
}

// The model id is not hardcoded: an explicit env var wins, otherwise the
// newest Sonnet the account can see is used.
export async function resolveModel() {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch(API + "/models?limit=50", { headers: headers() });
    if (res.ok) {
      const json = await res.json();
      const ids = (json.data || []).map((m) => m.id);
      cachedModel =
        ids.find((id) => id.includes("sonnet")) ||
        ids.find((id) => id.includes("opus")) ||
        ids[0] ||
        null;
    }
  } catch {
    /* fall through */
  }
  return cachedModel || "claude-sonnet-4-5";
}

export async function ask({ blocks, maxTokens = 3000 }) {
  if (!anthropicConfigured()) {
    const err = new Error("ANTHROPIC_API_KEY puuttuu");
    err.code = "no_key";
    throw err;
  }
  const model = await resolveModel();
  const res = await fetch(API + "/messages", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: blocks }]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error("Anthropic " + res.status + ": " + body.slice(0, 400));
    err.code = res.status === 401 ? "bad_key" : "upstream";
    throw err;
  }
  const json = await res.json();
  const text = (json.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  // A long chapter can run past max_tokens. The caller needs to know, because
  // the JSON is then cut off mid-word rather than malformed.
  return { text, truncated: json.stop_reason === "max_tokens" };
}

// Rescue a JSON object that was cut off mid-way: walk it once, remember the
// last point where a complete VALUE ended, cut there and close the brackets
// that were still open. A chapter that lost its last two words is far more
// useful to the student than an error message.
function salvage(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const s = text.slice(start);

  const open = [];
  let inStr = false;
  let esc = false;
  let cut = -1;
  let closers = null;

  const mark = (i) => {
    cut = i;
    closers = open.slice().reverse().join("");
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') {
        inStr = false;
        // A string followed by ":" is a key, not a value — not a safe cut.
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] !== ":" && open.length) mark(i);
      }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") open.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      open.pop();
      if (open.length) mark(i);
    }
  }

  if (cut < 0) return null;
  try {
    return JSON.parse(s.slice(0, cut + 1) + closers);
  } catch {
    return null;
  }
}

export function parseJson(text) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let out = tryParse(text);
  if (out) return out;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    out = tryParse(fence[1].trim());
    if (out) return out;
  }
  const first = Math.min(
    ...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0).concat([Infinity])
  );
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (first !== Infinity && last > first) {
    out = tryParse(text.slice(first, last + 1));
    if (out) return out;
  }
  out = salvage(text);
  if (out) return out;

  const err = new Error("Vastauksesta ei löytynyt JSON-oliota");
  err.code = "invalid_json";
  err.sample = String(text || "").slice(0, 300);
  throw err;
}

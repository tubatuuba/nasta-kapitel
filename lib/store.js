import { put, list, del, get } from "@vercel/blob";

// Everything is stored PRIVATE: blobs have no publicly reachable URL and are
// only ever read server-side, behind the PIN.
//
// Chapter content and study progress live in separate blobs on purpose.
// Content is written once when the chapter is created; progress is written
// every time a word is answered, so it is kept small (a few hundred bytes)
// instead of rewriting the whole chapter each time.
const CH = "chapters/";
const PR = "progress/";

export function blobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readJson(pathname) {
  try {
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    const text = await new Response(res.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

// Chapters read in the order they are taught: "Kapitel 5" before "Kapitel 6",
// whatever order they happened to be added in. Chapters without a number sort
// last, oldest first.
function chapterOrder(c) {
  const m = String(c.chapterNo || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

// Two different books can both have a chapter 4, so subjects are kept together
// and the teaching order applies inside each subject.
const SUBJECT_RANK = ["omg", "hist", "matte", "aidinkieli", "uskonto", "annat"];
function subjectRank(c) {
  const i = SUBJECT_RANK.indexOf(String((c && c.subject) || "annat"));
  return i < 0 ? SUBJECT_RANK.length : i;
}

export async function listChapters() {
  if (!blobConfigured()) return [];
  const { blobs } = await list({ prefix: CH, limit: 500 });
  const ids = blobs.map((b) => b.pathname.slice(CH.length).replace(/\.json$/, "")).filter(Boolean);
  const out = await Promise.all(
    ids.map(async (id) => {
      const [content, progress] = await Promise.all([readJson(CH + id + ".json"), readJson(PR + id + ".json")]);
      if (!content) return null;
      return {
        ...content,
        id,
        known: (progress && progress.known) || {},
        answers: (progress && progress.answers) || {}
      };
    })
  );
  return out
    .filter(Boolean)
    .sort(
      (a, b) =>
        subjectRank(a) - subjectRank(b) ||
        chapterOrder(a) - chapterOrder(b) ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );
}

export async function getChapter(id) {
  const content = await readJson(CH + id + ".json");
  return content ? { ...content, id } : null;
}

export async function saveChapter(id, data) {
  const body = { ...data };
  delete body.id;
  delete body.known;
  delete body.answers;
  await writeJson(CH + id + ".json", body);
  return { ...body, id, known: {}, answers: {} };
}

export async function getProgress(id) {
  return (await readJson(PR + id + ".json")) || { known: {}, answers: {} };
}

export async function saveProgress(id, progress) {
  await writeJson(PR + id + ".json", {
    known: progress.known || {},
    answers: progress.answers || {}
  });
}

export async function chapterExists(id) {
  return !!(await readJson(CH + id + ".json"));
}

export async function deleteChapter(id) {
  for (const p of [CH + id + ".json", PR + id + ".json"]) {
    try {
      await del(p);
    } catch {
      /* already gone */
    }
  }
}

export function newId(titleSv) {
  const slug =
    String(titleSv || "kapitel")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "kapitel";
  return slug + "-" + Math.random().toString(36).slice(2, 7);
}

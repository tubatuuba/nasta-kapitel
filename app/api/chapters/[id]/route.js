import { NextResponse } from "next/server";
import { COOKIE, verifyToken } from "../../../../lib/auth";
import { chapterExists, getProgress, saveProgress, deleteChapter } from "../../../../lib/store";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen
export const dynamic = "force-dynamic";

function guard(request) {
  return verifyToken(request.cookies.get(COOKIE)?.value);
}

// Only study progress is written here — never the chapter content — so a
// single answered word costs one small write instead of rewriting the chapter.
export async function PATCH(request, { params }) {
  if (!guard(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await chapterExists(id))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const patch = (await request.json()) || {};
  const current = await getProgress(id);
  const next = {
    known: patch.known && typeof patch.known === "object" ? patch.known : current.known,
    answers: patch.answers && typeof patch.answers === "object" ? patch.answers : current.answers
  };
  await saveProgress(id, next);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  if (!guard(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteChapter(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { COOKIE, makeToken, pinMatches } from "../../../lib/auth";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen

export async function POST(request) {
  if (!process.env.FAMILY_PIN) {
    return NextResponse.json(
      { error: "PIN-koodia ei ole asetettu. Lisää FAMILY_PIN Vercelin ympäristömuuttujiin." },
      { status: 500 }
    );
  }
  let pin = "";
  try {
    const body = await request.json();
    pin = String(body.pin || "");
  } catch {
    /* ignore */
  }
  if (!pinMatches(pin)) {
    return NextResponse.json({ error: "Väärä koodi." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
  return res;
}

import { NextResponse } from "next/server";
import { COOKIE } from "../../../lib/auth";

export const runtime = "nodejs";
export const preferredRegion = "arn1"; // Tukholma: lähin alue Suomeen

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

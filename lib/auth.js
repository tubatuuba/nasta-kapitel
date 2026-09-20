import crypto from "crypto";

export const COOKIE = "nk_auth";

function secret() {
  return process.env.AUTH_SECRET || process.env.FAMILY_PIN || "nasta-kapitel-dev";
}

export function makeToken() {
  const payload = String(Date.now());
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
  return payload + "." + sig;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function pinMatches(pin) {
  const real = process.env.FAMILY_PIN;
  if (!real) return false;
  const a = Buffer.from(String(pin || ""));
  const b = Buffer.from(real);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

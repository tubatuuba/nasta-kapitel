"use client";

import { useState } from "react";

export default function Login() {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin })
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "Väärä koodi.");
    } catch {
      setErr("Yhteys ei toiminut. Kokeile uudelleen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <h1>
          Nästa <span className="k">kapitel</span>
        </h1>
        <p>Syötä perheen koodi. Se jää muistiin tähän selaimeen.</p>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="••••"
          autoFocus
        />
        <div className="err">{err}</div>
        <button className="btn primary" type="submit" disabled={busy || !pin}>
          {busy ? "Tarkistetaan…" : "Sisään"}
        </button>
      </form>
    </div>
  );
}

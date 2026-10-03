// Checking a certified draw from scratch, the same math as the proof page
// (namewheel.org/v/CODE) and the open source verifier
// (github.com/namewheel/truespin-verifier): nothing is taken on trust from
// the record except the values it publishes.
import { createHash, createHmac, createPublicKey, verify as edVerify } from "node:crypto";
import { publicDraw, drawKey, type PublicDraw } from "./nw.js";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Every entry once, or several times for an entry written "Name:3" (as on the website). */
export function tickets(entries: string[]): number[] {
  const t: number[] = [];
  entries.forEach((e, i) => {
    const m = /:(\d+)$/.exec(e);
    const w = m ? Math.max(1, Math.min(99, parseInt(m[1], 10))) : 1;
    for (let k = 0; k < w; k++) t.push(i);
  });
  return t;
}
export const stripWeight = (name: string) => String(name).replace(/:(\d+)$/, "");

export interface Check { name: string; ok: boolean; detail: string }
export interface Verified { draw: PublicDraw; checks: Check[]; genuine: boolean; winner: string | null }

export async function verifyDraw(code: string, ip?: string): Promise<Verified> {
  const d = await publicDraw(code, ip);
  const checks: Check[] = [];
  const revealed = !!d.serverSeed;

  const eh = sha256(JSON.stringify(d.entries));
  checks.push({ name: "Entry list", ok: eh === d.entriesHash, detail: eh === d.entriesHash ? `All ${d.entries.length} entries match the fingerprint sealed in the record.` : "The entry list does not match its fingerprint." });

  if (!revealed) {
    checks.push({ name: "Sealed secret", ok: false, detail: "This draw was started but never finished, so its secret was never revealed and it has no winner." });
  } else {
    const commitOk = sha256(d.serverSeed!) === d.commit;
    checks.push({ name: "Sealed before the spin", ok: commitOk, detail: commitOk ? "The secret revealed after the spin matches the commitment published before it." : "The revealed secret does not match the commitment." });

    const h = createHmac("sha256", Buffer.from(d.serverSeed!, "hex")).update(`${d.clientEntropy}|${d.entriesHash}`).digest();
    const t = tickets(d.entries);
    const idx = t[Number(BigInt("0x" + h.subarray(0, 8).toString("hex")) % BigInt(t.length))];
    const recomputed = stripWeight(d.entries[idx]);
    const winOk = idx === d.winnerIndex && recomputed === d.winner;
    checks.push({ name: "Winner recomputed", ok: winOk, detail: winOk ? `Recomputing the draw from the secret, the added randomness and the entries lands on ${recomputed}, the published winner.` : `Recomputing lands on ${recomputed}, not on the published winner.` });

    if (d.signature) {
      let sigOk = false;
      try {
        const canonical = [d.code, d.title, d.entriesHash, d.commit, d.serverSeed, d.clientEntropy, d.winner, String(d.winnerIndex), String(d.seq), d.createdAt].join("\n");
        sigOk = edVerify(null, Buffer.from(canonical, "utf8"), createPublicKey(await drawKey()), Buffer.from(d.signature, "base64"));
      } catch { sigOk = false; }
      checks.push({ name: "NameWheel signature", ok: sigOk, detail: sigOk ? "The record carries a valid Ed25519 signature from NameWheel's published key, so nothing in it changed after the draw." : "The signature does not match the record." });
    }
  }
  return { draw: d, checks, genuine: revealed && checks.every((c) => c.ok), winner: revealed ? d.winner : null };
}

/** A draw or frozen list code from a code, a /v/ or /f/ link, or "NW-CODE". */
export function parseCode(input: string): { code: string; kind: "draw" | "freeze" | "unknown" } | null {
  const s = String(input || "").trim();
  const link = /namewheel\.org\/(v|f)\/([A-Za-z0-9]{4,12})/i.exec(s);
  if (link) return { code: link[2].toUpperCase(), kind: link[1].toLowerCase() === "f" ? "freeze" : "draw" };
  const bare = /^(?:NW-)?([A-Za-z0-9]{4,12})$/i.exec(s);
  return bare ? { code: bare[1].toUpperCase(), kind: "unknown" } : null;
}

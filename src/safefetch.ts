// Fetching a URL a client gave us (an OAuth Client ID Metadata Document),
// without letting it reach this machine or its network: https only, every
// address the name resolves to must be public, each redirect is checked the
// same way, and the body is read with a size cap.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchRefused extends Error {}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
function privateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return privateV4(mapped[1]);
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
}
const isPrivate = (ip: string) => (isIP(ip) === 4 ? privateV4(ip) : privateV6(ip));

async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchRefused("Not a full https URL."); }
  if (u.protocol !== "https:") throw new FetchRefused("Only public https addresses.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new FetchRefused("Only public https addresses.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new FetchRefused(`Could not find ${host}.`); });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new FetchRefused("Only public https addresses.");
  return u;
}

/** GET a public https URL; follows up to three redirects, each one checked. */
export async function safeFetch(raw: string, maxBytes: number, timeoutMs = 10_000): Promise<{ buf: Buffer; url: URL }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let u = await checkUrl(raw);
    for (let hop = 0; ; hop++) {
      const r = await fetch(u, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "NameWheel-MCP/1 (+https://namewheel.org/mcp)", Accept: "application/json" } })
        .catch(() => { throw new FetchRefused(`Could not reach ${u.hostname}.`); });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        if (hop >= 3) throw new FetchRefused("Too many redirects.");
        u = await checkUrl(new URL(r.headers.get("location")!, u).toString());
        continue;
      }
      if (!r.ok) throw new FetchRefused(`Fetch failed (${r.status}).`);
      if (Number(r.headers.get("content-length") || 0) > maxBytes) throw new FetchRefused("Too large.");
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
        size += c.length;
        if (size > maxBytes) { ctrl.abort(); throw new FetchRefused("Too large."); }
        chunks.push(Buffer.from(c));
      }
      return { buf: Buffer.concat(chunks), url: u };
    }
  } finally { clearTimeout(timer); }
}

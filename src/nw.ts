// The NameWheel API, as this server uses it. On mcp.namewheel.org it is the
// API process on the same machine; in local mode (stdio.ts) the public site.
// A person's API key (nw_live_...) reaches only the plan, certified draws,
// freezing a list and their own draws: the API refuses everything else.
import { CONFIG } from "./config.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: unknown) { super(`${status} ${code}`); }
}

interface CallOpts { method?: string; body?: unknown; key?: string; ip?: string }

async function call<T>(path: string, o: CallOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "X-NW-Client": "mcp", "User-Agent": "NameWheel-MCP/1" };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.key) headers.Authorization = `Bearer ${o.key}`;
  // The API meters by address: pass the caller's on, so one person cannot use up everyone's share.
  if (o.ip && !CONFIG.local) headers["X-Forwarded-For"] = o.ip;
  let res: Response;
  try {
    res = await fetch(`${CONFIG.apiUrl}${path}`, { method: o.method || "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ApiError(503, "unreachable", String((e as Error)?.message || e));
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const code = (data && typeof data === "object" && "error" in data) ? String((data as { error: unknown }).error) : `http_${res.status}`;
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

export interface Me { user: { id: string; email: string } | null; pro: boolean; plan: string | null; premium_until?: string | null; account_status?: string }
export interface StartedDraw { code: string; commit: string; seq: number; winnerIndex: number; winner: string; verifyUrl: string }
export interface FinishedDraw { code: string; serverSeed: string; signature: string; verifyUrl: string }
export interface Frozen { code: string; entriesHash: string; createdAt: string; url: string }
export interface PublicDraw {
  code: string; title: string; entries: string[]; entriesHash: string; mode: string; commit: string;
  serverSeed: string | null; clientEntropy: string; winner: string | null; winnerIndex: number | null;
  seq: number; status: string; signature: string | null; protocol: number;
  attempts: { total: number; published: number; abandoned: number } | null;
  videoHash: string | null; videoDuration: number | null; createdAt: string; revealedAt: string | null;
}
export interface PublicFreeze {
  code: string; title: string; entries: string[]; entriesHash: string; frozenAt: string; status: string;
  drawnBy: { code: string; winner: string; createdAt: string; verifyUrl: string } | null;
}
export interface MyDraw { code: string; title: string; status: string; winner: string | null; entries_count: number; created_at: string; hidden: boolean; paid: boolean; certificate_paid: boolean }

export const me = (key: string, ip?: string) => call<Me>("/api/auth/me", { key, ip });
export const startDraw = (key: string, ip: string, body: { title: string; entries: string[]; clientEntropy: string }) =>
  call<StartedDraw>("/api/draw/start", { method: "POST", key, ip, body });
export const finishDraw = (key: string, ip: string, code: string) => call<FinishedDraw>("/api/draw/finish", { method: "POST", key, ip, body: { code } });
export const freeze = (key: string, ip: string, body: { title: string; entries: string[] }) => call<Frozen>("/api/freeze", { method: "POST", key, ip, body });
export const myDraws = (key: string, ip: string, limit: number, frozen = false) =>
  call<{ rows: MyDraw[]; total: number }>(`/api/me/draws?limit=${limit}${frozen ? "&kind=frozen" : ""}`, { key, ip });
export const publicDraw = (code: string, ip?: string) => call<PublicDraw>(`/api/draw/${encodeURIComponent(code)}`, { ip });
export const publicFreeze = (code: string, ip?: string) => call<PublicFreeze>(`/api/freeze/${encodeURIComponent(code)}`, { ip });

let pem: { text: string; at: number } | null = null;
/** NameWheel's published Ed25519 key that signs every draw record. */
export async function drawKey(): Promise<string> {
  if (pem && Date.now() - pem.at < 3_600_000) return pem.text;
  const r = await fetch(`${CONFIG.apiUrl}/api/draw-key`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ApiError(r.status, "no_key", null);
  pem = { text: await r.text(), at: Date.now() };
  return pem.text;
}

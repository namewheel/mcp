// The tools. Descriptions are written for the model that reads them: what
// the tool does, when to use it, and what the person should know.
import { z } from "zod";
import { randomInt, randomBytes, createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CONFIG } from "./config.js";
import { store } from "./store.js";
import { meterId } from "./limits.js";
import * as nw from "./nw.js";
import { ApiError } from "./nw.js";
import { verifyDraw, parseCode } from "./verify.js";
import { WIDGET_URI } from "./widget.js";

export interface Caller {
  kind: "anon" | "key";
  apiKey?: string;
  plan?: string;
  ip: string;
  userAgent: string;
  /** Set when the call comes from claude.ai's or ChatGPT's servers: guests there cannot be told apart. */
  platform?: "claude" | "chatgpt" | null;
}

/** Tools that need an account. Calls without one get a 401 before the SDK runs (index.ts), so the client shows Connect. */
export const PROTECTED_TOOLS = new Set(["certified_draw", "freeze_list", "my_draws"]);

const SITE = CONFIG.siteUrl;
const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }], isError: true });
/** ChatGPT's plugin rules: a plain reason and an informational link, no plan lists or upgrade nudges. */
export const inChatGPT = (c: Caller) => c.platform === "chatgpt" || /openai-mcp/i.test(c.userAgent);

// ── Guest meter ───────────────────────────────────────────────────────────
const meterKey = (c: Caller) => c.platform ? `platform:${c.platform}` : meterId(c.ip);
const PLATFORM = { claude: "Claude", chatgpt: "ChatGPT" } as const;

/** A platform's shared guest allowance is spent for today: the next call should ask the person to connect. */
export function platformSpent(c: Caller): boolean {
  if (!c.platform || c.kind !== "anon") return false;
  const m = store.get().anon[meterKey(c)]; const cut = Date.now() - 86_400_000;
  return !!m && m.calls.filter((t) => t > cut).length >= CONFIG.anon.platformPerDay;
}

function anonGate(c: Caller): string | null {
  // Local mode runs on the person's own machine: nothing to protect.
  if (c.kind === "key" || CONFIG.local) return null;
  const a = CONFIG.anon; const s = store.get();
  const m = (s.anon[meterKey(c)] ||= { calls: [] });
  const now = Date.now();
  m.calls = m.calls.filter((t) => t > now - 86_400_000);
  const perMin = c.platform ? a.platformPerMinute : a.perMinute;
  const perDay = c.platform ? a.platformPerDay : a.perDay;
  if (m.calls.filter((t) => t > now - 60_000).length >= perMin) return `Without an account, this connection can spin ${perMin} times a minute. Wait a moment and try again.`;
  if (m.calls.length >= perDay) {
    return c.platform
      ? `Spins without an account are used up for today on ${PLATFORM[c.platform]}. Connect a free NameWheel account to keep going: ${SITE}/mcp`
      : `Without an account, this connection can spin ${perDay} times a day. Connect a free NameWheel account to keep going: ${SITE}/mcp`;
  }
  m.calls.push(now); store.touch();
  return null;
}

// ── Entries ───────────────────────────────────────────────────────────────
const entriesSchema = z.array(z.string()).min(2).max(CONFIG.maxEntries)
  .describe("The names or options, one per item, exactly as the person gave them. Repeating a name gives it another slot (another chance), as on the NameWheel website.");
const titleSchema = z.string().max(80).optional().describe("A short title for the wheel, such as 'Period 3 cold call' or 'Who presents first'.");

function cleanEntries(list: string[]): string[] {
  return list.map((e) => String(e).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean).slice(0, CONFIG.maxEntries);
}
const cleanTitle = (t: string | undefined, d: string) => String(t || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || d;

/** A namewheel.org link that opens the wheel with these names loaded, or null when the list is too long for a link. */
export function wheelLink(entries: string[]): string | null {
  const names = entries.map((e) => e.replace(/,/g, " ").trim()).filter(Boolean);
  const url = `${SITE}/?ref=mcp#names=${encodeURIComponent(names.join(","))}`;
  return names.length <= 300 && url.length <= 6000 ? url : null;
}

const ui = (invoking: string, invoked: string) => ({
  ui: { resourceUri: WIDGET_URI },
  "openai/outputTemplate": WIDGET_URI,
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

function apiErrorText(e: unknown, c: Caller): string {
  if (e instanceof ApiError) {
    if (e.code === "invalid_api_key" || e.status === 401) return `NameWheel did not accept the key behind this connection: it may have been deleted. Make a new one at ${SITE}/mcp#key and connect again.`;
    if (e.code === "daily_cap") return "This account has run 20 certified draws in the last 24 hours, the most NameWheel allows in a day. Try again later.";
    if (e.code === "account_suspended" || e.code === "account_banned") return `This NameWheel account is ${e.code === "account_banned" ? "closed" : "paused"}, so it cannot run draws. Questions: info@namewheel.org`;
    if (e.code === "need_entries") return "A draw needs at least two entries.";
    if (e.code === "rate_limited" || e.status === 429) return "NameWheel is getting too many requests from this connection. Wait a minute and try again.";
    if (e.code === "not_found") return "NameWheel has no draw with that code.";
    if (e.code === "removed") return "That draw was taken down by its host or by NameWheel.";
    if (e.status >= 500 || e.code === "unreachable") return "NameWheel could not finish this just now. Try again in a moment.";
    return `NameWheel did not accept the request (${e.code}).`;
  }
  void c;
  return `Something failed on the NameWheel side: ${(e as Error)?.message || e}. Try again.`;
}

const pick = (n: number) => randomInt(0, n);

export function registerTools(server: McpServer, caller: Caller): void {
  // ── spin_wheel ────────────────────────────────────────────────────────
  server.registerTool("spin_wheel", {
    title: "Spin the wheel",
    description: "Pick one or more winners at random from a list of names or options, and show the wheel spinning to the result in the chat. Use it whenever the person wants something chosen at random: a student to answer, who goes first, where to eat, a raffle winner among friends. Works without an account. The pick is fair (a cryptographic random number generator), but it is not a certified record; when other people need to be able to check the result later, use certified_draw instead.",
    inputSchema: {
      entries: entriesSchema,
      title: titleSchema,
      winners: z.number().int().min(1).max(50).optional().describe("How many winners to pick. Default 1."),
      allow_repeat_winners: z.boolean().optional().describe("With more than one winner, may the same entry win twice? Default false: each winner leaves the wheel."),
    },
    annotations: { title: "Spin the wheel", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: ui("Spinning the wheel", "The wheel stopped"),
  }, async ({ entries, title, winners, allow_repeat_winners }) => {
    const gate = anonGate(caller); if (gate) return fail(gate);
    const list = cleanEntries(entries);
    if (list.length < 2) return fail("The wheel needs at least two entries.");
    const n = Math.min(winners || 1, allow_repeat_winners ? 50 : list.length);
    const pool = list.map((_, i) => i);
    const picked: { name: string; index: number }[] = [];
    for (let k = 0; k < n; k++) {
      const at = pick(pool.length);
      const index = pool[at];
      picked.push({ name: list[index], index });
      if (!allow_repeat_winners) pool.splice(at, 1);
    }
    const t = cleanTitle(title, "Wheel spin");
    const link = wheelLink(list);
    const lines = picked.length === 1
      ? `Winner: ${picked[0].name}`
      : `Winners, in order: ${picked.map((p, i) => `${i + 1}. ${p.name}`).join("  ")}`;
    return {
      content: [{ type: "text", text: `${lines}\nPicked at random from ${list.length} entries by NameWheel (${t}). This is a fair pick, not a certified record; for a result others can check later, run certified_draw.${link ? `\nOpen this wheel on NameWheel: ${link}` : ""}` }],
      structuredContent: { kind: "spin", title: t, entries: list, winners: picked, certified: false, openUrl: link || SITE },
    };
  });

  // ── make_teams ────────────────────────────────────────────────────────
  server.registerTool("make_teams", {
    title: "Split into random teams",
    description: "Split a list of names into random teams or groups of even size, and show them as cards in the chat. Use it for class groups, project teams, game sides, rotations. Give either how many teams or how many people per team. Works without an account.",
    inputSchema: {
      entries: entriesSchema,
      teams: z.number().int().min(2).max(50).optional().describe("How many teams. Default 2 when team_size is not given."),
      team_size: z.number().int().min(1).max(250).optional().describe("How many people per team, instead of a number of teams."),
      team_names: z.array(z.string().max(40)).max(50).optional().describe("Names for the teams, in order. Default Team 1, Team 2..."),
      title: titleSchema,
    },
    annotations: { title: "Split into random teams", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: ui("Splitting into teams", "Teams are ready"),
  }, async ({ entries, teams, team_size, team_names, title }) => {
    const gate = anonGate(caller); if (gate) return fail(gate);
    const list = cleanEntries(entries);
    if (list.length < 2) return fail("Teams need at least two names.");
    let count = teams || (team_size ? Math.ceil(list.length / team_size) : 2);
    count = Math.max(1, Math.min(count, list.length, 50));
    const order = list.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = pick(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const out = Array.from({ length: count }, (_, i) => ({ name: cleanTitle(team_names?.[i], `Team ${i + 1}`).slice(0, 40), members: [] as string[] }));
    order.forEach((name, i) => out[i % count].members.push(name));
    const t = cleanTitle(title, "Random teams");
    return {
      content: [{ type: "text", text: `${t}: ${list.length} names in ${count} teams, at random.\n${out.map((g) => `${g.name}: ${g.members.join(", ")}`).join("\n")}` }],
      structuredContent: { kind: "teams", title: t, total: list.length, teams: out },
    };
  });

  // ── open_wheel_link ───────────────────────────────────────────────────
  server.registerTool("open_wheel_link", {
    title: "Get a wheel link",
    description: "Make a namewheel.org link that opens the full NameWheel wheel with these names already loaded, for spinning on a projector, a stream or a shared screen with sound, modes and themes. Works without an account. Commas inside a name become spaces in the link.",
    inputSchema: { entries: entriesSchema, title: titleSchema },
    annotations: { title: "Get a wheel link", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ entries }) => {
    const gate = anonGate(caller); if (gate) return fail(gate);
    const list = cleanEntries(entries);
    if (list.length < 2) return fail("The wheel needs at least two entries.");
    const link = wheelLink(list);
    if (!link) return fail(`That list is too long for a link (${list.length} entries). Open ${SITE} and paste the names into the wheel instead.`);
    return text(`Open the wheel with these ${list.length} names loaded: ${link}`);
  });

  // ── certified_draw (account) ──────────────────────────────────────────
  server.registerTool("certified_draw", {
    title: "Run a certified draw",
    description: "Run a TrueSpin certified draw on NameWheel: the winner is sealed by NameWheel's server before it is revealed, randomness from this connection is added, and the result is published on a permanent public proof page (namewheel.org/v/CODE) that anyone can check, with a button that recomputes the draw. Use it when the result must be provable to other people: a class prize, a team decision, a draw announced to a group. IMPORTANT: the title, every entry and the winner become public on the proof page, so only use names the person is happy to publish, and tell them so. Needs a connected NameWheel account (free). To draw against a list locked earlier with freeze_list, pass frozen_code instead of entries.",
    inputSchema: {
      title: z.string().min(1).max(80).describe("The draw's public title, such as 'Year 9 reading prize' or 'Who presents first'."),
      entries: entriesSchema.optional(),
      frozen_code: z.string().max(40).optional().describe("Code or link of a list frozen earlier with freeze_list (namewheel.org/f/CODE). The draw uses exactly that list."),
      entropy: z.string().max(200).optional().describe("Optional words or a number from the person, mixed into the draw's randomness."),
    },
    annotations: { title: "Run a certified draw", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: ui("Running a certified draw", "The certified draw is done"),
  }, async ({ title, entries, frozen_code, entropy }) => {
    if (caller.kind !== "key" || !caller.apiKey) return fail(`Certified draws need a connected NameWheel account (free). Connect it in your assistant, or make a key at ${SITE}/mcp#key.`);
    let list: string[] = [];
    let frozen: string | null = null;
    try {
      if (frozen_code) {
        const p = parseCode(frozen_code);
        if (!p) return fail("That is not a frozen list code or link.");
        const mine = await nw.myDraws(caller.apiKey, caller.ip, 60, true);
        if (!mine.rows.some((r) => r.code === p.code)) return fail("That frozen list is not one of this account's lists. A draw can only use a list the same account froze.");
        const f = await nw.publicFreeze(p.code, caller.ip);
        if (f.drawnBy) return fail(`That list was already drawn: ${f.drawnBy.winner} won, proof at ${f.drawnBy.verifyUrl}`);
        list = f.entries; frozen = f.code;
      } else {
        list = cleanEntries(entries || []);
      }
      if (list.length < 2) return fail("A certified draw needs at least two entries (or a frozen_code).");
      const t = cleanTitle(title, "Certified draw");
      const mix = createHash("sha256").update(randomBytes(32)).update(String(entropy || "")).digest("hex").slice(0, 32);
      const s = await nw.startDraw(caller.apiKey, caller.ip, { title: t, entries: list, clientEntropy: mix });
      const f = await nw.finishDraw(caller.apiKey, caller.ip, s.code);
      const proof = f.verifyUrl || `${SITE}/v/${s.code}`;
      const winners = [{ name: s.winner, index: s.winnerIndex }];
      // The signed PDF certificate is sold in the dashboard. ChatGPT's rules allow no offers in the chat, so it is left out there.
      const certificateUrl = inChatGPT(caller) ? null : `${SITE}/dashboard#draws?open=${s.code}`;
      return {
        content: [{ type: "text", text: `Certified draw ${s.code}: ${s.winner} won, picked from ${list.length} entries.\nPublic proof page: ${proof}\nThe winner was sealed before it was revealed (commitment ${s.commit.slice(0, 16)}...), and anyone can recompute the draw on that page. The title, the entries and the winner are public there.${frozen ? `\nDrawn against the list frozen as ${frozen} (${SITE}/f/${frozen}).` : ""}${certificateUrl ? `\nIf the person needs a document for a sponsor, a client or their records: a signed one-page PDF certificate of this draw, with a QR code back to the proof page, is $9 once in their NameWheel dashboard: ${certificateUrl}` : ""}` }],
        structuredContent: { kind: "certified", title: t, entries: list, winners, certified: true, code: s.code, proofUrl: proof, commit: s.commit, serverSeed: f.serverSeed, clientEntropy: mix, seq: s.seq, frozenCode: frozen, certificateUrl },
      };
    } catch (e) { return fail(apiErrorText(e, caller)); }
  });

  // ── freeze_list (account) ─────────────────────────────────────────────
  server.registerTool("freeze_list", {
    title: "Freeze an entry list",
    description: "Lock a list of entries in public before a draw, at namewheel.org/f/CODE, with a fingerprint and the exact time. Nobody can add or remove a name after that, and when certified_draw later uses this list (frozen_code), the frozen page links to the result. Use it when entries close before the draw happens. The title and every entry are public. Needs a connected NameWheel account (free).",
    inputSchema: { title: z.string().min(1).max(80).describe("The list's public title."), entries: entriesSchema },
    annotations: { title: "Freeze an entry list", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ title, entries }) => {
    if (caller.kind !== "key" || !caller.apiKey) return fail(`Freezing a list needs a connected NameWheel account (free). Make a key at ${SITE}/mcp#key.`);
    const list = cleanEntries(entries);
    if (list.length < 2) return fail("A list needs at least two entries.");
    try {
      const f = await nw.freeze(caller.apiKey, caller.ip, { title: cleanTitle(title, "Frozen list"), entries: list });
      return text(`Frozen: ${list.length} entries locked at ${f.createdAt} (code ${f.code}).\nPublic page: ${f.url}\nWhen it is time, run certified_draw with frozen_code ${f.code} and the frozen page will link to the result.`);
    } catch (e) { return fail(apiErrorText(e, caller)); }
  });

  // ── verify_draw ───────────────────────────────────────────────────────
  server.registerTool("verify_draw", {
    title: "Check a certified draw",
    description: "Check whether a NameWheel certified draw is genuine, from its code or its namewheel.org/v/ link: recomputes the winner from the published secret, the added randomness and the entries, checks the commitment made before the spin, and checks NameWheel's Ed25519 signature on the record. Also says how many draws the host ran on this exact list. Use it when someone asks whether a draw or a giveaway result was real. Works without an account.",
    inputSchema: { code: z.string().min(4).max(200).describe("The draw code (8 letters and digits) or its link, such as namewheel.org/v/DG5J6VD7.") },
    annotations: { title: "Check a certified draw", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: ui("Checking the draw", "Draw checked"),
  }, async ({ code }) => {
    const gate = anonGate(caller); if (gate) return fail(gate);
    const p = parseCode(code);
    if (!p) return fail("That does not look like a NameWheel draw code. Codes are 8 letters and digits, like DG5J6VD7, or a namewheel.org/v/ link.");
    try {
      if (p.kind === "freeze") {
        const f = await nw.publicFreeze(p.code, caller.ip);
        return text(`${f.code} is a frozen entry list, not a draw: "${f.title}", ${f.entries.length} entries locked at ${f.frozenAt}.${f.drawnBy ? ` It was drawn later: ${f.drawnBy.winner} won (${f.drawnBy.verifyUrl}).` : " It has not been drawn yet."}`);
      }
      const v = await verifyDraw(p.code, caller.ip);
      const d = v.draw;
      if (d.status === "frozen") return text(`${d.code} is a frozen entry list, not a draw. Its page: ${SITE}/f/${d.code}`);
      const proof = `${SITE}/v/${d.code}`;
      const att = d.attempts;
      const attLine = att && att.total > 1 ? ` The host ran ${att.total} certified draws on this exact list; ${att.published} reached a result${att.abandoned ? ` and ${att.abandoned} ${att.abandoned === 1 ? "was" : "were"} started but never finished` : ""}.` : "";
      const head = v.genuine ? `Genuine. ${d.code} "${d.title}": ${d.winner} won, picked from ${d.entries.length} entries on ${d.createdAt.slice(0, 10)}.` : `Not confirmed. ${d.code} "${d.title}" did not pass every check.`;
      return {
        content: [{ type: "text", text: `${head}${attLine}\n${v.checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`).join("\n")}\nProof page: ${proof}` }],
        structuredContent: { kind: "verify", code: d.code, title: d.title, winner: d.winner, genuine: v.genuine, entriesCount: d.entries.length, createdAt: d.createdAt, checks: v.checks, attempts: att, proofUrl: proof, hasVideo: !!d.videoHash },
      };
    } catch (e) { return fail(apiErrorText(e, caller)); }
  });

  // ── my_draws (account) ────────────────────────────────────────────────
  server.registerTool("my_draws", {
    title: "List my certified draws",
    description: "List this account's recent NameWheel certified draws (or frozen lists) with their winners and proof links, newest first. Needs a connected NameWheel account.",
    inputSchema: {
      limit: z.number().int().min(1).max(30).optional().describe("How many to list. Default 10."),
      frozen_lists: z.boolean().optional().describe("List frozen entry lists instead of draws."),
    },
    annotations: { title: "List my certified draws", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit, frozen_lists }) => {
    if (caller.kind !== "key" || !caller.apiKey) return fail(`Listing your draws needs a connected NameWheel account. Make a key at ${SITE}/mcp#key.`);
    try {
      const r = await nw.myDraws(caller.apiKey, caller.ip, limit || 10, !!frozen_lists);
      if (!r.rows.length) return text(frozen_lists ? "This account has no frozen lists yet." : "This account has no certified draws yet. Run one with certified_draw.");
      const rows = r.rows.map((d) => frozen_lists
        ? `${d.code} "${d.title}", ${d.entries_count} entries, frozen ${d.created_at.slice(0, 10)}: ${SITE}/f/${d.code}`
        : `${d.code} "${d.title}": ${d.status === "committed" ? "started, never finished" : `${d.winner} won`} from ${d.entries_count} entries, ${d.created_at.slice(0, 10)}${d.hidden ? " (taken down)" : `: ${SITE}/v/${d.code}`}`);
      const what = frozen_lists ? (r.total === 1 ? "frozen list" : "frozen lists") : (r.total === 1 ? "certified draw" : "certified draws");
      return text(`${r.total} ${what} on this account${r.total > rows.length ? `; the latest ${rows.length}` : ""}:\n${rows.join("\n")}`);
    } catch (e) { return fail(apiErrorText(e, caller)); }
  });

  // ── check_plan ────────────────────────────────────────────────────────
  server.registerTool("check_plan", {
    title: "Check what this connection can do",
    description: "Say what this NameWheel connection can do: without an account (spins, teams, wheel links, checking draws) or with a connected account (certified draws, frozen lists, the account's draws), and how many certified draws are left today. Use it when the person asks about limits, their account, or why a request was refused.",
    inputSchema: {},
    annotations: { title: "Check what this connection can do", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    if (caller.kind !== "key" || !caller.apiKey) {
      const a = CONFIG.anon;
      return text(`This connection has no NameWheel account. It can spin the wheel, split teams, make wheel links and check any certified draw: up to ${caller.platform ? `${a.platformPerDay.toLocaleString()} spins a day shared by everyone on ${PLATFORM[caller.platform]}` : `${a.perMinute} a minute and ${a.perDay} a day`}. Certified draws with a public proof page, frozen lists and your own draws need a free NameWheel account: connect it in your assistant, or make a key at ${SITE}/mcp#key.`);
    }
    try {
      const [m, d] = await Promise.all([nw.me(caller.apiKey, caller.ip), nw.myDraws(caller.apiKey, caller.ip, 30)]);
      const cut = Date.now() - 86_400_000;
      const today = d.rows.filter((r) => Date.parse(r.created_at) > cut).length;
      const plan = m.pro ? `NameWheel PRO (${m.plan})` : "a free NameWheel account";
      return text(`Connected to ${plan}${m.user?.email ? ` (${m.user.email})` : ""}. Certified draws today: ${today} of 20 in any 24 hours. Spins, teams, wheel links and checks have no account limit. ${inChatGPT(caller) ? `About NameWheel accounts: ${SITE}/pricing` : `Hosted videos of a draw, your logo on the wheel and saved wheels are on the website (${SITE}).`}`);
    } catch (e) { return fail(apiErrorText(e, caller)); }
  });
}

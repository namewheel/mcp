// Prompts and resources: ready-made requests a person can pick in their
// client, and reference material the model can read before calling a tool.
// Everything here is read-only and free for every caller.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "./config.js";

const SITE = CONFIG.siteUrl;

const TRUESPIN = `# How a NameWheel certified draw works (TrueSpin)

A certified draw is a random pick that other people can check after the fact, without trusting NameWheel or the host.

## The steps
1. **Sealed before the spin.** NameWheel's server makes a 32 byte secret and publishes only its SHA-256 fingerprint (the commitment) before anything is revealed. The secret cannot be changed afterwards without breaking the fingerprint.
2. **Randomness from the caller.** The connection adds its own random value (and any words the person gives), so the server alone does not decide the result either.
3. **The winner is pure math.** HMAC-SHA256 with the secret as the key, over "added randomness|fingerprint of the entry list". The first 8 bytes, as a number, modulo the number of entries, pick the winner. An entry written "Name:3" counts three times.
4. **Revealed and signed.** After the spin the secret is published, and the whole record is signed with NameWheel's Ed25519 key (public key: ${SITE}/api/draw-key).
5. **A permanent public proof page** at ${SITE}/v/CODE shows the title, every entry, the winner, the commitment, the secret, the added randomness and the signature, with a button that recomputes the draw in the browser.

## Honesty extras
- **Attempt disclosure.** Re-running a draw until a favourite wins is the only real way to bias it, so the proof page lists every certified draw the same account ran on the exact same list, including ones started and never finished.
- **Frozen lists.** freeze_list locks an entry list in public (${SITE}/f/CODE) before the draw. The frozen page links to the first later draw on that exact list by the same account.
- **Bitcoin anchors.** Every day the fingerprints of all draw records are timestamped into Bitcoin with OpenTimestamps (${SITE}/api/anchors).

## Check one yourself
- verify_draw with the code or the /v/ link: recomputes everything and checks the signature.
- Open source verifier: https://github.com/namewheel/truespin-verifier
- Full specification: ${SITE}/truespin-spec

TrueSpin is NameWheel's name for this protocol.
`;

function limitsText(): string {
  const a = CONFIG.anon;
  return `# What this NameWheel connection can do

## Without an account
- spin_wheel: pick one or more winners at random, with the wheel shown in the chat.
- make_teams: random teams or groups of even size.
- open_wheel_link: a namewheel.org link with the names already on the wheel.
- verify_draw: check any certified draw by its code or link.
- check_plan: what this connection can do.
- Up to ${a.perMinute} calls a minute and ${a.perDay.toLocaleString()} a day per connection. On claude.ai and ChatGPT, guests share one allowance per platform and are asked to connect a free account when it runs out.
- Up to ${CONFIG.maxEntries} entries per wheel, 80 characters each.

## With a free NameWheel account (connect, or use an API key from ${SITE}/mcp#key)
- certified_draw: a TrueSpin certified draw with a permanent public proof page. Up to 20 in any 24 hours. The title, the entries and the winner are public on that page.
- freeze_list: lock an entry list in public before the draw.
- my_draws: the account's certified draws and frozen lists.
- No per-connection limit on spins, teams, links and checks.

More about NameWheel accounts: ${SITE}/pricing
`;
}

export function registerExtras(server: McpServer): void {
  // ── Resources ───────────────────────────────────────────────────────────
  server.registerResource("truespin", "namewheel://truespin", {
    title: "How certified draws work",
    description: "TrueSpin, step by step: the sealed secret, the added randomness, the winner math, the signature, attempt disclosure, frozen lists and how anyone can check a draw.",
    mimeType: "text/markdown",
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: TRUESPIN }] }));

  server.registerResource("limits", "namewheel://limits", {
    title: "NameWheel limits",
    description: "What works without an account and with a free NameWheel account through this server, and the limits of each.",
    mimeType: "text/markdown",
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: limitsText() }] }));

  // ── Prompts ─────────────────────────────────────────────────────────────
  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt("pick_student", {
    title: "Pick a student",
    description: "Spin the wheel to pick who answers next, from a class list.",
    argsSchema: {
      names: z.string().describe("The class list: one name per line, or separated by commas."),
      how_many: z.string().optional().describe("How many students to pick. Default 1."),
    },
  }, ({ names, how_many }) => {
    const n = Math.max(1, Math.min(50, Number(how_many) || 1));
    return user(`Use NameWheel's spin_wheel to pick ${n === 1 ? "one student" : `${n} students, no repeats,`} from this class list, and show me the wheel. Keep the names exactly as written.\n\nClass list:\n${names}`);
  });

  server.registerPrompt("split_teams", {
    title: "Split into teams",
    description: "Split a list of names into random teams or groups.",
    argsSchema: {
      names: z.string().describe("The names: one per line, or separated by commas."),
      teams: z.string().optional().describe("How many teams. Leave empty to give a team size instead."),
      team_size: z.string().optional().describe("How many people per team, instead of a number of teams."),
    },
  }, ({ names, teams, team_size }) => {
    const how = team_size ? `groups of ${team_size}` : `${Number(teams) || 2} teams`;
    return user(`Use NameWheel's make_teams to split these names into ${how}, at random, and show me the teams.\n\nNames:\n${names}`);
  });

  server.registerPrompt("certified_draw_with_proof", {
    title: "Certified draw with a proof page",
    description: "Run a TrueSpin certified draw that anyone can check later, on a public proof page.",
    argsSchema: {
      title: z.string().describe("What the draw is for, as it should appear on the public page."),
      entries: z.string().describe("The entries: one per line, or separated by commas."),
    },
  }, ({ title, entries }) => user(`Run a NameWheel certified draw titled "${title}" with these entries. Before you run it, remind me in one line that the title, every entry and the winner will be public on the proof page, and wait for my yes. Then give me the winner and the proof link.\n\nEntries:\n${entries}`));

  server.registerPrompt("make_a_decision", {
    title: "Let the wheel decide",
    description: "Put a few options on the wheel and let it choose.",
    argsSchema: {
      options: z.string().describe("The options: one per line, or separated by commas."),
      question: z.string().optional().describe("What is being decided, like 'Where do we eat tonight?'"),
    },
  }, ({ options, question }) => user(`${question ? `${question} ` : ""}Put these options on NameWheel's wheel with spin_wheel and let it pick one. Then give me one short, practical next step for the option that won.\n\nOptions:\n${options}`));

  server.registerPrompt("verify_a_draw", {
    title: "Check a draw",
    description: "Check whether a NameWheel certified draw is genuine, from its code or link.",
    argsSchema: { code: z.string().describe("The draw code, like DG5J6VD7, or its namewheel.org/v/ link.") },
  }, ({ code }) => user(`Check this NameWheel certified draw with verify_draw and tell me in plain words whether it is genuine, who won, and anything I should know (like the host running the same list more than once): ${code}`));
}

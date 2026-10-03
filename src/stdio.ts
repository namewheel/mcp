#!/usr/bin/env node
// NameWheel MCP server, local mode: runs on your machine over stdio and talks
// to the public NameWheel API with your own key.
//
//   NAMEWHEEL_API_KEY=nw_live_... npx -y @namewheel/mcp
//
// Without a key it still starts: spins, teams, wheel links and checking draws
// work; certified draws, frozen lists and your draws ask for a key (free, from
// namewheel.org/mcp). The hosted server at https://mcp.namewheel.org/mcp
// needs no install at all.
//
// Nothing but MCP messages may go to stdout here; notes go to stderr.
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NAMEWHEEL_MCP_LOCAL = "1";
process.env.NAMEWHEEL_API_URL ||= "https://namewheel.org";
process.env.STATE_DIR ||= join(tmpdir(), "namewheel-mcp");

const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer, VERSION } = await import("./server.js");
const { checkKey } = await import("./oauth.js");
const { loadStore } = await import("./store.js");

loadStore();
const key = (process.env.NAMEWHEEL_API_KEY || "").trim();
let caller: import("./tools.js").Caller = { kind: "anon", ip: "local", userAgent: "local" };
if (key) {
  const k = await checkKey(key);
  if ("plan" in k) {
    caller = { kind: "key", apiKey: key, plan: k.plan, ip: "local", userAgent: "local" };
    console.error(`NameWheel MCP ${VERSION} (local): key accepted, plan ${k.plan}.`);
  } else if (/could not check/.test(k.error)) {
    // Could not check the key (offline, or the API is busy): use it anyway, the API checks it on every call.
    caller = { kind: "key", apiKey: key, plan: "unknown", ip: "local", userAgent: "local" };
    console.error(`NameWheel MCP ${VERSION} (local): could not check the key just now; using it anyway.`);
  } else {
    console.error(`NameWheel MCP ${VERSION} (local): ${k.error} Starting without a key.`);
  }
} else {
  console.error(`NameWheel MCP ${VERSION} (local): no NAMEWHEEL_API_KEY set. Spins, teams and checks work; set a key (free, https://namewheel.org/mcp#key) for certified draws, or use the hosted server https://mcp.namewheel.org/mcp.`);
}

await createServer(caller).connect(new StdioServerTransport());

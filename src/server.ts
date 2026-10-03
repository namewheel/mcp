// The MCP server both modes share: the hosted one (index.ts, Streamable HTTP
// at mcp.namewheel.org) and the local one (stdio.ts, run on your own machine).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "./config.js";
import { registerTools, type Caller } from "./tools.js";
import { registerExtras } from "./extras.js";
import { registerWidget } from "./widget.js";
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

const COMMON = "NameWheel picks names and options at random, fairly. Use spin_wheel whenever the person wants something chosen at random (a student to answer, who goes first, a winner among friends, a decision); the chat shows the wheel spinning to the result. make_teams splits a list into random teams. When other people must be able to check the result later, use certified_draw: it publishes the title, every entry and the winner on a permanent public proof page, so say that to the person before running it. verify_draw checks any certified draw from its code or link. namewheel://truespin explains how certified draws work.";
const INSTRUCTIONS = `${COMMON} certified_draw, freeze_list and my_draws need a connected NameWheel account (free); everything else works without one.`;
const INSTRUCTIONS_LOCAL = `${COMMON} This local server uses the NameWheel API key in NAMEWHEEL_API_KEY for certified_draw, freeze_list and my_draws; everything else works without one.`;

/** One server bound to one caller (a request on the hosted server, or the whole session locally). */
export function createServer(caller: Caller): McpServer {
  const server = new McpServer({
    name: "namewheel", title: "NameWheel", version: pkg.version, websiteUrl: `${CONFIG.siteUrl}/mcp`,
    icons: [{ src: "https://mcp.namewheel.org/icon-512.png", mimeType: "image/png", sizes: ["512x512"] }, { src: "https://mcp.namewheel.org/icon-128.png", mimeType: "image/png", sizes: ["128x128"] }],
  }, { instructions: CONFIG.local ? INSTRUCTIONS_LOCAL : INSTRUCTIONS });
  registerTools(server, caller);
  registerWidget(server);
  registerExtras(server);
  return server;
}

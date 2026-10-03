// The wheel people see in the chat: an MCP Apps view (ui://...), shown by
// Claude, ChatGPT and other hosts with the results of spin_wheel, make_teams,
// certified_draw and verify_draw. One self-contained HTML file: no outside
// scripts, fonts, images or requests, so it needs no CSP allowances.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WIDGET_URI = "ui://namewheel/wheel-v1.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";
export const WIDGET_FILE = fileURLToPath(new URL("../widget/wheel.html", import.meta.url));

let html: string | null = null;
export const widgetHtml = (): string => (html ??= readFileSync(WIDGET_FILE, "utf8"));

const META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] }, permissions: { clipboardWrite: {} }, prefersBorder: false },
  "openai/widgetDescription": "A NameWheel wheel that spins to the winner, random teams as cards, or the checks behind a certified draw.",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
};

export function registerWidget(server: McpServer): void {
  server.registerResource("wheel", WIDGET_URI, {
    title: "NameWheel wheel",
    description: "The interactive view for NameWheel results: the wheel spinning to the winner, teams, and draw checks.",
    mimeType: WIDGET_MIME,
    _meta: META,
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: WIDGET_MIME, text: widgetHtml(), _meta: META }] }));
}

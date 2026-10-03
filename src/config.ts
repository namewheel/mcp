// Settings from the environment. Nothing secret lives in the repo.
import { randomBytes } from "node:crypto";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const CONFIG = {
  port: Number(env("PORT", "8791")),
  host: env("HOST", "127.0.0.1"),
  /** Where clients reach us. Metadata and the connect page are built from it. */
  publicUrl: env("PUBLIC_URL", "https://mcp.namewheel.org").replace(/\/$/, ""),
  /** The NameWheel API. On the server it is the local process; in local mode, the public site. */
  apiUrl: env("NAMEWHEEL_API_URL", "http://127.0.0.1:8788").replace(/\/$/, ""),
  /** Local mode (stdio.ts): runs on the user's machine against the public API with their own key. */
  local: env("NAMEWHEEL_MCP_LOCAL") === "1",
  /** Public address of the site (links in replies). */
  siteUrl: "https://namewheel.org",
  /** Signs the access tokens we issue. */
  jwtSecret: env("MCP_JWT_SECRET") || randomBytes(32).toString("hex"),
  stateDir: env("STATE_DIR", "/var/lib/namewheel-mcp"),
  /** Most entries a wheel or a draw takes (the website takes 500 for a certified draw). */
  maxEntries: 500,
  // Callers without an account: plain picks, teams, links and checking a draw.
  // Nothing they do costs more than a few microseconds, so the limits only stop floods.
  anon: {
    perMinute: Number(env("ANON_PER_MINUTE", "30")),
    perDay: Number(env("ANON_PER_DAY", "500")),
    /** Guests on claude.ai or ChatGPT all arrive from the platform's servers: one meter per platform. */
    platformPerMinute: Number(env("ANON_PLATFORM_PER_MINUTE", "600")),
    platformPerDay: Number(env("ANON_PLATFORM_PER_DAY", "50000")),
  },
  /** How long an access token lives. Refresh tokens rotate on use. */
  accessTokenSeconds: 3600,
  refreshTokenDays: 90,
  authCodeSeconds: 600,
};

export const MCP_PATH = "/mcp";
export const RESOURCE = `${CONFIG.publicUrl}${MCP_PATH}`;

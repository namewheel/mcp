# NameWheel MCP server

An open source (MIT) MCP server for fair random picks: pick names from a list, split people into random teams, make wheel links, and check certified draws. It runs on your own machine over stdio (Node.js 20+ or Docker), and the same code also runs as a hosted Streamable HTTP server at `https://mcp.namewheel.org/mcp`.

In clients that show MCP Apps (Claude, ChatGPT and others), the NameWheel wheel spins to the result right in the chat. When other people need to check a result later, it runs a **certified draw** with a permanent public proof page.

## Run it locally (stdio)

```
git clone https://github.com/namewheel/mcp && cd mcp
npm install && npm run build
node dist/stdio.js
```

Or with Docker:

```
docker build -t namewheel-mcp .
docker run -i --rm namewheel-mcp
```

What runs on your machine:

- **Picking winners** (`spin_wheel`): Node's cryptographic random number generator (`crypto.randomInt`) in this process. No network needed.
- **Teams** (`make_teams`) and **wheel links** (`open_wheel_link`): computed locally. No network needed.
- **Checking a certified draw** (`verify_draw`): downloads the draw's public record and NameWheel's public key, then recomputes everything locally: the SHA-256 commitment, the HMAC-SHA256 winner and the Ed25519 signature.
- **Limits** (`check_plan`): answered locally.

Only `certified_draw`, `freeze_list` and `my_draws` call the NameWheel API, because a certified draw is published on a public proof page at namewheel.org. They use your own free API key:

```
NAMEWHEEL_API_KEY=nw_live_... node dist/stdio.js
docker run -i --rm -e NAMEWHEEL_API_KEY=nw_live_... namewheel-mcp
```

Make a key in one press at [namewheel.org/mcp](https://namewheel.org/mcp#key). Without a key the server still starts and everything above works.

Claude Desktop, Cursor, Cline, Windsurf and other clients that start local servers:

```json
{
  "mcpServers": {
    "namewheel": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/dist/stdio.js"],
      "env": { "NAMEWHEEL_API_KEY": "nw_live_..." }
    }
  }
}
```

The `env` block is optional.

## Tools

| Tool | What it does | Where it runs |
|---|---|---|
| `spin_wheel` | Pick one or more winners at random from a list, with the wheel shown in the chat. | Locally |
| `make_teams` | Split names into random teams or groups of even size. | Locally |
| `open_wheel_link` | A namewheel.org link that opens the full wheel with the names loaded. | Locally |
| `verify_draw` | Check a certified draw from its code or link: recomputes the winner, checks the commitment and the Ed25519 signature. | Locally, after fetching the public record |
| `check_plan` | What this connection can do, and certified draws left today. | Locally (with a key: reads your plan) |
| `certified_draw` | A TrueSpin certified draw: the winner is sealed before the spin and published on a public proof page (namewheel.org/v/CODE). | NameWheel API, your key |
| `freeze_list` | Lock an entry list in public before the draw (namewheel.org/f/CODE). | NameWheel API, your key |
| `my_draws` | Your certified draws and frozen lists with proof links. | NameWheel API, your key |

Certified draws publish the title, every entry and the winner on the proof page. The tool description says so, so assistants tell people before running one.

The server also has 5 prompts (`pick_student`, `split_teams`, `certified_draw_with_proof`, `make_a_decision`, `verify_a_draw`) and 2 resources (`namewheel://truespin`, how certified draws work, and `namewheel://limits`).

## Or use the hosted server (nothing to install)

The same server runs at `https://mcp.namewheel.org/mcp` (Streamable HTTP). Without an account: 30 calls a minute and 500 a day per connection. Certified draws need a free NameWheel account, connected through the sign-in flow your client shows.

**Claude (web, desktop, mobile):** Settings, Connectors, Add custom connector, paste `https://mcp.namewheel.org/mcp`.

**Claude Code**
```
claude mcp add --transport http namewheel https://mcp.namewheel.org/mcp
```

**ChatGPT (web):** Settings, Apps (Developer Mode), add `https://mcp.namewheel.org/mcp`.

**Codex CLI**
```
codex mcp add namewheel --url https://mcp.namewheel.org/mcp
```

**Cursor:** [Install in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=NameWheel&config=eyJ1cmwiOiJodHRwczovL21jcC5uYW1ld2hlZWwub3JnL21jcCJ9), or `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "namewheel": { "url": "https://mcp.namewheel.org/mcp" } } }
```

**VS Code:** [Install in VS Code](https://vscode.dev/redirect/mcp/install?name=NameWheel&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.namewheel.org%2Fmcp%22%7D), or `.vscode/mcp.json`:
```json
{ "servers": { "namewheel": { "type": "http", "url": "https://mcp.namewheel.org/mcp" } } }
```

**Windsurf**, `~/.codeium/windsurf/mcp_config.json`:
```json
{ "mcpServers": { "namewheel": { "serverUrl": "https://mcp.namewheel.org/mcp" } } }
```

**Gemini CLI**, `~/.gemini/settings.json`:
```json
{ "mcpServers": { "namewheel": { "httpUrl": "https://mcp.namewheel.org/mcp" } } }
```

To use your account without the sign-in flow, send your key as `Authorization: Bearer nw_live_...` or `x-api-key: nw_live_...`.

## Run the HTTP server yourself

```
npm install && npm run build
NAMEWHEEL_API_URL=https://namewheel.org PUBLIC_URL=https://your-host.example MCP_JWT_SECRET=<random hex> node dist/index.js
```

Settings: `PORT` (default 8791), `HOST` (default 127.0.0.1), `PUBLIC_URL` (the address clients reach, used for OAuth metadata), `NAMEWHEEL_API_URL`, `MCP_JWT_SECRET` (signs access tokens), `STATE_DIR` (OAuth clients, tokens and guest meters, default /var/lib/namewheel-mcp).

The HTTP server is an OAuth 2.1 authorization server (PKCE, dynamic client registration, client ID metadata documents, RFC 9728 and 8414 metadata). Tools that need no account need no sign-in. When a client calls a tool that needs an account, the server answers 401 and the client shows its Connect flow; the connect page asks for a NameWheel API key and binds the connection to it. Deleting the key in the NameWheel dashboard (Settings, API keys) disconnects every assistant that used it. A key can only run certified draws, freeze lists, read the plan and list its own draws: it cannot change the account, its payments or its data.

## How certified draws work

1. NameWheel's server makes a secret and publishes only its SHA-256 fingerprint before anything is revealed.
2. The connection adds its own randomness.
3. The winner is HMAC-SHA256 over that randomness and the fingerprint of the entry list, keyed with the secret.
4. After the spin the secret is published and the record is signed with NameWheel's Ed25519 key ([public key](https://namewheel.org/api/draw-key)).
5. The proof page lists every certified draw the same account ran on the same list, so re-rolling until a favourite wins is visible.

Spec: [namewheel.org/truespin-spec](https://namewheel.org/truespin-spec). Independent verifier: [namewheel/truespin-verifier](https://github.com/namewheel/truespin-verifier). `verify_draw` runs the same checks ([src/verify.ts](src/verify.ts)).

## The in-chat wheel

`spin_wheel`, `make_teams`, `certified_draw` and `verify_draw` link an MCP Apps view (`ui://namewheel/wheel-v1.html`, `text/html;profile=mcp-app`). It is one self-contained HTML file in [`widget/wheel.html`](widget/wheel.html): no outside scripts, fonts or requests. Clients without MCP Apps get the same result as text.

## Privacy

Spins, teams and wheel links never store the names. Certified draws and frozen lists are stored by NameWheel and published on their proof pages, as on the website. The hosted server meters calls without an account by IP address and keeps request logs (tool, number of entries, client name, address, outcome, never the names) for 30 days. Policy: [namewheel.org/privacy](https://namewheel.org/privacy#mcp).

## License

MIT. NameWheel and TrueSpin are names of Outline Technologies LLC.

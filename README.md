# NameWheel MCP server

Fair random picks inside Claude, ChatGPT, Cursor, VS Code, Codex, Windsurf, Gemini CLI and any other MCP client. One remote server, nothing to install:

```
https://mcp.namewheel.org/mcp
```

Ask your assistant to pick a student, split a class into teams or choose where to eat. In clients that show MCP Apps (Claude, ChatGPT and others), the NameWheel wheel spins to the result right in the chat. When other people need to be able to check the result, it runs a **certified draw** with a permanent public proof page.

## What it does

| Tool | What it does | Needs |
|---|---|---|
| `spin_wheel` | Pick one or more winners at random from a list, with the wheel shown in the chat. | Nothing |
| `make_teams` | Split names into random teams or groups of even size. | Nothing |
| `open_wheel_link` | A namewheel.org link that opens the full wheel with the names loaded. | Nothing |
| `verify_draw` | Check a certified draw from its code or link: recomputes the winner, checks the commitment and the Ed25519 signature. | Nothing |
| `check_plan` | What this connection can do, and certified draws left today. | Nothing |
| `certified_draw` | A TrueSpin certified draw: the winner is sealed before the spin and published on a public proof page (namewheel.org/v/CODE). | Free NameWheel account |
| `freeze_list` | Lock an entry list in public before the draw (namewheel.org/f/CODE). | Free NameWheel account |
| `my_draws` | The account's certified draws and frozen lists with proof links. | Free NameWheel account |

Certified draws publish the title, every entry and the winner on the proof page. The tool description says so, so assistants tell people before running one.

**Without an account:** every tool except the three above, 30 calls a minute and 500 a day per connection. Guests on claude.ai and ChatGPT share an allowance per platform.

**With a free account:** certified draws (up to 20 in any 24 hours), frozen lists, your draws, and no per-connection limit on the rest. Make a key in one press at [namewheel.org/mcp](https://namewheel.org/mcp#key).

## Add it to your client

**Claude (web, desktop, mobile):** Settings, Connectors, Add custom connector, paste `https://mcp.namewheel.org/mcp`. Spins work at once; when a tool needs your account, Claude shows Connect.

**Claude Code**
```
claude mcp add --transport http namewheel https://mcp.namewheel.org/mcp
```
With a key: add `--header "Authorization: Bearer nw_live_..."`, or run `/mcp` inside a session to connect with the sign-in flow.

**ChatGPT (web):** Settings, Apps (Developer Mode), add `https://mcp.namewheel.org/mcp`.

**Codex CLI**
```
codex mcp add namewheel --url https://mcp.namewheel.org/mcp
```

**Cursor:** [Install in Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=NameWheel&config=eyJ1cmwiOiJodHRwczovL21jcC5uYW1ld2hlZWwub3JnL21jcCJ9), or in `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "namewheel": { "url": "https://mcp.namewheel.org/mcp" } } }
```

**VS Code:** [Install in VS Code](https://vscode.dev/redirect/mcp/install?name=NameWheel&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.namewheel.org%2Fmcp%22%7D), or in `.vscode/mcp.json`:
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

**Any other client:** use `https://mcp.namewheel.org/mcp` as the server URL (Streamable HTTP). To use your account without the sign-in flow, send your key as `Authorization: Bearer nw_live_...` or `x-api-key: nw_live_...`.

Full guide with copy buttons and a live wheel: [namewheel.org/mcp](https://namewheel.org/mcp).

## How certified draws work

1. NameWheel's server makes a secret and publishes only its SHA-256 fingerprint before anything is revealed.
2. The connection adds its own randomness.
3. The winner is HMAC-SHA256 over that randomness and the fingerprint of the entry list, keyed with the secret.
4. After the spin the secret is published and the record is signed with NameWheel's Ed25519 key ([public key](https://namewheel.org/api/draw-key)).
5. The proof page lists every certified draw the same account ran on the same list, so re-rolling until a favourite wins is visible.

Spec: [namewheel.org/truespin-spec](https://namewheel.org/truespin-spec). Independent verifier: [namewheel/truespin-verifier](https://github.com/namewheel/truespin-verifier). `verify_draw` runs the same checks.

## The in-chat wheel

`spin_wheel`, `make_teams`, `certified_draw` and `verify_draw` link an MCP Apps view (`ui://namewheel/wheel-v1.html`, `text/html;profile=mcp-app`). It is one self-contained HTML file in [`widget/wheel.html`](widget/wheel.html): no outside scripts, fonts or requests. Clients without MCP Apps get the same result as text.

## Sign-in (OAuth)

The server is an OAuth 2.1 authorization server (PKCE, dynamic client registration, client ID metadata documents, RFC 9728 and 8414 metadata). Tools without an account need no sign-in. When a client calls a tool that needs your account, the server answers 401 and the client shows its Connect flow; the page asks for a NameWheel API key and binds the connection to it. Delete the key in your dashboard (Settings, API keys) to disconnect every assistant that used it. A key can only run certified draws, freeze lists, read the plan and list its own draws: it cannot change the account, its payments or its data.

## Privacy

Plain spins and teams are worked out on this server and the names are never stored. Certified draws and frozen lists are stored by NameWheel and published on their proof pages, as on the website. Calls without an account are metered by the caller's IP address. Request logs (tool, number of entries, client name, address, outcome, never the names) are kept 30 days. Policy: [namewheel.org/privacy](https://namewheel.org/privacy#mcp).

## Run it locally (stdio)

The same server also runs on your own machine, for clients that start local servers. It talks to the public NameWheel API with your own key (free, from [namewheel.org/mcp](https://namewheel.org/mcp#key)).

```
git clone https://github.com/namewheel/mcp && cd mcp
npm install && npm run build
NAMEWHEEL_API_KEY=nw_live_... node dist/stdio.js
```

Without a key it still starts: spins, teams, wheel links and checking draws work, and certified draws ask for a key. Node.js 20 or later.

## License

MIT. NameWheel and TrueSpin are names of Outline Technologies LLC.

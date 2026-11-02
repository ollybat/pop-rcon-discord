# Spinback MCP server

`mcp/server.js` exposes the Rust servers this bot watches to any AI client that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) — Claude Desktop, Claude Code, Codex,
Cursor, your own agent. No Discord involved: your assistant asks, the server opens WebRCON to the
Rust server and answers.

```
node mcp/server.js                 # stdio transport, for a client config
node mcp/server.js --allow-rcon    # also expose a raw RCON command tool
```

Only **stdout** carries protocol traffic; every log line goes to stderr.

## Where the credentials come from

The MCP server reads the same two places the bot does, so there is nothing extra to configure:

1. **The `/setup` data directory** — `DATA_DIR/guilds/<guildId>.json` (default `./data`). Every
   server saved through `/setup` shows up, with its guild id and slot.
2. **`RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` / `RCON_NAME`** — a single-server fallback for
   people who never ran `/setup`.

Point it at a copy of your bot's data with `DATA_DIR`:

```
DATA_DIR=/home/container/data node mcp/server.js
```

Passwords are used to open the socket and are never returned by any tool.

## Tools

| Tool | What it does |
| --- | --- |
| `list_servers` | Every server it can reach, with guild, slot, host:port and today's/best peak |
| `server_status` | Live players, max, queue, joining, uptime, restart state, map — one server, or all of them with `all: true` |
| `players` | Who is on now, with ping and session length |
| `pop_report` | A summary ready to paste into Discord: numbers, bar, peak of the day and the player names |
| `records` | The record book: best day ever, today, the busiest recorded days |
| `server_save` | Ask the server to save the world (`server.save`) |
| `broadcast` | Post a message to in-game chat (`say "..."`) |
| `rcon` | One raw console command — **only** with `--allow-rcon` or `MCP_ALLOW_ANY_RCON=1` |

Each tool takes an optional `server`: a key (`<guildId>:<slot>`), a slot number, or part of the
name or host. With one server configured you can ignore it.

Things you can say to your assistant once it is connected:

- "How many people are on Spinback 5X EU right now?"
- "Give me a pop report I can paste in #general."
- "What has been our best day this month?"
- "Broadcast: server restart in 10 minutes."

## Claude Desktop

```json
{
  "mcpServers": {
    "spinback": {
      "command": "node",
      "args": ["/absolute/path/to/pop-rcon-discord/mcp/server.js"],
      "env": { "DATA_DIR": "/absolute/path/to/pop-rcon-discord/data" }
    }
  }
}
```

## Claude Code

```bash
claude mcp add spinback -- node /absolute/path/to/pop-rcon-discord/mcp/server.js
```

## Any other client

It is a plain stdio MCP server: spawn `node mcp/server.js`, write newline-delimited JSON-RPC
2.0 (`initialize`, `tools/list`, `tools/call`) to its stdin, read the replies from its stdout.

## Safety

- The default tool set is **read-mostly**: status, players, records. `server_save` and
  `broadcast` are the only things that change anything in game, and both are the same safe
  commands the Discord bot already exposes to staff.
- Raw RCON is off unless you ask for it, because `rcon` can do anything the console can.
- Keep the data directory private (the bot already writes it `0600`): it holds the RCON
  passwords.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No Rust servers are configured yet` | Run `/setup` in Discord, or set `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` |
| `connect ECONNREFUSED` | The Rust server's RCON port is not reachable — is `+rcon.web 1` set and the port open? |
| `RCON command timed out` | Raise `MCP_RCON_TIMEOUT_MS` (default 10000) |
| Handshake or 401-ish failure | The RCON password does not match `+rcon.password` |
| The client shows no tools | Make sure the client actually started `node mcp/server.js`; run `npm run ci` to smoke test it |

`npm run ci` starts the server for real, sends `initialize`, `tools/list` and a few
`tools/call` frames down the pipe and verifies the answers.

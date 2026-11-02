# pop-rcon-discord

A Discord bot that puts your **Rust dedicated server console** into Discord. It talks to Rust's
WebRCON — the websocket RCON you get from `+rcon.web 1` — so you can run console commands, list
players and broadcast messages from slash commands, and optionally mirror in-game chat back into a
channel.

> **Status:** the WebRCON client is unit-tested against a mock server (`npm test`). The bot has not
> been pointed at a live Rust server yet, so treat the first run as a smoke test.

## Features

- Slash commands: `/console`, `/players`, `/say`, `/kick`, `/ban`, `/serverinfo`, `/status`
- Automatic reconnect with exponential backoff, so a server restart does not kill the bot
- Optional relay of in-game chat and connect/disconnect events into a channel
- Optional role allow-list; every reply is ephemeral by default
- Small dependency surface: `discord.js`, `ws`, `dotenv`

## Requirements

- Node.js 18.17 or newer
- A **Rust (PC / Steam) dedicated server** with WebRCON enabled
- A Discord application with a bot user

Rust Console Edition (Xbox / PlayStation) does not expose an RCON interface, so this bot cannot
drive it — it only works with a PC dedicated server.

## 1. Enable WebRCON on the Rust server

Add these to your server start command (or your `start_server.bat` / systemd unit / admin panel
startup parameters):

```
+rcon.ip 0.0.0.0 +rcon.port 28016 +rcon.password "change-me" +rcon.web 1
```

- `rcon.web 1` is what enables the websocket RCON this bot speaks.
- `rcon.port` defaults to 28016; it must be reachable over **TCP** from wherever the bot runs.
- Pick a long random password. The password is part of the websocket URL.
- Do not leave RCON open to the whole internet: allow the port only from your bot's IP (or keep the
  bot on the same machine / LAN).

## 2. Create the Discord bot

1. Open <https://discord.com/developers/applications> → **New Application**.
2. Go to **Bot** → **Reset Token** → copy the token into `DISCORD_TOKEN`.
3. Copy the **Application ID** (General Information) into `DISCORD_APP_ID` — optional, the bot can
   read it at login.
4. **OAuth2 → URL Generator**: scopes `bot` and `applications.commands`, permissions
   `View Channels`, `Send Messages`, `Embed Links`. Open the generated URL to invite the bot.
5. Optional: copy the target server's ID into `DISCORD_GUILD_ID` so slash commands appear
   instantly instead of waiting for a global rollout.

## 3. Configure and run

```bash
git clone https://github.com/ollybat/pop-rcon-discord.git
cd pop-rcon-discord
npm install
cp .env.example .env    # then fill it in
npm start
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token from the Discord developer portal. |
| `DISCORD_APP_ID` | no | Application ID; defaults to the ID the bot reports at login. |
| `DISCORD_GUILD_ID` | no | Register commands in this one server (instant). Empty = global. |
| `COMMAND_ROLE_IDS` | no | Comma-separated role IDs allowed to use the commands. Empty = everyone. |
| `CONSOLE_CHANNEL_ID` | no | Channel ID where in-game chat and connection events are relayed. |
| `RCON_HOST` | yes | Rust server IP or hostname. |
| `RCON_PORT` | no | WebRCON port, default `28016`. |
| `RCON_PASSWORD` | yes | The `rcon.password` from your server start command. |
| `RCON_TIMEOUT_MS` | no | How long to wait for a command reply, default `15000`. |
| `RCON_MAX_RECONNECT_DELAY_MS` | no | Reconnect backoff ceiling, default `30000`. |

## Commands

| Command | What it does |
| --- | --- |
| `/console <command>` | Runs any raw RCON command and shows the output, e.g. `server.info`, `env.time 12`. |
| `/players` | Runs `playerlist` and renders an embed with name, Steam ID, ping and session length. |
| `/say <message>` | Broadcasts a message in the in-game chat. |
| `/kick <player> [reason]` | Kicks a player by Steam ID or in-game name. |
| `/ban <player> [reason]` | Bans a player by Steam ID or in-game name. |
| `/serverinfo` | Hostname, player counts, queue, map, entity count, framerate, uptime. |
| `/status` | Whether the bot is currently connected to the Rust server. |

Replies are ephemeral (only visible to the person who ran the command), so admin output does not
spam the channel. Chat relayed to `CONSOLE_CHANNEL_ID` is the only public output.

## Run it with Docker

```bash
docker build -t pop-rcon-discord .
docker run --rm --env-file .env pop-rcon-discord
```

## Tests

```bash
npm test
```

The suite starts a fake WebRCON server over `ws` and asserts that the client puts the password in
the URL path, matches replies by identifier, parses JSON replies from `playerlist` / `serverinfo`,
emits chat broadcasts, and times out unresponsive commands.

## Project layout

```
src/config.js     environment parsing and validation
src/rcon.js       Rust WebRCON websocket client (connect, send, auto-reconnect)
src/commands.js   slash command definitions and handlers
src/util.js       message truncation / quoting helpers
src/index.js      Discord client wiring, command registration, chat relay
test/rcon.test.js unit tests against a mock WebRCON server
```

## Security notes

- `.env` is git-ignored — never commit the bot token or the RCON password.
- Restrict who can run commands with `COMMAND_ROLE_IDS`; anyone who can use `/console` effectively
  has admin on your server.
- Firewall the RCON port to your bot's address only.

## License

MIT — see [LICENSE](LICENSE).

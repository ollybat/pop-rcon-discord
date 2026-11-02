# pop-rcon-discord

A Discord bot that watches your **Rust dedicated server console**. It connects to the server's
WebRCON (the websocket RCON you get from `+rcon.web 1`), reports live status in its own
"Watching ..." activity, and relays in-game chat and connection events into a channel.

> **Status:** the WebRCON client and the presence logic are unit-tested against mocks (`npm test`),
> and `npm run check` parses every file. The bot has not been run against a live Rust server yet,
> so treat the first run as a smoke test - `npm run doctor` makes that quick.
>
> **No slash commands yet.** The bot currently reports status and relays chat only.

## What the status looks like

| State | Activity | Discord dot | When |
| --- | --- | --- | --- |
| 🟢 Online | `🟢 RCON┆👥  12/100 ⏳0/0` | green | RCON is up and the server answered the last `serverinfo` poll |
| 🔴 Offline | `🔴 RCON┆OFFLINE` | red | no usable RCON connection, or the server stopped answering |
| 🟡 Resting | `🟡 RCON┆RESTING` | yellow | the server reports that it is restarting |

The online line is built from the server's own `serverinfo`: `{players}/{max}` and
`{queued}/{joining}`. All three templates are configurable with environment variables
(`PRESENCE_ONLINE_FORMAT`, `PRESENCE_OFFLINE_FORMAT`, `PRESENCE_RESTING_FORMAT`), with
`{players}`, `{max}`, `{maxPlayers}`, `{queued}`, `{joining}` and `{uptime}` as placeholders.

Discord shows an activity name on a single line, so the three states are shown one at a time rather
than stacked as three lines.

## Features

- Live "Watching" status that tracks the RCON connection and the server's player counts
- Automatic reconnect with exponential backoff, so a server restart does not kill the bot
- Optional relay of in-game chat and connect/disconnect events into a channel
- Leveled logging (`debug` to `silent`) with timestamps
- `npm run doctor` - one-command diagnosis of the config, RCON and Discord token
- Small dependency surface: `discord.js`, `ws`, `dotenv` - no build step

## Requirements

- Node.js 18.17 or newer
- A **Rust (PC / Steam) dedicated server** with WebRCON enabled
- A Discord application with a bot user

Rust Console Edition (Xbox / PlayStation) does not expose an RCON interface, so this bot cannot
drive it - it only works with a PC dedicated server.

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
3. **OAuth2 → URL Generator**: scopes `bot` and `applications.commands`, permissions
   `View Channels`, `Send Messages`, `Embed Links`. Open the generated URL to invite the bot.

The bot only needs the `Guilds` gateway intent - no message-content intent.

## 3. Configure and run

```bash
git clone https://github.com/ollybat/pop-rcon-discord.git
cd pop-rcon-discord
npm install
cp .env.example .env    # then fill it in
npm start
```

### Check your setup

```bash
npm run doctor
```

It verifies the configuration, connects to the RCON port, prints `serverinfo` and `playerlist`,
shows the exact status line the bot would display, checks the Discord token, and exits non-zero if
anything failed. Passwords are masked. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) when a
check fails.

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | yes | - | Bot token from the Discord developer portal. |
| `CONSOLE_CHANNEL_ID` | no | - | Channel ID where chat and connection events are relayed. |
| `RCON_HOST` | yes | - | Rust server IP or hostname. |
| `RCON_PORT` | no | `28016` | WebRCON port. |
| `RCON_PASSWORD` | yes | - | The `rcon.password` from your server start command. |
| `RCON_TIMEOUT_MS` | no | `15000` | How long to wait for a command reply. |
| `RCON_MAX_RECONNECT_DELAY_MS` | no | `30000` | Reconnect backoff ceiling. |
| `PRESENCE_ENABLED` | no | `true` | Turn the status updates off entirely. |
| `PRESENCE_INTERVAL_SECONDS` | no | `15` | Poll interval, minimum 5. |
| `PRESENCE_RESTING_ON_RECONNECT` | no | `false` | Show 🟡 RESTING while backing off between reconnects. |
| `PRESENCE_ONLINE_FORMAT` | no | `🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}` | Online template. |
| `PRESENCE_OFFLINE_FORMAT` | no | `🔴 RCON┆OFFLINE` | Offline template. |
| `PRESENCE_RESTING_FORMAT` | no | `🟡 RCON┆RESTING` | Resting template. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `LOG_TIMESTAMPS` | no | `true` | Prefix log lines with an ISO timestamp. |

## Deploying on bot-hosting.net

The bot runs as a plain Node process, so it fits a standard panel deployment:

1. Create a deployment of type **Node.js** and pick the source - clone this GitHub repository
   (give it a personal access token if you keep the repo private), or upload the project as a ZIP.
2. Needed files at the root: `package.json`, `src/`, `scripts/` and your `.env`. **Do not upload
   `node_modules`** - the host installs the packages listed in `package.json` itself.
3. Open **Startup** and set **Entry File (STARTUP_FILE)** to `src/index.js`.
4. Upload your `.env` through the **Files** tab next to `package.json` (it is git-ignored, so it is
   not in the repository). One variable per line, no quotes.
5. Start the deployment and watch the console: you should see the Discord login, then
   `[presence] ... -> online` once RCON answers. If it logs a timeout instead, run the checks in
   [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

Anything that keeps a Node 18+ process alive works too - a VPS with the bundled systemd unit
(`deploy/pop-rcon-discord.service`), Docker Compose, or a Raspberry Pi on the same network as the
server.

## Run it with Docker

```bash
docker build -t pop-rcon-discord .
docker run --rm --env-file .env pop-rcon-discord

# or
docker compose up -d --build
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Run the bot. |
| `npm run dev` | Run with `node --watch`. |
| `npm run check` | Parse every file with `node --check` in ES module mode. |
| `npm run doctor` | Diagnose the configuration, RCON and Discord token. |
| `npm test` | Run the test suite. |

## Tests

```bash
npm test
```

- `test/rcon.test.js` - password-in-URL handshake, reply matching by identifier, JSON replies, chat
  broadcasts, command timeouts, reconnect after a dropped socket, and that `close()` stops retrying.
- `test/presence.test.js` - placeholder substitution, `serverinfo` normalisation, all three states,
  and that the activity is only re-pushed when it changes.
- `test/e2e.test.js` - a live socket against the mock server, wired to the presence manager and the
  relay: green status with real counts, yellow while restarting, red while down, relayed chat.
- `test/config.test.js` - defaults, parsing, the interval floor, and loud failures.
- `test/logger.test.js` - level filtering, child scopes, formatting.
- `test/summary.test.js` - password masking and the `serverinfo` summary used by `npm run doctor`.

CI runs `npm run check` and `npm test` on every push and pull request
(`.github/workflows/ci.yml`).

## Project layout

```
src/config.js         environment parsing and validation
src/logger.js         leveled logger (debug/info/warn/error/silent)
src/rcon.js           Rust WebRCON websocket client (connect, send, auto-reconnect)
src/presence.js       status state machine and the "Watching ..." activity updater
src/relay.js          Discord channel relay for chat and connection events
src/summary.js        password masking and serverinfo summaries
src/index.js          Discord client wiring, relay hooks, graceful shutdown
scripts/check.js      syntax-checks every file (npm run check)
scripts/doctor.js     end-to-end configuration and connectivity check (npm run doctor)
test/                 unit, integration and mock-server tests
deploy/               systemd unit for a VPS
docs/TROUBLESHOOTING.md  what to do when a check fails
```

## Security notes

- `.env` is git-ignored - never commit the bot token or the RCON password.
- Firewall the RCON port to your bot's address only; see [SECURITY.md](SECURITY.md).
- When slash commands are added, restrict them by role: anyone who can run console commands
  effectively has admin on your server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

MIT - see [LICENSE](LICENSE).

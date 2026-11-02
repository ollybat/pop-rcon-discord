# pop-rcon-discord

A Discord bot that watches your **Rust dedicated server console**. It connects to the server's
WebRCON (the websocket RCON you get from `+rcon.web 1`), reports live status in its own
"Watching ..." activity, and relays in-game chat and connection events into a channel.

> **Status:** the WebRCON client and the presence logic are unit-tested against mocks (`npm test`).
> The bot has not been pointed at a live Rust server yet, so treat the first run as a smoke test.
>
> **No slash commands yet.** They were removed on request — the command set will be added from the
> list you send, so the bot currently only reports status and relays chat.

## What the status looks like

The bot's activity follows the RCON connection state:

| State | Activity | Discord dot | When |
| --- | --- | --- | --- |
| 🟢 Online | `🟢 RCON┆👥  12/100 ⏳0/0` | green | RCON is up and the server answered the last `serverinfo` poll |
| 🔴 Offline | `🔴 RCON┆OFFLINE` | red | no usable RCON connection, or the server stopped answering |
| 🟡 Resting | `🟡 RCON┆RESTING` | yellow | the server reports it is restarting |

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
3. **OAuth2 → URL Generator**: scopes `bot` and `applications.commands`, permissions
   `View Channels`, `Send Messages`, `Embed Links`. Open the generated URL to invite the bot.

The bot only needs the `Guilds` gateway intent — no message-content intent.

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
| `CONSOLE_CHANNEL_ID` | no | Channel ID where in-game chat and connection events are relayed. |
| `RCON_HOST` | yes | Rust server IP or hostname. |
| `RCON_PORT` | no | WebRCON port, default `28016`. |
| `RCON_PASSWORD` | yes | The `rcon.password` from your server start command. |
| `RCON_TIMEOUT_MS` | no | How long to wait for a command reply, default `15000`. |
| `RCON_MAX_RECONNECT_DELAY_MS` | no | Reconnect backoff ceiling, default `30000`. |
| `PRESENCE_ENABLED` | no | Set to `false` to disable the status updates, default `true`. |
| `PRESENCE_INTERVAL_SECONDS` | no | How often the server is polled for counts, default `15` (minimum 5). |
| `PRESENCE_RESTING_ON_RECONNECT` | no | Show 🟡 RESTING while the bot backs off between reconnect attempts, default `false`. |
| `PRESENCE_ONLINE_FORMAT` | no | Online template, default `🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}`. |
| `PRESENCE_OFFLINE_FORMAT` | no | Offline template, default `🔴 RCON┆OFFLINE`. |
| `PRESENCE_RESTING_FORMAT` | no | Resting template, default `🟡 RCON┆RESTING`. |

## Deploying on bot-hosting.net

The bot runs as a plain Node process, so it fits a standard bot-hosting deployment:

1. Create a deployment of type **Node.js** and pick the source — clone this GitHub repository
   (give it a personal access token if you keep the repo private), or upload the project as a ZIP.
2. Needed files at the root: `package.json`, `src/`, and your `.env`. **Do not upload
   `node_modules`** — the host installs the packages listed in `package.json` itself.
3. Open **Startup** and set **Entry File (STARTUP_FILE)** to `src/index.js`.
4. Upload your `.env` through the **Files** tab next to `package.json` (it is git-ignored, so it is
   not in the repository). Keep the file on one line per variable.
5. Start the deployment and watch the console: you should see the Discord login, then
   `[presence] ... -> online` once RCON answers. If it logs a timeout instead, check the RCON port
   is reachable from the host and the password matches.

Anything that keeps a Node 18+ process alive works too — a VPS with systemd, Docker, or a
Raspberry Pi on the same network as the server.

## Run it with Docker

```bash
docker build -t pop-rcon-discord .
docker run --rm --env-file .env pop-rcon-discord
```

## Tests

```bash
npm test
```

- `test/rcon.test.js` starts a fake WebRCON server over `ws` and checks the password-in-URL
  handshake, reply matching by identifier, JSON replies, chat broadcasts and command timeouts.
- `test/presence.test.js` checks placeholder substitution, `serverinfo` normalisation, all three
  status states, and that the presence is only re-pushed to Discord when it actually changes.

## Project layout

```
src/config.js        environment parsing and validation
src/rcon.js          Rust WebRCON websocket client (connect, send, auto-reconnect)
src/presence.js      status state machine and the "Watching ..." activity updater
src/index.js         Discord client wiring and chat relay
test/rcon.test.js    WebRCON client tests against a mock server
test/presence.test.js presence tests
```

## Security notes

- `.env` is git-ignored — never commit the bot token or the RCON password.
- Firewall the RCON port to your bot's address only.
- When slash commands are added, restrict them by role: anyone who can run console commands
  effectively has admin on your server.

## License

MIT — see [LICENSE](LICENSE).

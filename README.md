# Spinback pop bot

A Discord bot for **Rust dedicated servers** (PC / Steam, not Console Edition) that talks to the
server console over **WebRCON**, shows the live population in its own status line, and gives your
staff a **/setup** wizard, **/pop** player reports and role-gated staff commands.

```
🟢 RCON┆👥  63/200 ⏳0/2      <- the bot's "Watching" activity, updated every 20 seconds
```

- **Live status line** - 🟢 online with players/max and queue, 🔴 offline, 🟡 resting (the server is
  restarting). Up to three servers can be added together.
- **/setup wizard** - buttons and dropdowns, no JSON and no config files to hand edit: five staff
  roles, four log channels and up to three servers. Or press **⚡ Quick setup** and it guesses your
  existing roles by name and creates the four log channels for you.
- **!pop** - who is online right now, with a population bar, queue, uptime, today's peak and the
  player list, right in the channel. The buttons under it switch server, refresh on demand and hide
  the list. `/pop` does the same thing if you prefer the slash menu.
- **!status** - is every server reachable, how many players in total, and today's busiest moment.
- **!help** - every command grouped by the tier it needs.
- **!board** - the record book: the best day ever, today, and the busiest days this server has
  seen (peaks are kept per server, per UTC day, for 90 days).
- **An MCP server** - `mcp/server.js` lets Claude Desktop / Claude Code / Codex read the same
  Rust servers directly, no Discord in the middle. See [docs/MCP.md](docs/MCP.md).
- **Logs** - join & leave (with session length), every staff command, errors, and server
  connects/disconnects.
- **Staff commands** - /players, /say, /kick, /ban, /console, gated by the roles you picked in
  /setup.
- **Daily peaks** - the busiest moment of each day is remembered per server and shown in /pop and
  /status.
- **Light blue everywhere** - every embed uses the Spinback palette and footer, and the bot wears
  the name Spinback in your server.

## Requirements

| | |
| --- | --- |
| Rust server | PC/Steam dedicated server started with `+rcon.web 1` (see below). Rust **Console Edition has no RCON** and cannot be used. |
| Node.js | 18.17 or newer |
| Discord bot | A bot application with the **Server Members Intent** optional; the **Message Content Intent** is needed for `!prefix` commands |
| Hosting | Anywhere Node runs: a VPS, Docker, or a free panel such as bot-hosting.net |

### Enable RCON on the Rust server

Add these to the server's start line (or `server.cfg`-style launch args):

```
+rcon.web 1 +rcon.ip 0.0.0.0 +rcon.port 28016 +rcon.password "a-long-random-password"
```

- `+rcon.web 1` is what turns the **websocket** console on. Without it nothing else matters.
- The RCON port must be reachable over **TCP** from wherever the bot runs.
- `+rcon.ip 0.0.0.0` listens on every interface; `127.0.0.1` only works for a bot on the same box.

## Quick start

```bash
git clone https://github.com/ollybat/pop-rcon-discord.git
cd pop-rcon-discord
npm install
cp .env.example .env
# put DISCORD_TOKEN in .env, then:
npm start
```

Invite the bot with the `bot` and `applications.commands` scopes and at least
**View Channels**, **Send Messages**, **Embed Links** and **Manage Roles** (for the `/setup`
dropdowns to show your roles).

Then run **/setup** in your server - see [docs/SETUP.md](docs/SETUP.md) for the walkthrough.

## The /setup wizard

`/setup` opens a private panel with a summary and five buttons: **Roles**, **Logs**, **Servers**,
**Refresh** and **Done**.

| Button | What it does |
| --- | --- |
| 🎭 Roles | 👑 Owner (required), 🛡️ Co-Owner, ⚔️ Head Admin, 🔧 Admin, 🔨 Moderator |
| 📋 Logs | 🚪 Join & Leave, ⌨️ Command Log, 🚨 Error Log, 📡 Server Status |
| 🖥️ Servers | Up to three servers: name, IP/host, RCON port, RCON password, with a **Test** button |
| ⚡ Quick setup | Fills in what it can: 🪄 guesses your roles by name + 📁 builds a category with the four log channels |
| 🪄 Guess roles | Matches Owner / Co-Owner / Head Admin / Admin / Mod roles you already have |
| 📁 Make channels | Creates \`🎧 Spinback\` with 🚪・joins-leaves, ⌨️・staff-commands, 🚨・bot-errors, 📡・server-status |
| 📖 Guide | The one-page "how do I turn RCON on" walkthrough with the exact start line |
| 🔄 Refresh | Reconnects and re-reads every server |
| ✅ Done | Checklist of what is configured and what is still missing |
| 🧹 Reset | Wipes every saved role, channel and server for this Discord server |

Only the **Discord server owner** (or a **bot owner** listed in `BOT_OWNER_IDS`) can use `/setup`.
Every other command follows the roles you saved: a member with the ⚔️ Head Admin role can use
everything up to Head Admin, and the server owner always can.

## Commands

| Slash | Prefix | Who | What it does |
| --- | --- | --- | --- |
| `/setup` | - | Server owner / bot owner | Opens the setup panel. |
| `/pop` | **`!pop`** | Everyone | Live population, queue, uptime, today's peak and the player list, with buttons to switch server, refresh and hide the list. `!pop 2` opens on one server, `!pop 2 off` hides the names. |
| `/status` | **`!status`** | Everyone | Are the servers reachable, how many players in total, and each server's peak of the day. |
| `/board` | **`!board`** | Everyone | The record book: best day ever, today, and the busiest recorded days. |
| `/help` | **`!help`** | Everyone | Every command, grouped by who can use it. |
| `/players` | `!players` | 🔨 Moderator and up | Detailed player list with ping and session time. |
| `/say` | `!say` | 🔧 Admin and up | Broadcasts a message to in-game global chat. |
| `/kick` | `!kick` | 🔧 Admin and up | Kicks a player by name or SteamID, with an optional reason. |
| `/save` | `!save` | 🔧 Admin and up | Asks the Rust server to save the world (`server.save`). |
| `/ban` | `!ban` | ⚔️ Head Admin and up | Bans a player by name or SteamID, with an optional reason. |
| `/console` | `!console` | 🛡️ Co-Owner and up | Sends one raw RCON command and shows the reply. |

Slash replies and refusals are private; `!prefix` replies are public, which is what you want for
`!pop`. `!prefix` commands need `PREFIX_COMMANDS_ENABLED=true` (the default) and the **Message
Content Intent** enabled in the Discord developer portal.

## What ends up in the log channels

| Channel | Receives |
| --- | --- |
| 🚪 Join & Leave | One embed per player, with ping and session length when they leave. A restart-sized change becomes a single summary instead of a wall of messages. |
| ⌨️ Command Log | Every staff command: who ran it, their tier, the options, how long it took and any error. |
| 🚨 Error Log | RCON failures, permission problems and unhandled errors. |
| 📡 Server Status | Connects and disconnects, plus every change made in `/setup`. |

## Configuration

Everything below is optional except `DISCORD_TOKEN`. Roles, log channels and servers all live in
Discord: `/setup` writes them to `DATA_DIR`. The `RCON_*` block at the bottom is only an
advanced shortcut that pre-fills server slot 1 before the first `/setup`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | - | **Required.** Bot token. |
| `DISCORD_GUILD_ID` | - | Register the slash commands in one server (instant) instead of globally. |
| `PREFIX_COMMANDS_ENABLED` | `true` | Enable `!prefix` commands. |
| `PREFIX` | `!` | The prefix character. |
| `BOT_OWNER_IDS` | - | User ids that may also run `/setup`, comma separated. |
| `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`, `RCON_NAME` | - | Shortcut for server slot 1. |
| `RCON_TIMEOUT_MS` | `15000` | How long one RCON command may take. |
| `RCON_MAX_RECONNECT_DELAY_MS` | `30000` | Ceiling for the reconnect backoff. |
| `RCON_CHAT_CHANNEL_ID` | - | Optional: mirror in-game chat into this channel. |
| `POLL_INTERVAL_SECONDS` | `20` | One poll drives the status line, `/pop` and the join/leave logs. Floor is 5. |
| `DATA_DIR` | `./data` | Where `/setup` settings are stored (one JSON file per server, mode 0600). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `LOG_TIMESTAMPS` | `true` | Prefix log lines with a UTC timestamp. |
| `PRESENCE_ENABLED` | `true` | Turn the activity line off entirely. |
| `PRESENCE_GUILD_ID` | - | Which server's servers drive the activity line. |
| `PRESENCE_SERVER_SLOT` | `1` | `1`, `2`, `3`, or `all` to add every server together. |
| `PRESENCE_RESTING_ON_RECONNECT` | `false` | Show 🟡 while the bot is reconnecting instead of 🔴. |
| `PRESENCE_ONLINE_FORMAT` | `🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}` | Online template. |
| `PRESENCE_OFFLINE_FORMAT` | `🔴 RCON┆OFFLINE` | Offline template. |
| `PRESENCE_RESTING_FORMAT` | `🟡 RCON┆RESTING` | Restarting template. |

Placeholders: `{players}` `{max}` `{maxPlayers}` `{queued}` `{joining}` `{uptime}` `{servers}`.
Discord renders an activity name on one line and cuts it at 128 characters, so keep templates short.

## Hosting on bot-hosting.net

1. Create a **Node.js** deployment (SFTP or GitHub source).
2. With GitHub, link `ollybat/pop-rcon-discord` (private repos need a personal access token with
   `repo` scope) and turn **auto-pull** on.
3. Set **Startup → Entry File** to `src/index.js`. The panel runs `npm install` from
   `package.json` itself - never upload `node_modules`.
4. Add `.env` in the files tab with at least `DISCORD_TOKEN` (and `RCON_*` if you want slot 1
   ready immediately), then start the deployment.
5. In the Discord developer portal, enable **Message Content Intent** if you want `!pop`.
6. The first start registers the slash commands. Global commands can take up to an hour to appear;
   set `DISCORD_GUILD_ID` to see them instantly.

## Diagnostics

```bash
npm run check     # parse every file as an ES module
npm run doctor    # configuration, stored /setup data, every RCON server, the Discord token
npm test        # unit tests
npm run ci      # unit tests + a real stdio smoke test of the MCP server          # unit + end-to-end tests against a mock WebRCON server
```

`npm run doctor` masks every password and exits non-zero when something is wrong.
See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for the usual failures.

## Project layout

```
src/
  index.js        wiring: Discord client, events, command dispatch, graceful shutdown
  rcon.js         Rust WebRCON websocket client (no Discord knowledge)
  servers.js      one monitor per server: poll, snapshot, join/leave diffing
  presence.js     the three-state status line
  store.js        per-guild settings from /setup (atomic JSON, mode 0600)
  setup/          the wizard: panel.js builds the components, index.js handles them
  commands.js     every command, in slash and !prefix form, plus the access gate
  pop.js          the interactive /pop: embeds plus the switch/refresh/toggle buttons
mcp/server.js     the MCP server: the same Rust servers, for AI clients instead of Discord
  embeds.js       every embed, in the light blue theme
  logs.js         routes events into the log channels
  permissions.js  role/tier checks
  theme.js        brand, palette, tiers, log kinds
  format.js       small formatting helpers
  relay.js        optional in-game chat mirror
```

## License

MIT - see [LICENSE](LICENSE).

# Spinback pop bot

A Discord bot for **Rust dedicated servers** (PC / Steam, not Console Edition) that talks to the
server console over **WebRCON**, shows the live population in its own status line, and gives your
server owner a **/setup** wizard plus one headline command for everybody: **!pop**.

```
🟢 RCON ┆👥 63/200┆⏳Q: 0      <- the bot's "Watching" activity, updated every 20 seconds
```

- **A status line that says exactly one thing** - the bot's own bio is four lines and never rotates:
  `🟢 RCON ┆👥 63/200┆⏳Q: 0`, `🛑 RCON ┆ OFFLINE`, `⏳ RCON ┆ RESTING` (the server is restarting) and
  `⚠️ RCON ┆ PROBLEM` (reachable but unhealthy: silent `serverinfo`, under 20 FPS, or a slow RCON
  round-trip). The ⚠️ state is switched per server in **/setup → 🟢 Status line**, which also
  previews the line the bot is wearing right now. Up to three servers can be added together.
- **/setup wizard** - buttons and dropdowns, no JSON and no config files to hand edit: five staff
  roles, four log channels and up to three servers. Or press **⚡ Quick setup** and it guesses your
  existing roles by name and creates the four log channels for you.
- **!pop** - who is online right now, in one small card: population bar, uptime and latency on the
  header line, the recent shape and today's peak, and the whole roster on a single line with session
  lengths. The buttons under it switch server, refresh on demand and hide the list; **More** opens
  the long version (map, FPS, entities, memory, one line per player) and **Less** folds it back.
- **/lookup** - everything the bot knows, in one answer: the reading, the shape of the last few
  days, the record book, who is on right now, and (for staff) how the bot itself is wired up.
  `/lookup alpha` looks up one player, `/lookup 2` opens on one server.
- **One server only** - the bot answers in the Discord server that owns it and nowhere else. See
  [One bot, one Discord server](#one-bot-one-discord-server).
- **A record book** - the busiest moment of every day is remembered per server, per UTC day, for
  90 days, and shown in `!pop` as today's peak.
- **It says when it stops** - `🔴 Bot stopping` and `🟢 Back online after 8m` in the status channel, so a
  host restart cannot leave you guessing whether the bot is running.
- **A public health endpoint** - the bot also listens on the port your host gives it, so your
  app URL answers instead of showing *"app unreachable"*: `GET /health` returns the live state as
  JSON and `GET /ping` returns `pong`. Handy for uptime monitors and free hosts that like traffic.
- **/ping** - one command that tells the clan owners everything at once: Discord gateway latency,
  the RCON round-trip and player count of every server, bot uptime, build, and what your public URL
  answered. Restricted to the 👑 Owner and 🛡️ Co-Owner roles.
- **An MCP server** - `mcp/server.js` lets Claude Desktop / Claude Code / Codex read the same
  Rust servers directly, no Discord in the middle. See [docs/MCP.md](docs/MCP.md).
- **Logs** - join & leave (with session length), every command, errors, server connects/disconnects,
  and Rust in-game chat (read-only, one-way into Discord). A fault that keeps happening stays **one** message with a running count on it,
  and says `✅ Quiet again` when it stops, so one outage cannot bury the channel.
- **Light blue everywhere** - every embed uses the Spinback palette and footer, and the bot wears
  the name Spinback in your server.

## Branding

Every embed the bot sends ends with **Powered by Spinback** and (once `PUBLIC_URL` is set) carries
the Spinback mark as its thumbnail, served from the bot itself at `GET /logo.png`. The logo lives in
the repository as base64 text (`assets/spinback-logo.b64`) so nothing but text is ever committed,
and it is decoded into memory on the first request.

## Privacy

Nothing about the setup is public, and nothing secret ever leaves the container:

- **/setup is yours alone.** The panel, every button answer, every modal and every **Test** result
  are ephemeral - Discord shows them to the caller and to nobody else. Only the Discord server
  owner (or a bot owner) can open it at all.
- **/ping is private too**, and restricted to 👑 Owner and 🛡️ Co-Owner. Both slash commands always
  answer ephemerally.
- **Prefix commands that are private answer in a DM.** `!ping` from the owner never appears in the
  channel; if DMs are closed the bot replies with a short note instead of the report.
- **RCON passwords are never rendered.** The panel shows them masked (`hu***r2`), and a scrubber
  removes the password from every error, status and command-log line before it is posted - including
  the `ws://host:port/<password>` URL shape that Rust uses.
- **The 📡 Server Status channel says a server is connected, never its address.**
- **The public health endpoint** (`/health`) only ever returns: bot tag, version, uptime, gateway
  ping, guild count and per-server player counts. No host, no port, no password.
- **`!pop` and `/lookup` are public on purpose** - the population and the record book are for the
  whole clan - and neither contains a server address or a secret. The part of `/lookup` that shows
  your roles and channels is printed only for 👑 Owner and 🛡️ Co-Owner.
- **Other Discord servers get a refusal, not a service.** The `🔒` card says the bot belongs to one
  server, nothing from the stranger is stored, and the host log records that it was turned away.

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

`/setup` opens a private panel with a summary and three rows of buttons: **Roles**, **Logs**,
**Servers**, **Refresh** and **Done** on the first, the one-press helpers and the guide on the
second, and the tests plus **🟢 Status line** and **📌 Live board** on the third.

| Button | What it does |
| --- | --- |
| 🎭 Roles | 👑 Owner (required), 🛡️ Co-Owner, ⚔️ Head Admin, 🔧 Admin, 🔨 Moderator |
| 📋 Logs | 🚪 Join & Leave, ⌨️ Command Log, 🚨 Error Log, 📡 Server Status |
| 🖥️ Servers | Up to three servers: name, IP/host, RCON port, RCON password, with a **Test** button |
| ⚡ Quick setup | Fills in what it can: 🪄 guesses your roles by name + 📁 builds a category with the four log channels |
| 🪄 Guess roles | Matches Owner / Co-Owner / Head Admin / Admin / Mod roles you already have |
| 📁 Make channels | Creates \`🎧 Spinback\` with 🚪・joins-leaves, ⌨️・staff-commands, 🚨・bot-errors, 📡・server-status |
| 📖 Guide | The one-page "how do I turn RCON on" walkthrough with the exact start line |
| 🟢 Status line | The bot's bio: the four lines it can wear, the one it is wearing right now, and the ⚠️ PROBLEM switch |
| 📌 Live board | The self-updating population board, the daily digest and the alert switches |
| 🧪 Test channels | Posts one sample of every log embed so you can check the channels before the clan sees them |
| 🔄 Refresh | Reconnects and re-reads every server |
| ✅ Done | Checklist of what is configured and what is still missing |
| 🧹 Reset | Wipes every saved role, channel and server for this Discord server |

Only the **Discord server owner** (or a **bot owner** listed in `BOT_OWNER_IDS`) can use `/setup`.
Everyone else only ever needs `!pop`. The five staff roles you pick in the panel are the bot's
record of your clan ranks (they feed the panel's readiness checklist); there are no role-gated
commands to keep in sync any more.

## Commands

| Slash | Prefix | Who | What it does |
| --- | --- | --- | --- |
| `/setup` | - | Server owner / bot owner | Opens the setup panel. |
| `/ping` | **`!ping`** | 👑 Owner / 🛡️ Co-Owner | The dashboard: gateway ping, uptime, build, RAM, every server's RCON round-trip with players and queue, the runtime counters (polls, commands, DMs, errors), the last problem, the configuration state and your public URL's answer - with a 🔄 button to check again. |
| `/lookup` | **`!lookup`** | Everyone | The dossier: live reading, trend line, record book, the whole roster and (for 👑/🛡️) how the bot is configured here. `lookup player:<name>` finds one player by name, `lookup server:2` opens on one server, and `!lookup 2` is the same thing in prefix form. |
| - | **`!pop`** | Everyone | Live population, queue, uptime, today's peak and the player list, with buttons to switch server, refresh and hide the list. `!pop 2` opens on one server, `!pop 2 off` hides the names, and the **More/Less** button switches between the full report and a compact one. |
| - | **`!reply`** (in a DM) | 👑 Owner / 🛡️ Co-Owner | Answers somebody who DM'd the bot: `!reply <user id> <your answer>`. Only works for people who wrote in the last 24 hours. |

That is the whole list. The slash menu holds `/setup`, `/lookup` and `/ping`; `!pop` stays prefix
only on purpose. The bot clears anything else it may have registered before, so nothing shows up
twice.

`!pop` is public, which is what you want for a population report. It needs
`PREFIX_COMMANDS_ENABLED=true` (the default) and the **Message Content Intent** enabled in the
Discord developer portal.

## One bot, one Discord server

The bot serves exactly one Discord server at a time, so an invite from somewhere else is a
no-op rather than a second tenant. There are two ways to say which server that is:

| | |
| --- | --- |
| **`ALLOWED_GUILD_IDS`** | The exact server id(s), comma separated. The strictest answer, and the one to use when you know it. |
| **A saved `/setup`** | Leave `ALLOWED_GUILD_IDS` empty and the bot locks itself to the server whose configuration has been saved. Before anything is saved it is **open**, because nobody has claimed it yet - the first `/setup` claims it, no restart needed. |
| **`LEAVE_UNKNOWN_GUILDS=true`** | Optional, and off by default: the bot also leaves any other server it is invited to, instead of only refusing to work there. |

What a stranger's server sees: one private `🔒 This bot belongs to one server` card if somebody
runs a command there, and if the bot is invited it answers in the system channel instead of
sending the setup guide. What it does **not** do: store a configuration for that server, relay
its channels, answer `!pop`, or ask for a server address. The host log gets one `[access]` line.

If two servers ever have a saved setup, the bot logs a warning naming `ALLOWED_GUILD_IDS` - that
is the case where you want to be explicit rather than rely on the claim.

## When the bot is invited

The server owner is **DM'd the setup guide** immediately, because an invite with no setup is a bot
that does nothing. The guide is three private embeds and is never posted in a channel:

1. what the bot does, what it gives you once a server is added, and the promise that the RCON
   password never leaves your private settings;
2. the three steps — **Servers** (fill in and press Test), **Roles**, **Logs** (pick or make channels,
   then **Test channels**) — plus the exact line your Rust server must start with;
3. the five failures that actually happen: timeout or connection refused, a password that does not
   match, a missing **Message Content Intent** for prefix commands, a missing
   `applications.commands` scope, and how to reach a person.

If the owner does not accept DMs, the bot says so once in the server's system channel instead of
dropping it. The guide can be re-sent at any time with **📬 DM me the guide** in `/setup`.

## What a pop answer tells you

Every answer is built from the last reading and from a short history the bot keeps in memory (30
readings per server, nothing written to disk):

- **how full it is** — the bar, `12/100` and the percentage;
- **which way it is going** — `▲ +3` against the reading before it;
- **what the last few minutes looked like** — `▁▂▄▆█`, the average, and the busiest reading in that
  window with its time;
- **what the server is running** — map, frame rate, entities, memory;
- **who is on** — sorted by session length, each with a latency dot (🟢 under 80 ms, 🟡 under 150 ms,
  🔴 above) and a ✨ for anyone who arrived in the last two minutes;
- **the day's peak** — with the best recorded day when there is one.

Timestamps are Discord timestamps, so they read in your own timezone. `/ping` adds the bot's own
counters (polls, commands, DMs passed on, errors) and warns you when the public URL answers with a
different version than the one running — the usual sign that a redeploy has not happened yet.

## The daily digest

One short post a day, in a channel you pick, that reads the numbers the bot already keeps: the
busiest moment it saw yesterday, whether that is up or down on the day before, the average of the
last `DIGEST_WINDOW_DAYS` days against the window before that, and the best day recorded so far.

It is **off until you switch it on** (`/setup` → 📌 **Live board**):

- **pick the channel** with the 📊 selector;
- **📊 Digest on/off** starts and pauses it;
- **🕗 Send at 20:00 UTC** moves the hour, one press at a time (or set `DIGEST_HOUR`);
- **👀 Preview it** shows exactly what would be posted, privately, before anyone sees it.

Everything in it comes from the bot's own readings — one line per server per day, the busiest
moment it saw — and nothing is inferred from them. That has two consequences worth knowing:

- a day the bot was not watching is reported as **no reading**, never as a zero;
- a week without enough recorded days says so instead of printing a misleading average.

If the bot is offline when the hour comes round, the digest goes out at the next start instead of
being skipped. A post that fails (the channel was deleted, permissions changed) is logged once and
retried on the next pass — the day is only marked as sent after it actually went out.
## When something is wrong

A clan server that dies quietly at 3 am is the expensive kind of problem, so the bot watches for it.

**Outage alerts.** If a server has not answered `serverinfo` for `ALERT_DOWN_AFTER_MINUTES` (5 by
default), the bot posts one branded message to your **status** log channel and sends the guild owner
a direct message: how long it has been down, the last error, and the three things worth checking —
a restart in progress, the RCON port not reachable from outside (it must be **TCP** and must not be
the game port), or a start line that lost `+rcon.web 1` or changed the port/password. When the server
answers again, one more message says how long the outage lasted.

The rules are deliberately dull, because a false alarm is worse than a late one: the server must have
been seen up at least once (a typo in /setup never becomes an alarm), the outage must pass the
threshold, and each outage is reported exactly once in each direction. Short blips are silent. Set
`ALERT_DM_OWNER=false` to keep it to the log channel, or switch 🚨 off per server in
`/setup` → 📌 **Live board**.

**Restarts and wipes.** Rust reports uptime in seconds, so an uptime that goes *backwards* means the
server restarted underneath the bot — even if it restarted while the bot was disconnected. The bot
announces how long it had been up, and adds a hint when the entity count collapsed at the same
moment: *"this looks like a fresh map"*. That is a heuristic, and it is worded as one. `/pop` shows
a 🔄 Restarted field for the next half hour, then it is history.

**Verdicts instead of raw numbers.** `/ping` opens with the worst server in the fleet
(`🟢 every server answers`, `📴 1 of 2 not answering`) and labels every server:

| Verdict | Means |
| --- | --- |
| 🟢 healthy / idle / full | It answered, and nothing about the reading is worrying |
| 🟠 working hard | Framerate under 20 or an RCON reply slower than 1.5 s — with the reading shown |
| 🟡 restarting | Rust is between restarts; the map is loading |
| 🤔 serverinfo silent | The RCON session is up but the command did not answer in time |
| 📴 not answering | No RCON session at all, with the last error |

A strained verdict also says why not to worry: *"that is the map and its population, not the Discord
bot"*. The thresholds are constants in `src/health.js`, and every verdict carries the number it came
from, so nobody has to trust a colour.
## Direct messages

Somebody who DMs the bot is answered with a short note saying who the bot is, that the clan
owners have been told, and what to use in the server (`!pop`, `/ping`, `/setup`). The message
itself goes to the people who can act on it:

- a **DM to every owner** of the servers you share with the sender, plus `BOT_OWNER_IDS` and
  `DM_FORWARD_IDS` - so nothing waits for somebody to log in;
- a copy in the **command log channel**, when `/setup` set one, so the rest of staff see it;
- an embed titled **🙋 Help request from ...** when the message reads like a question
  (help/ban/whitelist/offline/...), otherwise **✉️ New DM from ...**.

The embed carries the sender's username and id, which servers you share, the time, and a ready
line to answer: `!reply <user id> <your answer>`. The bot then DMs your answer to them - it only
does this for people who actually wrote in (24 hours), so nobody can aim the bot at strangers.

Guards: one automatic answer per person per `DM_REPLY_COOLDOWN_SECONDS` (5 minutes by default),
at most 10 forwarded messages per person per 15 minutes, long messages shortened, and secrets
scrubbed out of the text. People who are in none of your servers only get the answer - set
`DM_FORWARD_STRANGERS=true` if you want those too. Slash commands in a DM are refused with a
pointer to the server instead of failing silently.

## What ends up in the log channels

| Channel | Receives |
| --- | --- |
| 🚪 Join & Leave | One embed per player, with ping and session length when they leave. A restart-sized change becomes a single summary instead of a wall of messages. |
| ⌨️ Command Log | Every command: who ran it, their tier, the options, how long it took and any error. |
| 🚨 Error Log | RCON failures, permission problems and unhandled errors. |
| 📡 Server Status | Connects and disconnects, plus every change made in `/setup`. |

## Testing the setup

Inside `/setup`, **Test channels** posts one sample embed into every configured log channel and
tells you which ones it could write to; **Health check** re-reads every server. In the Logs view the
same test is the **Send test** button. Nothing in a test message is secret.

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
| `ALLOWED_GUILD_IDS` | - | The Discord server id(s) this bot serves, comma separated. Empty means it locks itself to the server whose `/setup` is saved. |
| `LEAVE_UNKNOWN_GUILDS` | `false` | Also leave a server the bot was invited to but does not serve, instead of only refusing to work there. |
| `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`, `RCON_NAME` | - | Shortcut for server slot 1. |
| `RCON_TIMEOUT_MS` | `15000` | How long one RCON command may take. |
| `RCON_MAX_RECONNECT_DELAY_MS` | `30000` | Ceiling for the reconnect backoff. |
| `RCON_CHAT_CHANNEL_ID` | - | Optional: mirror in-game chat into this channel. |
| `WEB_ENABLED` | `true` | Serve `GET /health` (JSON) and `GET /ping` (`pong`) on the port your host gives you. |
| `WEB_PORT` | `SERVER_PORT` | Port for the health endpoint. `0` lets the OS choose; unset `WEB_ENABLED` to turn it off. |
| `PUBLIC_URL` | – | The public address of your app, e.g. `https://nyksp9z6p1.apps.bot-hosting.cloud`. `/ping` calls it and reports the status and latency. |
| `POLL_INTERVAL_SECONDS` | `20` | One poll drives the status line, `!pop` and the join/leave logs. Floor is 5. |
| `BOARD_INTERVAL_SECONDS` | `30` | How often the live board and live `/pop` answers refresh. Floor is 15. |
| `BOARD_FORCE_SECONDS` | `300` | Refresh anyway after this long, so "last reading" never goes stale. |
| `BOARD_LIVE_MINUTES` | `20` | How long 🔴 Keep live keeps a message updating. |
| `ALERT_DOWN_AFTER_MINUTES` | `5` | How long a server must be unreachable before anyone is told. |
| `ALERT_DM_OWNER` | `true` | Also DM the guild owner about an outage and its recovery. |
| `DIGEST_HOUR` | `20` | The UTC hour the daily digest goes out, unless a guild picked its own. |
| `DIGEST_WINDOW_DAYS` | `7` | How many days the week-over-week comparison covers. |
| `DATA_DIR` | `./data` | Where `/setup` settings are stored (one JSON file per server, mode 0600). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `LOG_TIMESTAMPS` | `true` | Prefix log lines with a UTC timestamp. |
| `PRESENCE_ENABLED` | `true` | Turn the activity line off entirely. |
| `PRESENCE_GUILD_ID` | - | Which server's servers drive the activity line. |
| `PRESENCE_SERVER_SLOT` | `1` | `1`, `2`, `3`, or `all` to add every server together. |
| `PRESENCE_RESTING_ON_RECONNECT` | `false` | Show ⏳ while the bot is reconnecting instead of 🛑. |
| `PRESENCE_ONLINE_FORMAT` | `🟢 RCON ┆👥 {players}/{max}┆⏳Q: {queued}` | Online template. |
| `PRESENCE_OFFLINE_FORMAT` | `🛑 RCON ┆ OFFLINE` | Offline template. |
| `PRESENCE_RESTING_FORMAT` | `⏳ RCON ┆ RESTING` | Restarting template. |
| `PRESENCE_PROBLEM_FORMAT` | `⚠️ RCON ┆ PROBLEM` | Reachable-but-unhealthy template. |
| `PRESENCE_PROBLEM` | `true` | Fallback for the ⚠️ state; each server switches it in `/setup` → 🟢 **Status line**. |

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
npm run ci      # unit tests + a real stdio smoke test of the MCP server, writes ci-report.txt          # unit + end-to-end tests against a mock WebRCON server
```

`npm run doctor` masks every password and exits non-zero when something is wrong.
See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for the usual failures.

## Project layout

```
src/
  index.js        wiring: Discord client, events, command dispatch, graceful shutdown
  rcon.js         Rust WebRCON websocket client (no Discord knowledge)
  servers.js      one monitor per server: poll, snapshot, join/leave diffing
  presence.js     the three-state status line, and its rotating frames while online
  store.js        per-guild settings from /setup (atomic JSON, mode 0600)
  setup/          the wizard: panel.js builds the components, index.js handles them
  commands.js     every command, in slash and !prefix form, plus the access gate
  pop.js          the interactive !pop: embeds plus the switch/refresh/toggle/live buttons
  board.js        the live board and the live /pop answers: one ticker, one edit per change
  watch.js        outages that last, and the recovery afterwards
  health.js       the numbers Rust reports turned into a verdict with a reason
  digest.js       the daily digest: yesterday, the week, the best day, and the gaps
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

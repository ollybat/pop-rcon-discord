# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] — the bot notices when something is wrong

The same commands, the same privacy rules: still read-only, the address still only in /setup, still
no player history. What changed is how much the bot understands from the numbers it already had.

### Added
- **Outage alerts.** If a server does not answer for 5 minutes (configurable) the bot says so once,
  in the status log channel and by direct message to the guild owner, with the last error and the
  three things worth checking. When it comes back it says that too. Short blips stay quiet, and a
  server that was never seen up is never called down, so a typo in /setup does not turn into an alarm.
- **Restart and wipe detection.** An uptime that goes backwards means the server restarted; the bot
  announces how long it had been up, and mentions when the save suddenly holds a fraction of the
  entities it did — offered as "this looks like a fresh map", not as a fact. The pop answer carries
  the restart for half an hour, then it stops being news.
- **Verdicts instead of raw numbers.** `/ping` now leads with the worst server in the fleet and
  labels each one 🟢 healthy / 🟢 idle / 🟠 working hard / 🟡 restarting / 📴 not answering, with the
  readings behind a bad verdict (`9 fps`, `RCON answered in 2400 ms`) and the reason not to panic
  ("that is the map and its population, not the Discord bot").
- **Switches** in /setup → 📌 Live board: 🔔 milestones and 🚨 outages can be turned off separately.

### Configuration
- `ALERT_DOWN_AFTER_MINUTES` (5), `ALERT_DM_OWNER` (true).
## [0.10.0] — the report keeps itself current

Everything here is about the answers you already have, not new commands. Nothing became public that
was private, the server address is still only in /setup, and the bot still cannot touch the game.

### Added
- **Live board** (`/setup` → 📌 **Live board**): pick a channel and one message there keeps itself up
  to date — population, queue, uptime, the day's peak and the shape of the last readings. Edits are
  skipped when nothing changed, and a deleted message is re-posted instead of going quiet.
- **🔴 Keep live** on any `/pop` answer: that one message refreshes itself (20 minutes by default,
  then it stops and says so). Press it again to stop early.
- **Milestone announcements** (`🔔`/`🔕` in the same view): a new record for the day, the server
  filling up and the queue starting are posted to your status log channel. Once per event, never a
  stream of them.
- **A rotating activity line**: while the server is online the bot's status cycles through
  population, queue/uptime and the day's peak instead of repeating one number. `PRESENCE_ROTATE=false`
  turns it off.

### Changed
- The board and the live answers carry a small `-# ` line saying what refreshes them and when they stop.
- `/pop` answers gained a fourth button in the action row; the board's own message has no live button,
  since it is already live.

### Configuration
- `BOARD_INTERVAL_SECONDS` (30), `BOARD_FORCE_SECONDS` (300), `BOARD_LIVE_MINUTES` (20),
  `PRESENCE_ROTATE` (true).
## [0.9.0] - the bot introduces itself when it is invited

### Added

- **The guild owner gets a setup guide in their DMs the moment the bot is invited** (`src/onboarding.js`).
  Three branded embeds, private, and never posted anywhere: what the bot does and what it gives you;
  the three steps that make it useful (**Servers → Test**, **Roles**, **Logs → Test channels**) with the
  exact Rust start line (`+rcon.web 1 +rcon.ip 0.0.0.0 +rcon.port 28016 +rcon.password "..."`); and the
  five failures that actually happen — timeout or refused (RCON off or port blocked, and it was maybe
  the game port), mismatched password, no Message Content Intent, a missing `applications.commands`
  scope, and how to reach a person with `!reply`.
- **A closed DM is not a dead end**: if the owner does not accept DMs, the bot says so once, in the
  server's system channel, and points at `/setup` and its Guide button.
- **📬 DM me the guide** in the setup panel, so the guide can be re-sent at any time (owner only).
- The direct-message answer now knows when it is talking to an owner and says so, instead of promising
  to forward the message to the person who sent it.

### Changed

- The guide is sent once per guild per run, and never twice.

## [0.8.0] - every answer is a proper report

### Added

- **Recent history in memory** (`src/history.js`): the last 30 readings per server drive a trend
  arrow (`▲ +3`), a one-line shape (`▁▂▄▆█`), the average and "busiest in this window". Nothing is
  written to disk — the durable part is still the daily peak in the guild config.
- **Runtime counters** (`src/stats.js`): polls, commands, DMs passed on, DMs answered, new peaks,
  errors and the last failure. They show up in `/ping` and in `/health`.
- **`/pop` says more**: percentage next to the bar, direction against the previous reading, the
  recent shape with the average and the busiest moment, memory, and a roster sorted by session
  length with a latency dot per player plus ✨ for anyone who arrived in the last two minutes.
- **`/pop` is interactive**: a **More/Less** button switches between the full report and a compact
  one, next to the existing refresh, server switch and player-list toggles. `/pop` gained a
  `details` option.
- **`/ping` became a dashboard**: gateway ping, uptime, build, RAM, node version, every server's
  RCON round-trip with players/queue/uptime and when it was read, the runtime counters, the last
  problem, the guild's configuration state and the public URL — including a warning when the URL
  answers with a **different version** than the one running.
- **A 🔄 Check again button** on `/ping`, guarded by the same owner/co-owner rule as the command.
- **🧪 Test channels** in the setup panel (and **Send test** in the Logs view): posts one sample
  embed per configured log channel and reports which ones worked.
- **🎯 Next step** in the setup panel, and a live state next to each configured server
  (🟢 12/100, 🔴 offline).
- `sparkline`, `relative`, `shortTime`, `trendArrow` and `percent` helpers, plus `versionFrom` for
  reading the version out of a `/health` body.

### Changed

- Every timestamp in the rich answers is a **Discord timestamp** (`<t:...:R>`), so it reads in the
  reader's own timezone instead of a UTC string.
- `/health` now reports `stats` and, per server, the `trend`, `average` and a short `shape` of the
  recent readings.
- The setup panel passes live snapshots to its server list, so the panel shows what the servers are
  doing without leaving the wizard.

### Fixed

- A `null` reading is no longer silently treated as `0` (the sparkline skipped it, the trend arrow
  read it as "no change" and the percentage printed `0%`).

## [0.7.0] - direct messages: answer the sender, ask the owners

### Added

- **Direct messages are handled now.** Whoever DMs the bot gets a branded answer: who it is,
  that the owners have been told, and the three things worth knowing (`!pop`, `/ping`, `/setup`).
- **The message is passed to the owner instead of being lost.** It arrives as a DM to every owner
  of the servers you share with the sender, plus `BOT_OWNER_IDS` and `DM_FORWARD_IDS`, and as a
  copy in the command log channel when one is configured.
- **`!reply <user id> <your answer>`** lets an owner answer from their own DMs; the bot delivers it
  to the member. It only works for people who wrote in during the last 24 hours.
- New embeds: `dmAutoReplyEmbed`, `dmForwardEmbed`, `dmRelayEmbed`, `dmRelayUsageEmbed` - all with
  the `Powered by Spinback` footer and the logo.
- The forward embed says whether it reads like a question (title *🙋 Help request from ...*) or is
  just a message (*✉️ New DM from ...*), with the sender, their id, shared servers and the time.
- New settings: `DM_ENABLED`, `DM_FORWARD_IDS`, `DM_FORWARD_STRANGERS`, `DM_REPLY_COOLDOWN_SECONDS`.

### Changed

- The bot asks for the **Direct Messages** intent (and keeps Message Content) whenever
  `DM_ENABLED` or prefix commands are on.
- Slash commands used in a DM now answer with a hint to use them inside the server.

### Fixed

- A DM, an empty message or an attachment on its own can no longer fall through the message
  handler unnoticed.

## [0.6.4] - one brand line everywhere, and a lot more in every answer

### Changed

- **Every embed now ends with the same line: `Powered by Spinback`.** The old per-embed footers
  (server names, guild names, latency, "🔒 Private — …", "Console Edition has no RCON") are gone; the
  information they carried moved into the embed body, where it is easier to read.
- **The Spinback mark rides along.** A `PUBLIC_URL` now also means every embed gets the logo as its
  thumbnail, served by the bot itself at `GET /logo.png`. The image is stored in the repository as
  base64 text (`assets/spinback-logo.b64`) so the source stays plain text, and decoded once in memory.
- **`/pop` is much richer**: population bar with a percentage, queue, uptime, RCON round-trip with
  the time of the reading, the map name, the server's frame rate and entity count, today's peak, and
  the roster. The network summary now lists every server on its own line with its own player count.
- **`serverinfo` now keeps `Map`, `Framerate`, `EntityCount` and `Memory`**, so the bot (and the MCP
  server, which reports them too) has something to show beyond the player count.
- Join and leave logs use the server as the embed author and put the session length in bold; the
  command log shows which server it happened in; error logs name their source in the title.
- The `/setup` panel, the guide and the welcome message lost their footer text but kept every word
  of the privacy and Console Edition notes - in the body.

## [0.6.3] - private setup, better commands

### Added

- **The health endpoint is documented and the panel says it is private**: `/setup` now spells out
  that the panel, every answer and every test result are visible to the server owner alone, and
  `/ping` carries a *🔒 Private* footer.

### Changed - nothing about the setup can leak any more

- **`scrubSecrets()`** in `format.js`: strips the password out of a `ws://host:port/<password>`
  URL and out of any text it is handed.
- `LogRouter.error()` and `status()` run every message, context and stack through that scrubber
  with the guild's own stored passwords, so a log channel can never show one.
- `errorEmbed`, `errorLogEmbed` and the public `!pop` embed (which prints the RCON error when a
  server is unreachable) are scrubbed as well.
- **Prefix commands marked `private` answer in a DM.** `!ping` used to print the clan's server
  names and latencies into the channel; it no longer can. If DMs are closed the bot replies with a
  short note instead of the report.
- **The 📡 Server Status channel no longer repeats `host:port`** - it says the server is connected
  and leaves the address in `/setup`.

### Changed - command polish

- `/ping` gained a **🧩 Runtime** line (poll interval, RAM, node version) and reports the gateway
  ping, uptime, build, every server's RCON round-trip and the public URL in one private answer.
- `!pop`'s summary footer now says how fresh it is (`refreshed every 20s`).
- The setup panel's *Ready* line no longer claims role-gated staff commands exist.

## [0.6.2] - /ping, and an app URL that answers

### Added

- **`/ping`** (and `!ping`) - the clan owners' health check in one ephemeral reply: Discord
  gateway latency, the RCON round-trip and player count of every configured server, bot uptime,
  build, and what the public URL answered. Gated to the 👑 **Owner** and 🛡️ **Co-Owner** roles
  (the Discord server owner and bot owners always pass, as everywhere else).
- **A public health endpoint** (`src/web.js`). The bot now listens on the port the host provides
  and answers `GET /health`, `/status`, `/healthz` and `/` with the same facts as JSON, plus
  `GET /ping` with the bare word `pong`. That is what turns the free host's
  *"502 / app unreachable"* page into a real endpoint, and it gives uptime monitors something to
  poll. `WEB_ENABLED`, `WEB_PORT`, `WEB_HOST` and `PUBLIC_URL` configure it; a port clash is
  logged and never stops the bot.
- `probeHealth()` - a fetch with a timeout that reports `{ ok, status, ms, error }` instead of
  throwing, so `/ping` can report a dead URL as calmly as a live one.

### Changed

- `runCommand`` now puts the Discord client and the web settings on the command context, which is
  how `/ping` reads the gateway ping and the public URL.

## [0.6.1] - trimmed to the two commands the clan actually wants

### Changed

- **The bot now serves exactly two commands: `/setup` and `!pop`.** Everything else is gone from
  both forms: `/pop`, `/status`, `/board`, `/help`, `/players`, `/say`, `/kick`, `/save`,
  `/ban` and `/console`, plus their `!prefix` twins. The setup panel, the status line, the log
  channels, the record book (kept in the store and visible as *today's peak* in `!pop`) and the MCP
  server all stay.
- **The slash menu can no longer show an entry twice.** On startup the bot overwrites the slash
  command list in the guild *and* empties the global scope, so a stale global `/setup` cannot sit
  next to the guild copy. With no `DISCORD_GUILD_ID` it registers the two commands globally and
  clears the per-guild scope in every server it is in.
- The five staff roles stay in `/setup` as the bot's record of your clan ranks; no command enforces
  them any more, so there is nothing to keep in sync by hand.
- README, SETUP and TROUBLESHOOTING rewritten around the two-command bot.

## [0.6.0]

A record book, and an MCP server so the same servers can be read without Discord.

### Added

- **Spinback record book**: `recordPeak` now keeps the all-time best and the last
  `HISTORY_DAYS` (90) days per server slot, in the same per-guild file (config version 3, older
  files load as usual). `bestFor`, `historyFor` and `topDays` read it back.
- **`!board`** / `/board` - best day ever, today, and the busiest days this server has seen.
- **`!save`** / `/save` - ask a Rust server to save the world over RCON (`server.save`). Admin and
  up.
- **`mcp/server.js`** - a zero-config Model Context Protocol server over stdio, so Claude Desktop,
  Claude Code, Codex or Cursor can ask about the same Rust servers the bot watches:
  `list_servers`, `server_status`, `players`, `pop_report`, `records`, `server_save`,
  `broadcast` and - only with `--allow-rcon` - a raw `rcon` tool. Credentials come from the
  `/setup` data directory or the `RCON_*` variables; nothing else is needed. See `docs/MCP.md`.
- **`npm run ci`** (`scripts/test-all.js`) - runs the unit tests and then really starts the MCP
  server on stdio, sends `initialize` / `tools/list` / `tools/call` down the pipe and checks the
  answers. Handy as a one-shot start command on a host.

### Fixed

The whole suite was run for real for the first time on Node 24 with real `discord.js`, and it
found seven genuine bugs. Every one is fixed, and `npm run ci` now covers them:

- **Every poll reported a phantom join and leave for every player.** `ServerMonitor.refresh()`
  handed its internal player Map to `diffPlayers`, which expects the roster array, so each poll
  produced a join and a leave for everyone online. The join & leave log channel would have been
  pure noise.
- **A dropped socket kept showing players until the next poll.** The snapshot now goes
  `connected: false` the moment the RCON socket closes, so the status line turns red straight away.
- **Two polls could run at once** (the interval plus a `/pop` refresh), which is what made the first
  tests flaky. Polls are single-flight now, and `start()` seeds the roster before the interval
  begins.
- `duration(null)` returned `0s` instead of `—`, so a server that does not report uptime showed
  "0s uptime".
- `quoteArgument('say "hi"')** doubled the spaces instead of collapsing them.
- A mistyped `RCON_PORT` was silently ignored unless `RCON_HOST` and `RCON_PASSWORD` were also set.
- `/status` printed the peak of the day without saying what it was; it is labelled now.

### Changed

- `/help` documents the two new commands, and the peak history replaced the earlier today-only
  statistics.

## [0.5.1]

`!pop` is the headline command.

### Changed

- `/help`, the welcome message and the README now show the **prefix form first** — `!pop`,
  `!status`, `!players`, `!kick` … — with the slash twin named as the alternative, and `!pop` is
  described as the normal way to ask for the population.
- The `!` form and `/pop` share one implementation, so the buttons, the peak line and the
  multi-server summary are identical either way: `!pop`, `!pop 2`, `!pop all`, `!pop 2 off`.

## [0.5.0]

Making setup one click and /pop alive.

### Added

- **`/setup` ⚡ Quick setup** - guesses the staff roles from the role names already in the server
  (`matchRolesByName` in `src/permissions.js`) and creates a `🎧 Spinback` category with the four
  log channels (`createLogChannels`), then reports exactly what it did and what is left.
- `/setup` **🪄 Guess roles**, **📁 Make channels**, **📖 Guide**, **🧹 Reset** and a **Test** button
  per server; the guide embed carries the exact `+rcon.web 1` start line.
- `src/pop.js` - interactive population: **/pop** answers with buttons to switch server, refresh on
  demand and show or hide the player list, plus the summary embed for several servers.
- `/status` and `/help`, both for everyone, in slash and prefix form.
- Daily peaks: `recordPeak` / `peakFor` / `dayKey` in `src/store.js` remember the busiest moment of
  each UTC day per server (config version 2, old files still load) and `/pop` + `/status` show them.
- A welcome embed in a new server (with `/setup` instructions) and the bot renames itself to
  `Spinback` where it is allowed to.
- Tests for peaks, role guessing and the whole pop surface.

### Changed

- `.env.example` is now `/setup`-first: `DISCORD_TOKEN` is the only required value, and the
  `RCON_*` block is documented as an optional shortcut for slot 1.
- `src/embeds.js` gained `guideEmbed`, `statusEmbed`, `helpEmbed`, `welcomeEmbed` and `peakLine`.
- `ServerManager` forwards every snapshot, which is what records the peaks.

## [0.4.0]

The Spinback release: a setup wizard, a population command and role-gated staff tools.

### Added

- `src/theme.js` - brand, the light blue palette, the five staff tiers and the four log kinds.
- `src/store.js` - per-guild `/setup` settings, one atomic JSON file per guild (mode 0600),
  with validation and `normalizeServerInput`.
- `src/permissions.js` - tier lookup and the single `canRun` gate (owner-only, minimum tier,
  bot owners).
- `src/servers.js` - `ServerMonitor` (poll, snapshot, join/leave diffing with session length) and
  `ServerManager` (up to three servers per guild, live reconfiguration, `/pop` refreshes).
- `src/setup/panel.js` and `src/setup/index.js` - the `/setup` wizard: roles, log channels and
  servers, with test-connection feedback.
- `src/commands.js` - every command in slash and `!prefix` form plus the access gate.
- `src/embeds.js` - every embed in the light blue theme.
- `src/logs.js` - a queued router for the join/leave, command, error and status channels.
- `src/format.js`, `src/prefix.js` - small helpers and prefix parsing.
- Commands: `/setup`, `/pop` (`!pop`), `/players`, `/say`, `/kick`, `/ban`, `/console`.
- Optional in-game chat mirror via `RCON_CHAT_CHANNEL_ID`.
- Tests for the store, permissions, formatting, embeds, commands, servers and a full
  mock-RCON end-to-end run.

### Changed

- `src/index.js` now wires the store, the monitor, the presence, the log router, the wizard and
  the command dispatcher; `!prefix` commands are on by default.
- `src/presence.js` takes a snapshot provider, so the status line, `/pop` and the logs all share
  one poll per server. Aggregating servers is supported with `PRESENCE_SERVER_SLOT=all`.
- `src/config.js` gained `DISCORD_GUILD_ID`, `BOT_OWNER_IDS`, `DATA_DIR`,
  `POLL_INTERVAL_SECONDS`, `PREFIX_COMMANDS_ENABLED`, `RCON_CHAT_CHANNEL_ID` and the optional
  `RCON_*` slot-1 shortcut; `RCON_HOST`/`RCON_PASSWORD` are no longer required.
- `scripts/doctor.js` now checks the stored `/setup` data, every configured server and every
  saved log channel.
- `README.md` and `docs/TROUBLESHOOTING.md` rewritten for the wizard; added `docs/SETUP.md`.

### Removed

- `src/summary.js` and its test (replaced by `src/format.js` and the per-module tests).

## [0.3.0]

### Added

- `src/logger.js` - leveled, timestamped logging with `LOG_LEVEL` and `LOG_TIMESTAMPS`.
- `src/relay.js` - the Discord relay extracted from `src/index.js`, with a channel cache and a
  single place that formats chat lines.
- `src/summary.js` - password masking and human-readable `serverinfo` summaries.
- `scripts/doctor.js` (`npm run doctor`) - checks the configuration, connects to RCON, prints
  `serverinfo` and `playerlist`, verifies the Discord token and exits non-zero on failure.
- `scripts/check.js` (`npm run check`) - parses every file with `node --check` as an ES module.
- `test/helpers/mock-rcon-server.js` - shared mock WebRCON server.
- `test/e2e.test.js`, `test/logger.test.js`, `test/summary.test.js`, `test/config.test.js`.
- `docker-compose.yml`, `deploy/pop-rcon-discord.service`, `.nvmrc`, `.editorconfig`,
  `docs/TROUBLESHOOTING.md`, `CONTRIBUTING.md`, `SECURITY.md`.

### Changed

- `src/index.js` now uses the logger and the relay class instead of inline console calls.
- `test/rcon.test.js` uses the shared mock server and covers reconnect behaviour.

## [0.2.0]

### Added

- `src/presence.js` - the status state machine and the "Watching" activity updater, plus
  `PRESENCE_*` options and templates.
- `test/presence.test.js`.

### Removed

- The slash command layer and its formatting helpers, all command registration and the related
  options (`COMMAND_ROLE_IDS`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`).

## [0.1.0]

### Added

- `src/rcon.js` - Rust WebRCON websocket client with identifier matching and reconnect backoff.
- `src/config.js` - environment parsing and validation.
- `src/index.js` - Discord client, chat relay and graceful shutdown.
- `test/rcon.test.js`, `README.md`, `Dockerfile`, `LICENSE`.

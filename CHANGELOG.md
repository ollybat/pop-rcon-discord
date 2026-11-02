# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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

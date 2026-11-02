# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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

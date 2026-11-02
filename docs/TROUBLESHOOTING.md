# Troubleshooting

Start with the built-in diagnostic. It checks the configuration, the stored `/setup` data, every
RCON server, `serverinfo`, `playerlist` and the Discord token in one pass:

```bash
npm run doctor
```

It prints one line per check and exits non-zero if something is wrong. Secrets are masked, so the
output is safe to share. `npm run check` parses every file as an ES module when you want the plain
syntax check.

## The bot logs `connect failed` for a server

The websocket to `ws://host:port/<password>` was refused or timed out.

- Is the port open? From the machine running the bot: `nc -vz RCON_HOST 28016`.
- Did the Rust server start with `+rcon.web 1`? Without it the websocket RCON is not enabled at all.
- Does the password match `+rcon.password`? A wrong password fails the handshake.
- Remote server? The port must be reachable over TCP, and `+rcon.ip` must not be bound to
  `127.0.0.1` only.
- Hosted bot? Free hosts sometimes block outbound non-HTTP ports. The RCON port has to be allowed.
- Run `/setup` → 🖥️ Servers → **Test** to get the same answer without leaving Discord.

## The status stays 🔴 OFFLINE although the server is up

- `serverinfo` did not answer in time: raise `RCON_TIMEOUT_MS`.
- The server is still booting; Rust only starts answering RCON a little after the process comes up.
- The socket is connected but the reply was not JSON - `npm run doctor` prints what came back.
- No server is configured yet: run `/setup` and add one.

## The status is stuck on 🟡 RESTING

The server reports `Restarting: true` in `serverinfo`, which is what a Rust server sends while it
shuts down and restarts. Once it answers normally the state returns to green.

`PRESENCE_RESTING_ON_RECONNECT=true` also shows yellow while the bot is reconnecting after a drop.
With the default `false` that window shows 🔴 instead.

## The status never changes, or is missing

- `PRESENCE_ENABLED=false` disables it.
- Discord caches presence: the activity updates on their side within a few seconds.
- A template longer than 128 characters is cut; that is Discord's activity-name limit.
- Activity names are single line, so a template with a newline looks flattened.

## `/setup` says only the server owner can use it

That is the design: the wizard needs either the Discord server owner, or a user id listed in
`BOT_OWNER_IDS`. Ask an owner to run it - they can hand out the staff roles after that.

## A staff command says the member needs a role

The command tiers come straight from `/setup`: 🔨 Moderator for `/players`, 🔧 Admin for `/say`
and `/kick`, ⚔️ Head Admin for `/ban`, 🛡️ Co-Owner for `/console`. Check the roles saved in
`/setup` → 🎭 Roles, and remember that a member holding several tiers gets the highest one.

## `!pop` does nothing, `/pop` works

Prefix commands need all three of:

1. `PREFIX_COMMANDS_ENABLED=true` (the default),
2. the **Message Content Intent** enabled in the developer portal,
3. the message to start with `PREFIX` (`!` by default).

## `Invalid Token has been provided` / TOKEN_INVALID

The `DISCORD_TOKEN` is wrong, was regenerated, or has extra whitespace or quotes. Copy it again from
the developer portal (**Bot → Reset Token`) and keep the `.env` value unquoted on a single line.

## `Cannot find module 'discord.js'` (or `ws`)

Dependencies are missing. On a host panel, do not upload `node_modules` - upload `package.json`
and let the host install (bot-hosting.net: **Startup → Entry File** must be `src/index.js`). Then
restart the deployment.

## Nothing appears in a log channel

- Is that channel still selected in `/setup` → 📋 Logs? `npm run doctor` checks that each saved
  channel still exists.
- The bot needs **View Channels** and **Send Messages** in that channel.
- A category, voice channel or forum is not a text channel and is refused with a warning in the
  bot's own console.
- Join/leave events need the server to be connected: check the 📡 Server Status channel.

## Chat is too noisy / not relayed at all

In-game chat mirroring is off unless `RCON_CHAT_CHANNEL_ID` is set, and it is separate from the four
`/setup` log channels. If it posts a warning about the channel not being a text channel, you pointed
it at a category, voice channel or forum.

## Nothing in the logs at all

Raise the level: `LOG_LEVEL=debug`. To silence everything, `LOG_LEVEL=silent`.

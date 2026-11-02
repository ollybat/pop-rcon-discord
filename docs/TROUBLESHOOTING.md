# Troubleshooting

Start with the built-in diagnostic - it checks the configuration, the RCON connection, `serverinfo`,
`playerlist` and the Discord token in one pass:

```bash
npm run doctor
```

It prints one line per check and exits non-zero if something is wrong. Secrets are masked, so the
output is safe to share.

## The bot logs `initial connection failed`

The websocket to `ws://RCON_HOST:RCON_PORT/<password>` was refused or timed out.

- Is the port open? From the machine running the bot: `nc -vz RCON_HOST 28016`.
- Did the server start with `+rcon.web 1`? Without it the websocket RCON is not enabled at all.
- Does `RCON_PASSWORD` match `+rcon.password`? A wrong password fails the handshake.
- Remote server? The port must be reachable over TCP, and `+rcon.ip` must not be bound to
  `127.0.0.1` only.
- Hosted bot? Free hosts sometimes block outbound non-HTTP ports. The RCON port has to be allowed.

## The status stays 🔴 OFFLINE although the server is up

- `serverinfo` did not answer in time: raise `RCON_TIMEOUT_MS`.
- The server is still booting; Rust starts answering RCON a little after the process comes up.
- The socket is connected but the reply was not JSON. Run `npm run doctor` and look at the raw
  reply it prints.

## The status is stuck on 🟡 RESTING

The server reports `Restarting: true` in `serverinfo`. That is what a Rust server sends while it is
shutting down and restarting. Once it answers normally the state returns to green.

If you would rather see 🔴 OFFLINE during a restart, set `PRESENCE_RESTING_ON_RECONNECT=false` and
expect the yellow state only in the window the server itself reports.

## The status never changes / is missing

- `PRESENCE_ENABLED=false` disables it.
- Slack or Discord caching: the activity updates on Discord's side within a few seconds.
- A very long template is cut at 128 characters, which is Discord's limit for an activity name.
- Activity names are single line, so a template containing a newline will look flattened.

## `Invalid Token has been provided` / TOKEN_INVALID

The `DISCORD_TOKEN` is wrong, was regenerated, or has extra whitespace or quotes. Copy it again
from the developer portal (**Bot → Reset Token**), and keep the `.env` value unquoted on a single
line.

## `Cannot find module 'discord.js'` (or `ws`)

Dependencies are missing. On a host panel, do not upload `node_modules` - upload `package.json` and
let the host install. Then restart the deployment.

## Chatter relayed twice, or not at all

The relay is off unless `CONSOLE_CHANNEL_ID` is set, and the bot needs `View Channels` and
`Send Messages` in that channel. If it posts a warning about the channel not being a text channel,
you pointed it at a category, voice channel or forum.

## Nothing in the logs at all

Raise the level: `LOG_LEVEL=debug`. To silence everything, `LOG_LEVEL=silent`.

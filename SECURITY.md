# Security

## Reporting a problem

Open a private security advisory on GitHub (<https://github.com/ollybat/pop-rcon-discord/security/advisories/new>)
rather than a public issue, and include the version, the configuration (with secrets masked) and
the steps to reproduce.

## Secrets

- `.env` holds the Discord bot token and the RCON password. It is git-ignored - keep it that way.
- `npm run doctor` masks the token and password, but log output can still be sensitive; do not post
  raw console logs publicly without checking them first.
- Rotate the RCON password with `+rcon.password` and reset the bot token in the Discord developer
  portal if either leaks.

## Exposure

- WebRCON is an unauthenticated-by-port plain websocket: anyone who can reach the port and knows the
  password can run console commands. Bind it to the bot's address (firewall) or keep the bot on the
  same host or LAN.
- Give the bot the minimum Discord permissions: `View Channels`, `Send Messages`, `Embed Links`.
- The bot only reads from the RCON socket and posts to the configured channel; it never accepts
  commands from Discord.

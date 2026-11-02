# Contributing

## Setup

```bash
git clone https://github.com/ollybat/pop-rcon-discord.git
cd pop-rcon-discord
npm install
cp .env.example .env
```

Without a real Rust server you can still run everything except the live checks: the tests start
their own mock WebRCON server.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Run the bot. |
| `npm run dev` | Run with `node --watch`. |
| `npm run check` | Parse every file with `node --check` (ES module mode). |
| `npm run doctor` | Diagnose configuration, RCON and the Discord token. |
| `npm test` | Run the test suite. |

## Style

- ES modules, no build step, no dependencies beyond `discord.js`, `ws` and `dotenv`.
- Two-space indentation, single quotes, semicolons, `const` by default.
- Keep protocol logic out of Discord code: `src/rcon.js` knows nothing about Discord, and
  `src/presence.js` / `src/relay.js` take a client object they only use for output.
- Every module that talks to the outside world should be replaceable by a plain object in tests.

## Adding behaviour

1. Pure logic goes in `src/presence.js` or `src/summary.js` so it can be unit tested.
2. Anything that touches the network gets a test with `test/helpers/mock-rcon-server.js`.
3. Add an entry to `CHANGELOG.md` and document new environment variables in `.env.example`
   and the README table.

## Pull requests

- Run `npm run check` and `npm test` before opening a PR.
- Keep the diff focused; describe what you tested and against what (mock server, local Rust
  server, ...).
- Never commit `.env`, tokens or RCON passwords.

## Hosting note

If you deploy with bot-hosting.net or a similar panel, upload `package.json` and the source files
but **not** `node_modules` - the host installs the dependencies itself.

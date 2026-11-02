# Setting up Spinback pop bot

Two things have to happen: the **Rust server** has to answer RCON, and the **bot** has to be
configured in Discord. Both take a few minutes.

## 1. Turn on RCON on the Rust server

Add these flags to the server's start command (and restart it):

```
+rcon.web 1 +rcon.ip 0.0.0.0 +rcon.port 28016 +rcon.password "a-long-random-password"
```

`+rcon.web 1` is the one people forget: Rust only exposes the websocket console when it is set.
The port has to be reachable over TCP from the bot host, and the password travels in the URL path,
so use something long and random. Some hosts block outbound ports - check with the host's support
if the bot cannot connect.

**Rust Console Edition (Xbox/PlayStation) has no RCON at all.** This bot only works with PC/Steam
dedicated servers.

## 2. Configure the bot

```bash
npm install
cp .env.example .env
```

Put the bot token in `.env`:

```ini
DISCORD_TOKEN=your-bot-token
```

Optionally, so server slot 1 is ready before the first `/setup`:

```ini
RCON_HOST=123.45.67.89
RCON_PORT=28016
RCON_PASSWORD=a-long-random-password
RCON_NAME=Spinback 5X EU
```

Start it with `npm start`. Then run `npm run doctor` in another terminal if you want every check
(secrets are masked).

## 3. Invite the bot

In the Discord developer portal, open **OAuth2 → URL Generator**, tick the `bot` and
`applications.commands` scopes, and give it:

- View Channels
- Send Messages
- Embed Links
- Read Message History (so `!pop` can reply in busy channels)
- Manage Roles - only needed so the `/setup` role dropdowns can list your roles

If you want the `!pop` prefix commands, also enable **Message Content Intent** on the **Bot** page.

## 4. Run /setup

Type `/setup` in any channel. Only the **server owner** (or a **bot owner** from
`BOT_OWNER_IDS`) gets the panel; everyone else is told to ask an owner.

### The 60 second version

1. `/setup` → **⚡ Quick setup**. It matches your existing Owner / Admin / Mod roles by name and
   creates a `🎧 Spinback` category with the four log channels.
2. **🖥️ Servers** → slot 1 → **Add** → IP, RCON port, RCON password → **Test**.
3. **✅ Done** → checklist. If it is green you are finished: the status line is live and
   `/pop` works.

Everything below is the long version, if you would rather pick each thing by hand.

### 🎭 Roles

Pick the Discord role for each staff tier. Only 👑 **Owner Role** is required.

| Tier | Rank | Intended for |
| --- | --- | --- |
| 👑 Owner Role | 5 | Full control: setup, console access, everything. Required. |
| 🛡️ Co-Owner Role | 4 | Everything Head Admin can do, plus raw console access. |
| ⚔️ Head Admin Role | 3 | Bans, kicks, chat broadcasts, player tools. |
| 🔧 Admin Role | 2 | Kicks and chat broadcasts. |
| 🔨 Moderator Role | 1 | Read-only staff tools: player lists and population checks. |

A member holding several of these gets the **highest** rank. The server owner always passes every
check, whatever roles you configure.

### 📋 Logs

Choose a text channel for each destination:

| | |
| --- | --- |
| 🚪 Join & Leave | one embed per player, with ping and session length on leave |
| ⌨️ Command Log | every staff command: who, which tier, the options, the duration, the outcome |
| 🚨 Error Log | RCON failures, permission problems, unhandled errors |
| 📡 Server Status | connects, disconnects and every `/setup` change |

Picking nothing is allowed - the event is simply not posted anywhere (errors still go to the bot's
own console).

### 🖥️ Servers

Up to **three** servers. For each slot press **Add** and fill in:

- **Server name** - what shows in embeds, e.g. `Spinback 5X EU`
- **Server IP or host** - `123.45.67.89` or `play.example.com` (you can paste a `wss://` URL)
- **RCON port** - `28016` unless you changed `+rcon.port`
- **RCON password** - must match `+rcon.password` exactly

Press **Test** to have the bot connect once and report either the live player count and hostname, or
the exact reason it could not. Passwords are stored on the bot host in `DATA_DIR/guilds/<id>.json`
(mode 0600) and are never echoed into Discord - only masked (`hu***r2`).

### ✅ Done

**Done** shows a checklist: roles, log channels and servers, with whatever is still missing. Once
at least one server and the Owner Role are saved, the status line goes live and every staff command
follows the configured roles.

## 5. Check it worked

- The bot's name in the member list should show 🟢 RCON┆👥 ... within one poll interval.
- `/pop` should list the players who are online.
- Joining the Rust server should produce a 🚪 embed in your join/leave channel within ~20 seconds.

If not, run `npm run doctor` and read [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Changing things later

Run `/setup` again at any time. Edits are saved as you go, servers are reconnected immediately
when you change them, and every change is announced in the 📡 Server Status channel.

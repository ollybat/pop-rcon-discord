/**
 * What a new guild owner gets in their DMs the moment the bot is invited: what it does, the three
 * steps that make it useful, and the five failures that actually happen.
 *
 * It is a private message to the owner only. No server address, no password, and nothing here is
 * ever posted in a channel.
 */
import { BRAND, COLORS } from './theme.js';
import { baseEmbed } from './embeds.js';
import { truncate } from './format.js';

/** The exact start line the guide asks for. No secret: the password placeholder is the user's own. */
export const RCON_START_LINE = '+rcon.web 1 +rcon.ip 0.0.0.0 +rcon.port 28016 +rcon.password "your-password"';

/** The three embeds of the guide, in order. */
export function onboardingEmbeds({ guild = null, prefix = '!', prefixEnabled = true, dmEnabled = true } = {}) {
  const where = guild?.name ? '**' + truncate(guild.name, 80) + '**' : 'your server';
  const pop = prefixEnabled ? '`' + prefix + 'pop`' : '`/pop`';

  const welcome = baseEmbed()
    .setTitle('👋 Thanks for inviting ' + BRAND.tagline)
    .setDescription(
      [
        'I watch your Rust servers over **WebRCON** and keep the live population in my own activity line, so anyone can see who is on without asking.',
        '',
        '**Your part takes about five minutes, and only you can see it.** Type `/setup` in ' + where + ' and pick it from the menu.',
        '',
        '**What you get once a server is added**',
        '• ' + pop + ' — who is on right now, for everybody',
        '• `/ping` — private health check: RCON round-trip, players, queue, uptime and my own counters',
        '• my activity line follows the servers, and join, leave and error logs go to the channels you pick',
        dmEnabled ? '• anyone who writes to me in a DM gets an answer, and the message is passed on to you' : null,
        '',
        '**🔒 Nothing you type is ever posted.** The RCON password stays in your private settings, is shown masked, and never reaches a channel, a log, my activity line or the public status page.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );

  const steps = baseEmbed()
    .setTitle('🚀 Three steps')
    .setDescription(
      [
        '**1 · Servers** — `/setup` → **Servers** → Slot 1 → fill in the address, the RCON port and the password → press **Test**. Green means I am talking to your server.',
        '**2 · Roles** — **Roles** → set the owner role, or press **Guess roles** and I will match them by name.',
        '**3 · Logs** — **Logs** → pick the channels or press **Make channels**, then **Test channels** to prove they work.',
        '',
        'Then press **Done**. The activity line refreshes on my next poll — within a minute.',
        '',
        '-# Your Rust server has to be started with WebRCON on, and the RCON port has to be reachable from the internet: I connect from outside, not from your machine.',
        '```' + RCON_START_LINE + '```',
      ].join('\n'),
    );

  const trouble = baseEmbed({ color: COLORS.warning })
    .setTitle('🩺 If something does not work')
    .setDescription(
      [
        '**I cannot reach the server** (timeout or connection refused) — RCON is off, or the port is blocked. Check `+rcon.web 1`, and make sure you used the **RCON** port (28016 by default), not the game port.',
        '**Wrong password** — the password in the startup line and the one in /setup must match exactly, and without the quotes.',
        '**Nothing happens when you type the prefix command** — the **Message Content Intent** has to be enabled in the Discord developer portal for prefix commands, or use the slash commands instead.',
        '**My slash menu looks empty** — give Discord a minute and reopen it. If it stays empty the bot was invited without the `applications.commands` scope.',
        '**Anything else** — `/ping` gives a full report, and the **Guide** button inside /setup repeats the setup steps.',
        '**To reach a person** — inside the server, an owner can write `!reply <user id> <your answer>` and I will DM it on.',
      ].join('\n'),
    );

  return [welcome, steps, trouble];
}

/** Send the guide to one user, privately. Returns true when Discord accepted the DM. */
export async function sendGuideTo({ user, guild = null, logger = console, prefix = '!', prefixEnabled = true, dmEnabled = true } = {}) {
  if (!user || typeof user.send !== 'function') return false;

  try {
    await user.send({ embeds: onboardingEmbeds({ guild, prefix, prefixEnabled, dmEnabled }) });
    logger.info?.('[onboarding] sent the setup guide to ' + (user.username ?? user.id));
    return true;
  } catch (error) {
    logger.warn?.('[onboarding] could not DM ' + (user.username ?? user.id) + ': ' + (error?.message ?? error));
    return false;
  }
}

/**
 * The owner of a guild, whether or not Discord has them cached. Returns null when the owner has
 * left the server or cannot be fetched.
 */
export async function guildOwnerOf(guild) {
  if (!guild) return null;

  if (typeof guild.fetchOwner === 'function') {
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) return owner;
  }

  const userId = guild.ownerId ?? null;
  const users = guild.client?.users ?? null;
  if (userId && typeof users?.fetch === 'function') return users.fetch(userId).catch(() => null);
  return null;
}

/**
 * The invite path: DM the guild owner the guide, and if their DMs are closed say so in the system
 * channel instead of giving up silently. `seen` is the caller's memory of guilds already welcomed,
 * so a re-join in the same run does not send it twice.
 */
export async function welcomeOwner({ client = null, guild, logger = console, seen = null, prefix = '!', prefixEnabled = true, dmEnabled = true } = {}) {
  if (!guild) return { delivered: false, reason: 'no guild' };

  const key = String(guild.id);
  if (seen && seen.has(key)) return { delivered: false, reason: 'already welcomed' };
  if (seen) seen.add(key);

  const owner = await guildOwnerOf(guild);
  if (!owner) {
    logger.warn?.('[onboarding] no owner to DM in ' + guild.name);
    return { delivered: false, reason: 'no owner' };
  }

  if (await sendGuideTo({ user: owner, guild, logger, prefix, prefixEnabled, dmEnabled })) {
    return { delivered: true, owner };
  }

  // DMs closed: say where the guide is instead, once, in the guild itself.
  try {
    const channel =
      guild.systemChannel ??
      guild.channels?.cache?.find?.(
        (candidate) =>
          candidate.type === 0 && candidate.permissionsFor?.(guild.members?.me)?.has?.(['ViewChannel', 'SendMessages']),
      );

    if (channel) {
      await channel.send({
        embeds: [
          baseEmbed({ color: COLORS.warning })
            .setTitle('📬 I could not DM you, ' + truncate(owner.username ?? 'server owner', 60))
            .setDescription(
              '<@' + owner.id + '> — allow **direct messages from server members** in your privacy settings and I will send the setup guide.\n' +
                'In the meantime, `/setup` has everything, including the **Guide** and the **Test channels** buttons.',
            ),
        ],
      });
    }
  } catch (error) {
    logger.debug?.('[onboarding] could not post the fallback note: ' + (error?.message ?? error));
  }

  return { delivered: false, reason: 'dm closed', owner };
}

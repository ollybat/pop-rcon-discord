/**
 * The live population board.
 *
 * Two jobs, one ticker:
 *   1. a channel can hold one board message the bot keeps up to date (chosen in /setup), and
 *   2. any /pop message somebody marked live updates itself for a while and then stops.
 *
 * Edits are skipped when nothing changed, so a quiet server costs nothing, and a hard failure
 * (channel gone, no permission) is reported once per guild instead of on every tick.
 */
import { popPayload } from './pop.js';

/** A short, stable description of what the board would show. Equal means: do not edit. */
export function boardKey(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter(Boolean)
    .map((snapshot) =>
      [
        snapshot.slot,
        snapshot.connected ? 1 : 0,
        snapshot.info ? (snapshot.info.restarting ? 'restarting' : 'online') : '-',
        snapshot.info?.players ?? '-',
        snapshot.info?.max ?? '-',
        snapshot.info?.queued ?? '-',
      ].join(':'),
    )
    .join('|');
}

/** The small line that tells everyone the message is alive, and how to stop it. */
export function boardNote({ intervalSeconds = 30, live = false, until = null, at = null } = {}) {
  const parts = [];
  if (live) parts.push('🔴 live — I refresh this message every ' + intervalSeconds + 's');
  else parts.push('📌 board — I refresh this message every ' + intervalSeconds + 's');
  if (Number.isFinite(until)) parts.push('until <t:' + Math.floor(until / 1000) + ':t>');
  if (live) parts.push('press ⏸ to stop');
  if (at) parts.push('last reading ' + (at instanceof Date ? Math.floor(at.getTime() / 1000) : Math.floor(Number(at) / 1000)));
  return '-# ' + parts.join(' · ');
}

export function createBoardManager({
  client,
  store,
  servers,
  logger = console,
  intervalSeconds = 30,
  forceSeconds = 300,
  liveMinutes = 20,
  now = () => Date.now(),
} = {}) {
  const live = new Map();
  const last = new Map();
  const blocked = new Map();
  let timer = null;
  let ticking = false;

  const address = (channelId, messageId) => String(channelId) + ':' + String(messageId);

  /** The payload a board message should hold right now. */
  function payloadFor(guildId, { focus = null, showPlayers = true, details = true, note = null } = {}) {
    return popPayload({
      snapshots: servers.snapshots(guildId),
      config: store.get(guildId),
      showPlayers,
      details,
      focus,
      guildId,
      pollSeconds: intervalSeconds,
      note,
    });
  }

  async function channelOf(channelId) {
    if (!channelId) return null;
    const fetched = await client.channels?.fetch?.(channelId).catch(() => null);
    if (fetched) return fetched;
    return client.channels?.cache?.get?.(channelId) ?? null;
  }

  /** Post a new board message. Returns the message, or null with a reason. */
  async function post({ guildId, channelId, focus = null, showPlayers = true, details = true, note = null }) {
    const channel = await channelOf(channelId);
    if (!channel || typeof channel.send !== 'function') return { message: null, reason: 'no channel' };

    const message = await channel.send(payloadFor(guildId, { focus, showPlayers, details, note })).catch(() => null);
    return message ? { message, reason: null } : { message: null, reason: 'could not post' };
  }

  /** Edit an existing board message. Returns { ok, gone } so callers can heal a deleted message. */
  async function edit({ guildId, channelId, messageId, focus = null, showPlayers = true, details = true, note = null }) {
    const channel = await channelOf(channelId);
    if (!channel?.messages?.fetch) return { ok: false, gone: false, reason: 'no channel' };

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return { ok: false, gone: true, reason: 'message gone' };

    const edited = await message.edit(payloadFor(guildId, { focus, showPlayers, details, note })).then(() => true).catch(() => false);
    return edited ? { ok: true, gone: false, reason: null } : { ok: false, gone: false, reason: 'could not edit' };
  }

  /** Should this message be edited? Only when something changed, or when the last edit is old. */
  function stale(channelId, messageId, snapshotKey, force = false) {
    const key = address(channelId, messageId);
    const seen = last.get(key);
    const at = now();

    if (force || !seen || seen.key !== snapshotKey || at - seen.at >= forceSeconds * 1000) {
      last.set(key, { key: snapshotKey, at });
      return true;
    }

    return false;
  }

  function noteFor({ live: isLive = false, until = null, at = null } = {}) {
    return boardNote({ intervalSeconds, live: isLive, until, at });
  }

  /**
   * Make sure the guild's configured board exists and is current. Called on every tick and from
   * /setup, so a deleted message is re-posted instead of going quiet.
   */
  async function syncGuild(guildId, { force = false, note = null } = {}) {
    const id = String(guildId);
    const config = store.get(id);
    const boardConfig = config?.board ?? null;

    if (!boardConfig?.enabled || !boardConfig.channelId) return { ok: false, reason: 'off' };
    if (blocked.has(id)) return { ok: false, reason: blocked.get(id) };

    const snapshotKey = boardKey(servers.snapshots(id));
    const at = new Date(now());

    if (boardConfig.messageId) {
      if (!stale(boardConfig.channelId, boardConfig.messageId, snapshotKey, force)) return { ok: true, reason: 'unchanged' };

      const result = await edit({
        guildId: id,
        channelId: boardConfig.channelId,
        messageId: boardConfig.messageId,
        note: note ?? noteFor({ at }),
      });

      if (result.ok) return { ok: true, reason: 'edited' };
      if (result.gone) {
        logger.warn?.('[board] the board message in ' + boardConfig.channelId + ' is gone, posting a new one');
        await store.update(id, (next) => {
          next.board.messageId = null;
          return next;
        }).catch(() => null);
      } else {
        blocked.set(id, result.reason ?? 'failed');
        logger.warn?.('[board] ' + id + ': ' + (result.reason ?? 'could not edit the board'));
        return { ok: false, reason: result.reason };
      }
    }

    const fresh = store.get(id);
    const posted = await post({
      guildId: id,
      channelId: fresh.board.channelId,
      note: note ?? noteFor({ at }),
    });

    if (!posted.message) {
      blocked.set(id, posted.reason ?? 'could not post');
      logger.warn?.('[board] ' + id + ': ' + (posted.reason ?? 'could not post the board'));
      return { ok: false, reason: posted.reason };
    }

    await store.update(id, (next) => {
      next.board.messageId = posted.message.id;
      return next;
    }).catch(() => null);

    // Remember what was just posted, so the next pass does not edit it for nothing.
    last.set(address(fresh.board.channelId, posted.message.id), { key: snapshotKey, at: now() });

    return { ok: true, reason: 'posted' };
  }

  /** Turn a /pop message into a live one. Returns the moment it stops, or null when it failed. */
  async function startLive({ guildId, channelId, messageId, focus = null, showPlayers = true, details = true }) {
    const until = now() + liveMinutes * 60 * 1000;
    const entry = { guildId: String(guildId), channelId: String(channelId), messageId: String(messageId), focus, showPlayers, details, until };
    live.set(address(channelId, messageId), entry);

    const result = await edit({
      guildId: entry.guildId,
      channelId: entry.channelId,
      messageId: entry.messageId,
      focus,
      showPlayers,
      details,
      note: noteFor({ live: true, until, at: new Date(now()) }),
    });

    if (!result.ok) {
      live.delete(address(channelId, messageId));
      return null;
    }

    last.set(address(channelId, messageId), { key: boardKey(servers.snapshots(entry.guildId)), at: now() });
    return until;
  }

  function stopLive({ channelId, messageId }) {
    return live.delete(address(channelId, messageId));
  }

  function liveEntry({ channelId, messageId }) {
    return live.get(address(channelId, messageId)) ?? null;
  }

  /** One pass over every board and every live message. */
  async function tick() {
    if (ticking) return;
    ticking = true;

    try {
      for (const guildId of store.listGuildIds()) {
        await syncGuild(guildId).catch(() => null);
      }

      for (const entry of [...live.values()]) {
        if (now() >= entry.until) {
          live.delete(address(entry.channelId, entry.messageId));
          await edit({ ...entry, note: boardNote({ intervalSeconds, at: null }).replace('📌 board — I refresh', '⏸ live update stopped — I answered') }).catch(() => null);
          continue;
        }

        const snapshotKey = boardKey(servers.snapshots(entry.guildId));
        if (!stale(entry.channelId, entry.messageId, snapshotKey)) continue;

        const result = await edit({ ...entry, note: noteFor({ live: true, until: entry.until, at: new Date(now()) }) }).catch(() => null);
        if (!result || (!result.ok && result.gone)) live.delete(address(entry.channelId, entry.messageId));
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer || intervalSeconds <= 0) return null;
    timer = setInterval(() => tick(), intervalSeconds * 1000);
    timer.unref?.();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    live.clear();
    last.clear();
  }

  /** Forget a hard failure so /setup can try again after a fix. */
  function unblock(guildId) {
    return blocked.delete(String(guildId));
  }

  return {
    intervalSeconds,
    start,
    stop,
    tick,
    syncGuild,
    startLive,
    stopLive,
    liveEntry,
    unblock,
    blocked,
    live,
    payloadFor,
  };
}

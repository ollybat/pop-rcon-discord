import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * How long the bot was away, measured from the last beat it managed to write before it stopped.
 * A bot that is killed outright never gets to say goodbye, so the beat file is the only honest
 * answer to "was it down, and for how long?".
 */
export function describeGap(previous, at = new Date()) {
  if (!previous) return { known: false, seconds: null, at: null };
  const last = previous instanceof Date ? previous : new Date(previous);
  if (Number.isNaN(last.getTime())) return { known: false, seconds: null, at: null };

  return { known: true, seconds: Math.max(0, Math.round((at.getTime() - last.getTime()) / 1000)), at: last };
}

/**
 * A heartbeat file, written atomically so a kill mid-write cannot leave it unreadable. Tiny on
 * purpose: one timestamp, rewritten in place, never appended to.
 */
export class Heartbeat {
  constructor({ path = null, intervalMs = 60000, logger = console, now = () => new Date() } = {}) {
    this.path = path;
    this.intervalMs = Math.max(15000, intervalMs);
    this.logger = logger;
    this.now = now;
    this.timer = null;
  }

  /** The last beat on disk, or null when there is none (first run, or a wiped container). */
  async read() {
    if (!this.path) return null;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      return parsed && typeof parsed.at === 'string' ? parsed.at : null;
    } catch {
      return null;
    }
  }

  async beat() {
    if (!this.path) return null;
    const at = this.now().toISOString();

    try {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = this.path + '.tmp-' + process.pid;
      await writeFile(temp, JSON.stringify({ at }) + '\n', 'utf8');
      await rename(temp, this.path);
      return at;
    } catch (error) {
      this.logger.warn?.('[heartbeat] could not write ' + this.path + ': ' + error.message);
      return null;
    }
  }

  async start() {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

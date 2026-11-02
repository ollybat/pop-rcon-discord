import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const FRAME_NAME = 'WebRcon';

/**
 * Minimal client for Rust's WebRCON, the websocket console exposed by
 * `+rcon.web 1` on a Rust dedicated server.
 *
 * - the password travels in the URL path: ws://host:port/password
 * - commands are JSON frames: { Identifier, Message, Name: "WebRcon" }
 * - replies echo the Identifier; server-side events (chat, joins, ...) arrive
 *   with Identifier 0 and are re-emitted as "broadcast" / "chat"
 */
export class RustRconClient extends EventEmitter {
  constructor({
    host,
    port = 28016,
    password,
    timeoutMs = 15000,
    maxReconnectDelayMs = 30000,
    autoReconnect = true,
    logger = console,
  } = {}) {
    super();
    if (!host) throw new Error('RustRconClient: host is required');
    if (!password) throw new Error('RustRconClient: password is required');

    this.host = host;
    this.port = port;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.maxReconnectDelayMs = maxReconnectDelayMs;
    this.autoReconnect = autoReconnect;
    this.logger = logger;

    this.socket = null;
    this.connectPromise = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.nextIdentifier = 1;
    this.pending = new Map();
    this.shuttingDown = false;
  }

  /** ws://host:port — safe to log, never contains the password. */
  get target() {
    return 'ws://' + this.host + ':' + this.port;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect() {
    if (this.connected) return this;
    if (this.connectPromise) return this.connectPromise;

    this.shuttingDown = false;

    this.connectPromise = new Promise((resolve, reject) => {
      const url = 'ws://' + this.host + ':' + this.port + '/' + encodeURIComponent(this.password);
      const socket = new WebSocket(url, { handshakeTimeout: this.timeoutMs });
      this.socket = socket;
      let opened = false;

      socket.on('open', () => {
        opened = true;
        this.reconnectAttempts = 0;
        this.logger.info('[rcon] connected to ' + this.target);
        this.emit('connected');
        resolve(this);
      });

      socket.on('error', (error) => {
        if (!opened) reject(error);
        else this.logger.warn('[rcon] socket error: ' + error.message);
      });

      socket.on('message', (data) => this.handleMessage(data));
      socket.on('close', (code, reason) => this.handleClose(code, reason));
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }

    return this;
  }

  /**
   * Send one console command and resolve with the matching reply.
   * Pass expectResponse: false for fire-and-forget frames.
   */
  async send(command, { timeoutMs = this.timeoutMs, expectResponse = true } = {}) {
    if (!this.connected) {
      throw new Error('Not connected to the Rust server (' + this.target + ')');
    }

    const identifier = expectResponse ? this.nextIdentifier++ : 0;
    const frame = JSON.stringify({ Identifier: identifier, Message: command, Name: FRAME_NAME });

    if (!expectResponse) {
      this.socket.send(frame);
      return { identifier, type: 'Sent', message: '', stacktrace: null };
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(identifier);
        reject(new Error('RCON command timed out after ' + timeoutMs + 'ms: ' + command));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(identifier, { resolve, reject, timer });

      this.socket.send(frame, (error) => {
        if (!error) return;
        const entry = this.pending.get(identifier);
        if (!entry) return;
        this.pending.delete(identifier);
        clearTimeout(entry.timer);
        entry.reject(error);
      });
    });
  }

  /** Like send(), but JSON.parse()s the reply when the server returns JSON. */
  async sendJson(command, options) {
    const response = await this.send(command, options);
    try {
      return { ...response, data: JSON.parse(response.message) };
    } catch {
      return { ...response, data: null };
    }
  }

  async close() {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPending(new Error('RCON client is shutting down'));

    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      timer.unref?.();
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, 'shutting down');
    });
  }

  handleMessage(data) {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.emit('unknown', data.toString());
      return;
    }

    const identifier = Number(payload.Identifier ?? 0);
    const message = String(payload.Message ?? '');
    const type = String(payload.Type ?? 'Generic');
    const stacktrace = payload.Stacktrace ?? null;

    const entry = identifier ? this.pending.get(identifier) : undefined;
    if (entry) {
      this.pending.delete(identifier);
      clearTimeout(entry.timer);
      entry.resolve({ identifier, type, message, stacktrace });
      return;
    }

    this.emit('broadcast', { identifier, type, message, stacktrace, raw: payload });
    if (type.toLowerCase() === 'chat') {
      this.emit('chat', { message, raw: payload });
    }
  }

  handleClose(code, reason) {
    const detail = reason ? reason.toString() : '';
    const suffix = detail ? ': ' + detail : '';
    this.logger.warn('[rcon] disconnected from ' + this.target + ' (code ' + code + suffix + ')');

    this.socket = null;
    this.rejectPending(new Error('RCON connection closed'));
    this.emit('disconnected', { code, reason: detail });

    if (this.shuttingDown || !this.autoReconnect) return;
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(this.maxReconnectDelayMs, 1000 * 2 ** Math.min(attempt - 1, 5));
    this.logger.warn('[rcon] reconnecting in ' + Math.round(delay / 1000) + 's (attempt ' + attempt + ')');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        this.logger.warn('[rcon] reconnect failed: ' + error.message);
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  rejectPending(error) {
    for (const [identifier, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(identifier);
      entry.reject(error);
    }
  }
}

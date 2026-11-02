import { WebSocketServer } from 'ws';

/**
 * A stand-in for Rust's WebRCON socket: the password is the URL path, frames are
 * JSON, and replies echo the request Identifier unless onCommand says otherwise.
 */
export function createMockRconServer({ onCommand, onConnect, password = 'hunter2', port = 0 } = {}) {
  const wss = new WebSocketServer({ port });
  const state = { requests: [], connections: 0, paths: [] };
  const ready = new Promise((resolve) => wss.once('listening', resolve));

  wss.on('connection', (socket, request) => {
    state.connections += 1;
    state.paths.push(request.url);

    if (onConnect) onConnect(socket, request);

    socket.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      state.requests.push(frame);

      if (onCommand) {
        onCommand(frame, socket);
        return;
      }

      socket.send(
        JSON.stringify({ Identifier: frame.Identifier, Message: 'ok', Type: 'Generic', Stacktrace: null }),
      );
    });
  });

  return {
    state,
    ready,
    get port() {
      return wss.address().port;
    },
    get url() {
      return 'ws://127.0.0.1:' + wss.address().port + '/' + password;
    },
    /** Push a server-side event (chat, join, ...) to every open socket. */
    broadcast(payload, except) {
      for (const client of wss.clients) {
        if (client !== except) client.send(JSON.stringify(payload));
      }
    },
    /** Rip the connection away to imitate a server restart. */
    dropAll() {
      for (const client of wss.clients) client.terminate();
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

export async function startMockRconServer(options) {
  const server = createMockRconServer(options);
  await server.ready;
  return server;
}

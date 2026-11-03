import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boardView,
  guideView,
  logsView,
  mainPanel,
  resetView,
  rolePickView,
  rolesView,
  serverModal,
  serversView,
  slotView,
} from '../src/setup/panel.js';
import { emptyGuildConfig, normalizeGuildConfig } from '../src/store.js';

/** Discord rejects a message whose components share a custom_id, so this walks every payload. */
function customIds(payload) {
  const ids = [];

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (typeof node !== 'object') return;

    if (typeof node.custom_id === 'string') ids.push(node.custom_id);
    if (typeof node.customId === 'string') ids.push(node.customId);

    const data = typeof node.toJSON === 'function' ? node.toJSON() : node.data ?? node;
    for (const key of ['components', 'items']) walk(data?.[key]);
  }

  walk(typeof payload?.toJSON === 'function' ? payload.toJSON() : payload);
  return ids;
}

function duplicates(ids) {
  const seen = new Set();
  const repeated = new Set();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

const full = normalizeGuildConfig(
  {
    guildId: 'g',
    roles: { owner: '111111111111111111' },
    logs: { status: '222222222222222222' },
    servers: [{ name: 'spinback 5x', host: 'play.example.com', port: 28016, password: 'secret' }],
    board: { channelId: '333333333333333333', enabled: true, messageId: '444444444444444444' },
    digest: { enabled: true, channelId: '555555555555555555', hour: 20 },
  },
  'g',
);

const blank = emptyGuildConfig('g');
const snapshot = { slot: 1, name: 'spinback 5x', connected: true, info: { players: 3, max: 100 }, players: [], latencyMs: 8, at: new Date().toISOString(), error: null };

const views = {
  mainPanel: (config) => mainPanel(config, { snapshots: [snapshot] }),
  rolesView: (config) => rolesView(config),
  rolePickView: (config) => rolePickView(config, 'owner'),
  logsView: (config) => logsView(config),
  serversView: (config) => serversView(config, { snapshots: [snapshot] }),
  slotView: (config) => slotView(config, 1, snapshot),
  boardView: (config) => boardView(config, { snapshots: [snapshot] }),
  guideView: (config) => guideView(config),
  resetView: (config) => resetView(config),
};

test('no view sends the same custom id twice, which Discord refuses outright', () => {
  for (const [name, build] of Object.entries(views)) {
    for (const config of [full, blank]) {
      const payload = build(config);
      const ids = customIds(payload);
      assert.ok(ids.length > 0, name + ' has components');
      assert.deepEqual(duplicates(ids), [], name + ' repeats a custom id: ' + duplicates(ids).join(', '));
    }
  }
});

test('no view breaks the five rows of five that Discord allows', () => {
  for (const [name, build] of Object.entries(views)) {
    const payload = build(full);
    const rows = payload.components ?? [];
    assert.ok(rows.length <= 5, name + ' has ' + rows.length + ' rows');

    for (const row of rows) {
      const size = (row.toJSON ? row.toJSON().components : row.components ?? []).length;
      assert.ok(size >= 1 && size <= 5, name + ' has a row of ' + size);
    }
  }
});

test('the board view keeps one Back button and the digest controls', () => {
  const payload = boardView(full, { snapshots: [snapshot] });
  const ids = customIds(payload);

  assert.equal(ids.filter((id) => id === 'sb:setup:main').length, 1);
  for (const expected of ['sb:setup:boardset', 'sb:setup:boardtoggle', 'sb:setup:boardpost', 'sb:setup:alertstoggle', 'sb:setup:outagetoggle', 'sb:setup:digestset', 'sb:setup:digesttoggle', 'sb:setup:digesthour', 'sb:setup:digestpreview']) {
    assert.ok(ids.includes(expected), expected + ' is missing');
  }
});

test('the server modal has unique fields too', () => {
  const ids = customIds(serverModal(1, { name: 'spinback 5x', host: 'play.example.com', port: 28016 }));
  assert.deepEqual(duplicates(ids), []);
  assert.ok(ids.length >= 3);
});

#!/usr/bin/env node
/**
 * Floating CI entry point: unit tests plus a real stdio smoke test of the MCP server.
 *
 *   npm run ci          # everything, exits non-zero on the first failure
 *   node scripts/test-all.js --no-mcp   # unit tests only
 *
 * It is also a convenient one-shot start command on a host: point the startup file at it, start
 * the container, read the log, then point the startup file back at src/index.js.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const node = process.execPath;
const args = process.argv.slice(2);

/** Filled in by runUnitTests so the final summary can list every file. */
let unitResults = [];

function heading(text) {
  console.log('\n=== ' + text + ' ===');
}

/** Every test file, named explicitly so the runner works the same on every Node version. */
function testFiles() {
  const dir = join(root, 'test');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => join('test', name));
}

function runUnitTests() {
  const files = testFiles();
  if (files.length === 0) {
    console.log('SKIP: no test files found under test/');
    return true;
  }

  heading('unit tests (' + files.length + ' files)');
  console.log('files: ' + files.join(' '));

  // Preferred: one node --test run. Some hosts wrap node with a script that eats flags, so if
  // that comes back broken, fall back to running each file in its own process - which is what
  // node --test does internally anyway.
  const together = spawnSync(node, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  if (together.status === 0) return true;

  console.log('node --test exited with ' + together.status + ', running each file on its own instead');

  const results = [];
  for (const file of files) {
    console.log('\n--- ' + file + ' ---');
    const result = spawnSync(node, [file], { cwd: root, stdio: 'inherit' });
    results.push({ file, ok: result.status === 0 });
  }

  unitResults = results;
  const failed = results.filter((entry) => !entry.ok);
  console.log('\n' + (files.length - failed.length) + '/' + files.length + ' test file(s) passed');
  return failed.length === 0;
}

/** Start the MCP server, talk a little JSON-RPC to it, and check the answers. */
function smokeTestMcp() {
  heading('mcp/server.js stdio smoke test');

  const serverPath = join(root, 'mcp', 'server.js');
  if (!existsSync(serverPath)) {
    console.log('SKIP: mcp/server.js is missing');
    return true;
  }

  return new Promise((resolve) => {
    const child = spawn(node, [serverPath], {
      cwd: root,
      env: { ...process.env, DATA_DIR: join(root, 'tmp', 'ci-data') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'spinback-ci', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_servers', arguments: {} } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'records', arguments: {} } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'rcon', arguments: { command: 'serverinfo' } } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', id: 8, method: 'does/not/exist' },
    ];

    for (const request of requests) child.stdin.write(JSON.stringify(request) + '\n');

    const timer = setTimeout(() => {
      console.log('FAIL: the MCP server did not answer within 20s');
      child.kill('SIGKILL');
      resolve(false);
    }, 20000);

    child.stdin.end();

    child.on('close', () => {
      clearTimeout(timer);

      const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
      const failures = [];
      const responses = new Map();

      for (const line of lines) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          failures.push('non-JSON line on stdout: ' + line.slice(0, 80));
          continue;
        }

        if (message.jsonrpc !== '2.0') failures.push('missing jsonrpc 2.0 in ' + line.slice(0, 60));
        if (message.id !== null && message.id !== undefined) responses.set(message.id, message);
      }

      if (responses.size !== 8) failures.push('expected 8 responses, got ' + responses.size + ' (notifications must stay silent)');

      const initialized = responses.get(1);
      if (!initialized?.result?.serverInfo?.name) failures.push('initialize did not return serverInfo');
      if (!initialized?.result?.protocolVersion) failures.push('initialize did not return a protocolVersion');

      const tools = responses.get(3)?.result?.tools ?? [];
      if (tools.length < 6) failures.push('tools/list returned ' + tools.length + ' tools');
      for (const tool of tools) {
        if (!tool.name || !tool.description || !tool.inputSchema) failures.push('tool without name/description/inputSchema: ' + JSON.stringify(tool).slice(0, 60));
      }
      const names = tools.map((tool) => tool.name).join(', ');
      console.log('tools: ' + names);

      const listServers = responses.get(4)?.result?.content?.[0]?.text ?? '';
      if (!listServers) failures.push('list_servers returned nothing');
      console.log('list_servers -> ' + listServers.split('\n')[0].slice(0, 100));

      const records = responses.get(5)?.result?.content?.[0]?.text ?? '';
      if (!records) failures.push('records returned nothing');

      const rawRcon = responses.get(6)?.result?.content?.[0]?.text ?? '';
      if (!/off/i.test(rawRcon)) failures.push('the raw rcon tool should be off by default, said: ' + rawRcon.slice(0, 80));

      const unknownTool = responses.get(7);
      if (!unknownTool?.result?.isError) failures.push('an unknown tool should come back as isError');

      const unknownMethod = responses.get(8);
      if (unknownMethod?.error?.code !== -32601) failures.push('an unknown method should be -32601');

      if (stderr.trim()) console.log('stderr: ' + stderr.trim().split('\n').slice(0, 4).join(' | '));

      if (failures.length) {
        for (const failure of failures) console.log('FAIL: ' + failure);
        return resolve(false);
      }

      console.log('PASS: ' + lines.length + ' responses, ' + tools.length + ' tools, protocol and errors behave');
      resolve(true);
    });
  });
}

async function main() {
  console.log('node ' + process.version + ' on ' + process.platform);
  const testsOk = runUnitTests();
  const mcpOk = args.includes('--no-mcp') ? true : await smokeTestMcp();

  heading('result');
  for (const entry of unitResults) console.log((entry.ok ? 'PASS  ' : 'FAIL  ') + entry.file);
  console.log('unit tests: ' + (testsOk ? 'PASS' : 'FAIL'));
  console.log('mcp server: ' + (mcpOk ? 'PASS' : 'FAIL'));
  process.exit(testsOk && mcpOk ? 0 : 1);
}

main().catch((error) => {
  console.error('runner crashed: ' + (error?.stack ?? error));
  process.exit(1);
});

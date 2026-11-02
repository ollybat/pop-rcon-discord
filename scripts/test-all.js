#!/usr/bin/env node
/**
 * Floating CI entry point: unit tests plus a real stdio smoke test of the MCP server.
 *
 *   npm run ci            # everything, exits non-zero on the first failure
 *   node scripts/test-all.js --no-mcp
 *
 * The whole run is printed and also written to ci-report.txt next to this project, so a host with
 * a short log buffer still leaves the full result behind.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const node = process.execPath;
const args = process.argv.slice(2);
const reportPath = join(root, 'ci-report.txt');
const report = [];

/** Print and remember a line. */
function say(line = '') {
  console.log(line);
  report.push(line);
}

function heading(text) {
  say('');
  say('=== ' + text + ' ===');
}

function testFiles() {
  const dir = join(root, 'test');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => join('test', name));
}

function run(args) {
  const result = spawnSync(node, args, { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: (result.stdout ?? '') + (result.stderr ?? '') };
}

function runUnitTests() {
  const files = testFiles();
  if (files.length === 0) {
    say('SKIP: no test files found under test/');
    return { ok: true, results: [] };
  }

  heading('unit tests (' + files.length + ' files)');
  say('files: ' + files.join(' '));
  say('node ' + process.version);

  // One node --test run first. Some hosts wrap node with a script that swallows flags, so fall
  // back to one process per file - which is what the runner does internally anyway.
  const together = run(['--test', ...files]);
  if (together.status === 0) {
    say(together.output);
    say('all ' + files.length + ' test file(s) passed in one run');
    return { ok: true, results: files.map((file) => ({ file, ok: true })) };
  }

  say('node --test exited with ' + together.status + ' - running each file on its own instead');
  say(together.output);

  const results = [];
  for (const file of files) {
    heading(file);
    const single = run([file]);
    say(single.output);
    results.push({ file, ok: single.status === 0 });
  }

  const failed = results.filter((entry) => !entry.ok);
  say('');
  say((files.length - failed.length) + '/' + files.length + ' test file(s) passed');
  return { ok: failed.length === 0, results };
}

/** Start the MCP server, speak a little JSON-RPC to it, and check the answers. */
function smokeTestMcp() {
  heading('mcp/server.js stdio smoke test');

  const serverPath = join(root, 'mcp', 'server.js');
  if (!existsSync(serverPath)) {
    say('SKIP: mcp/server.js is missing');
    return Promise.resolve(true);
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
      say('FAIL: the MCP server did not answer within 20s');
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
        if (!tool.name || !tool.description || !tool.inputSchema) failures.push('tool without a name, description or schema: ' + JSON.stringify(tool).slice(0, 60));
      }
      say('tools: ' + tools.map((tool) => tool.name).join(', '));

      const listServers = responses.get(4)?.result?.content?.[0]?.text ?? '';
      if (!listServers) failures.push('list_servers returned nothing');
      say('list_servers -> ' + (listServers.split('\n')[0] ?? '').slice(0, 120));

      const records = responses.get(5)?.result?.content?.[0]?.text ?? '';
      if (!records) failures.push('records returned nothing');
      say('records -> ' + (records.split('\n')[0] ?? '').slice(0, 120));

      const rawRcon = responses.get(6)?.result?.content?.[0]?.text ?? '';
      if (!/off/i.test(rawRcon)) failures.push('the raw rcon tool should be off by default, said: ' + rawRcon.slice(0, 80));

      if (!responses.get(7)?.result?.isError) failures.push('an unknown tool should come back as isError');
      if (responses.get(8)?.error?.code !== -32601) failures.push('an unknown method should be -32601');

      if (stderr.trim()) say('stderr: ' + stderr.trim().split('\n').slice(0, 4).join(' | '));

      for (const failure of failures) say('FAIL: ' + failure);
      if (failures.length === 0) say('PASS: ' + lines.length + ' responses, ' + tools.length + ' tools, protocol and errors behave');
      resolve(failures.length === 0);
    });
  });
}

async function main() {
  say('spinback ci on node ' + process.version + ' / ' + process.platform);
  const unit = runUnitTests();
  const mcpOk = args.includes('--no-mcp') ? true : await smokeTestMcp();

  heading('result');
  for (const entry of unit.results) say((entry.ok ? 'PASS  ' : 'FAIL  ') + entry.file);
  say('unit tests: ' + (unit.ok ? 'PASS' : 'FAIL'));
  say('mcp server: ' + (mcpOk ? 'PASS' : 'FAIL'));

  try {
    writeFileSync(reportPath, report.join('\n') + '\n');
    console.log('\nfull report written to ' + reportPath);
  } catch (error) {
    console.log('could not write the report file: ' + error.message);
  }

  process.exit(unit.ok && mcpOk ? 0 : 1);
}

main().catch((error) => {
  console.error('runner crashed: ' + (error?.stack ?? error));
  process.exit(1);
});

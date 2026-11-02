import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['src', 'scripts', 'test'];

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collect(full, found);
    } else if (entry.name.endsWith('.js')) {
      found.push(full);
    }
  }
  return found;
}

const files = TARGETS.flatMap((target) => collect(join(ROOT, target)));
const scratch = mkdtempSync(join(tmpdir(), 'pop-rcon-check-'));
const failures = [];

for (const file of files) {
  // Copy as .mjs so `node --check` always parses the file as an ES module.
  const copy = join(scratch, relative(ROOT, file).split(sep).join('_') + '.mjs');
  writeFileSync(copy, readFileSync(file));
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (error) {
    failures.push({ file: relative(ROOT, file), output: String(error.stderr || error.message).trim() });
  }
}

rmSync(scratch, { recursive: true, force: true });

if (files.length === 0) {
  console.error('No JavaScript files found to check.');
  process.exit(1);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error('FAIL ' + failure.file);
    console.error(failure.output);
  }
  console.error(failures.length + ' of ' + files.length + ' files failed to parse');
  process.exit(1);
}

console.log('Parsed ' + files.length + ' files without syntax errors.');

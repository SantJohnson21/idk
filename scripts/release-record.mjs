#!/usr/bin/env node
/**
 * Stamps MOBILE.md's build record from the artifacts that actually shipped.
 *
 *   node scripts/release-record.mjs
 *   node scripts/release-record.mjs --check
 *   node scripts/release-record.mjs --artifact android/app/build/outputs/apk/debug/app-debug.apk --label "Android debug APK"
 *
 * `npm run mobile:sync` calls this after `cap sync`; the APK/AAB/IPA scripts
 * call it again with their native artifact. `--check` fails when the committed
 * record no longer matches `dist/`, which is what keeps the notes honest.
 *
 * Gzip is zlib's default level, the same one Vite reports as `gzip:`.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const DOC = join(ROOT, 'MOBILE.md');
const START = '<!-- release-record:start -->';
const END = '<!-- release-record:end -->';

const argv = process.argv.slice(2);
let check = false;
let artifactPattern;
let label = 'Native artifact';

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--check') {
    check = true;
  } else if (arg === '--artifact') {
    artifactPattern = argv[++i];
    if (!artifactPattern) fail('--artifact needs a path');
  } else if (arg === '--label') {
    label = argv[++i];
    if (!label) fail('--label needs a value');
  } else if (arg === '--help' || arg === '-h') {
    console.log(
      [
        'Usage: node scripts/release-record.mjs [--check] [--artifact <path-or-glob>] [--label <text>]',
        '',
        '  --check              verify MOBILE.md matches dist/ (and the artifact, if given)',
        '  --artifact <path>    native APK/AAB/IPA to stamp; a basename glob is allowed',
        '  --label <text>       description for the native artifact',
      ].join('\n'),
    );
    process.exit(0);
  } else {
    fail(`unknown argument ${arg}`);
  }
}

function fail(message) {
  console.error(`release-record: ${message}`);
  process.exit(1);
}

const toPosix = (path) => path.split(sep).join('/');
const formatBytes = (bytes) => new Intl.NumberFormat('en-US').format(bytes);
const formatKb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
const formatMib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && entry.name !== '.DS_Store') files.push(path);
  }
  return files.sort();
}

async function hashFile(path) {
  const data = await readFile(path);
  return {
    raw: data.length,
    gzip: gzipSync(data).length,
    sha: createHash('sha256').update(data).digest('hex'),
  };
}

async function resolveArtifact(pattern) {
  const absolute = resolve(ROOT, pattern);
  let chosen = absolute;

  if (absolute.includes('*')) {
    const dir = dirname(absolute);
    const name = basename(absolute);
    const patternRe = new RegExp(
      '^' + name.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    );
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      fail(`artifact directory not found: ${toPosix(relative(ROOT, dir))}`);
    }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isFile() || !patternRe.test(entry.name)) continue;
      const path = join(dir, entry.name);
      matches.push({ path, mtime: (await stat(path)).mtimeMs });
    }
    if (!matches.length) fail(`no artifact matched ${pattern}`);
    matches.sort((a, b) => b.mtime - a.mtime);
    chosen = matches[0].path;
  }

  if (!existsSync(chosen)) fail(`artifact not found: ${toPosix(relative(ROOT, chosen))}`);

  const rel = toPosix(relative(ROOT, chosen));
  if (rel.startsWith('../') || isAbsolute(rel)) fail(`artifact must be inside the project: ${chosen}`);
  return { path: chosen, rel };
}

const isText = (path) => /\.(js|css|html|svg)$/i.test(path);

function row(file) {
  const gzip = isText(file.rel)
    ? `${formatBytes(file.gzip)} B · ${formatKb(file.gzip)}`
    : '_already compressed_'
  return `| \`${file.rel}\` | ${formatBytes(file.raw)} B | ${gzip} | \`${file.sha}\` |`;
}

async function makeBody(artifact) {
  if (!existsSync(DIST)) fail('dist/ not found — run `npm run build` first');

  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const files = [];
  for (const path of await walk(DIST)) {
    files.push({ rel: toPosix(relative(ROOT, path)), ...(await hashFile(path)) });
  }
  if (!files.length) fail('dist/ is empty — run `npm run build` first');

  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  const entryMatch = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  const entryPath = entryMatch ? `dist/assets/${entryMatch[1]}` : null;
  const entry = files.find((file) => file.rel === entryPath);

  const group = (path) => {
    if (path.endsWith('.js')) return 0;
    if (path.endsWith('.css')) return 1;
    if (path.endsWith('.html')) return 2;
    if (path.includes('/fonts/')) return 3;
    return 4;
  };
  files.sort((a, b) => {
    if (a.rel === entryPath) return -1;
    if (b.rel === entryPath) return 1;
    return group(a.rel) - group(b.rel) || a.rel.localeCompare(b.rel);
  });

  const payload = files.filter((file) => /\.(js|css|html)$/i.test(file.rel));
  const total = files.reduce((sum, file) => sum + file.raw, 0);
  const textGzip = files
    .filter((file) => isText(file.rel))
    .reduce((sum, file) => sum + file.gzip, 0);
  const payloadRaw = payload.reduce((sum, file) => sum + file.raw, 0);
  const payloadGzip = payload.reduce((sum, file) => sum + file.gzip, 0);

  const lines = [
    `### ${new Date().toISOString().slice(0, 10)} · ${packageJson.version}`,
    '',
    '| Artifact | Raw | Gzip (text) | SHA-256 |',
    '| --- | ---: | ---: | --- |',
    ...files.map(row),
    '',
    `**JS/CSS/HTML payload:** ${formatBytes(payloadRaw)} B raw → ${formatBytes(payloadGzip)} B gzip (${formatKb(
      payloadGzip,
    )}).`,
    `**All shipped files:** ${formatBytes(total)} B raw; ${formatBytes(
      textGzip,
    )} B with the text files above gzipped (fonts are served as-is).`,
  ];

  if (entry) {
    const shells = [
      `android/app/src/main/assets/public/${entry.rel.slice('dist/'.length)}`,
      `ios/App/App/public/${entry.rel.slice('dist/'.length)}`,
    ];
    const shellFacts = [];
    for (const shell of shells) {
      const absolute = join(ROOT, shell);
      if (!existsSync(absolute)) {
        shellFacts.push(`\`${shell}\` missing`);
        continue;
      }
      const hash = (await hashFile(absolute)).sha;
      shellFacts.push(`\`${shell}\` ${hash === entry.sha ? 'matches' : 'DIFFERS'}`);
    }
    lines.push(
      `**Native shells:** ${shellFacts.join('; ')} — \`${entry.sha.slice(0, 8)}…${entry.sha.slice(
        -5,
      )}\` in \`dist\`.`,
    );
  } else {
    lines.push('**Native shells:** no `index-*.js` entry found in `dist/index.html`.');
  }

  if (artifact) {
    const info = await hashFile(artifact.path);
    lines.push(
      `**Native artifact — ${cell(label)}:** \`${artifact.rel}\` — ${formatBytes(
        info.raw,
      )} B (${formatMib(info.raw)}), SHA-256 \`${info.sha}\`.`,
    );
  } else {
    lines.push('_No native artifact was stamped for this web-only record._');
  }

  return { body: lines.join('\n'), files, payloadRaw, payloadGzip, artifact };
}

function comparable(body, includeArtifact) {
  let text = body.replace(/^### \d{4}-\d{2}-\d{2} · /m, '### <date> · ');
  if (!includeArtifact) {
    text = text
      .replace(/^\*\*Native artifact — .*$/gm, '')
      .replace(/^_No native artifact was stamped for this web-only record\._$/gm, '');
  }
  return text.trim();
}

function showDiff(actual, expected) {
  const current = actual.split('\n');
  const wanted = expected.split('\n');
  for (let i = 0; i < Math.max(current.length, wanted.length); i += 1) {
    if (current[i] === wanted[i]) continue;
    console.error(`  line ${i + 1}`);
    console.error(`    in MOBILE.md: ${current[i] ?? '<missing>'}`);
    console.error(`    expected:    ${wanted[i] ?? '<missing>'}`);
    break;
  }
}

async function main() {
  const artifact = artifactPattern ? await resolveArtifact(artifactPattern) : null;
  const record = await makeBody(artifact);
  const document = await readFile(DOC, 'utf8');
  const start = document.indexOf(START);
  const end = document.indexOf(END, start + START.length);
  if (start < 0 || end < 0) fail(`MOBILE.md needs ${START} and ${END} around the build record`);

  const existing = document.slice(start + START.length, end).trim();
  if (check) {
    const actual = comparable(existing, Boolean(artifact));
    const expected = comparable(record.body, Boolean(artifact));
    if (actual !== expected) {
      console.error('release-record: MOBILE.md is stale');
      showDiff(actual, expected);
      console.error('  run `npm run release:record` (or `npm run mobile:sync`) to refresh it');
      process.exitCode = 1;
      return;
    }
    console.log(
      `release record OK · ${record.files.length} files · ${formatBytes(
        record.payloadRaw,
      )} B → ${formatBytes(record.payloadGzip)} B gzip${artifact ? ` · ${artifact.rel}` : ''}`,
    );
    return;
  }

  const next =
    document.slice(0, start) + START + '\n' + record.body + '\n' + END + document.slice(end + END.length);
  await writeFile(DOC, next);
  console.log(
    `stamped MOBILE.md · ${record.files.length} files · ${formatBytes(
      record.payloadRaw,
    )} B → ${formatBytes(record.payloadGzip)} B gzip${artifact ? ` · ${artifact.rel}` : ''}`,
  );
}

await main();

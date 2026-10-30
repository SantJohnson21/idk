/**
 * Tests for tools/play-publish.mjs — no Google credential, no network.
 *
 * The service account is a throwaway 2048-bit keypair generated in memory and
 * written to a temp dir, so this suite is safe to run anywhere and leaves
 * nothing in the repo. The bundle comes from store/ when one has been built;
 * without it the bundle-dependent checks are skipped rather than faked.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildAssertion, readBundleMeta } from './play-publish.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'tools', 'play-publish.mjs');
const STORE = join(ROOT, 'store');

const work = mkdtempSync(join(tmpdir(), 'rewind-play-'));
after(() => rmSync(work, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const clientEmail = 'qa@rewind-bowl-qa.iam.gserviceaccount.com';

const fixture = join(work, 'service-account.json');
writeFileSync(
  fixture,
  JSON.stringify({
    type: 'service_account',
    project_id: 'rewind-bowl-qa',
    private_key_id: 'qa-key-id',
    private_key: pem,
    client_email: clientEmail,
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
);

/** Newest AAB in store/, or null when this checkout has never built one. */
function newestBundle() {
  if (!existsSync(STORE)) return null;
  const bundles = readdirSync(STORE)
    .filter((name) => name.endsWith('.aab'))
    .map((name) => join(STORE, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return bundles[0] ?? null;
}

const bundle = newestBundle();

function playPublish(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // Blank the test overrides so these checks always see the real hosts.
    env: {
      ...process.env,
      PLAY_API_BASE_URL: '',
      PLAY_TOKEN_URI: '',
      PLAY_SERVICE_ACCOUNT_JSON: fixture,
      ...env,
    },
  });
}

test('dry run plans a real release without touching the network', { skip: !bundle && 'no store/*.aab in this checkout' }, () => {
  const meta = readBundleMeta(readFileSync(bundle));
  const result = playPublish(['--dry-run', '--bundle', bundle, '--notes', 'Closed test build.']);
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`versionCode ${meta.versionCode}\\b`));
  assert.match(output, new RegExp(`versionName ${meta.versionName}\\b`));
  assert.match(output, new RegExp(meta.packageName.replaceAll('.', '\\.')));
  assert.match(output, /POST\s+https:\/\/oauth2\.googleapis\.com\/token/);
  // The default API host must be Google's, not a leftover mock override.
  assert.match(
    output,
    /https:\/\/androidpublisher\.googleapis\.com\/androidpublisher\/v3\/applications\/com\.rewindbowl\.game\/edits/,
  );
  // The duplicate-versionCode guard reads Play's uploads before opening an edit.
  assert.match(
    output,
    /GET\s+https:\/\/androidpublisher\.googleapis\.com\/androidpublisher\/v3\/applications\/com\.rewindbowl\.game\/bundles/,
  );
  assert.match(output, /\/edits\{?|\/edits\b/);
  assert.match(output, /bundles\?uploadType=media/);
  assert.match(output, /\/tracks\/internal/);
  assert.match(output, /:commit/);
  assert.match(output, /no network calls made/);
  assert.doesNotMatch(output, /PRIVATE KEY/);
  assert.doesNotMatch(output, /eyJ[A-Za-z0-9_-]{20,}\./);
});

test('the manifest reader pulls the version out of the actual bundle', { skip: !bundle && 'no store/*.aab in this checkout' }, () => {
  const meta = readBundleMeta(readFileSync(bundle));
  assert.equal(meta.packageName, 'com.rewindbowl.game');
  assert.equal(meta.versionCode, 1);
  assert.match(meta.versionName, /^\d+\.\d+\.\d+$/);
  assert.ok(meta.entries > 10, `expected a populated archive, read ${meta.entries} entries`);
});

test('the assertion is a well-formed, verifiable RS256 JWT', () => {
  const assertion = buildAssertion({
    clientEmail,
    privateKey: pem,
    privateKeyId: 'qa-key-id',
    nowMs: 1_700_000_000_000,
  });
  const parts = assertion.split('.');
  assert.equal(parts.length, 3, 'a JWT is header.payload.signature');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');
  assert.equal(header.kid, 'qa-key-id');

  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(claims.iss, clientEmail);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(claims.exp - claims.iat, 3600);

  const verified = createVerify('RSA-SHA256')
    .update(`${parts[0]}.${parts[1]}`)
    .verify(publicKey, Buffer.from(parts[2], 'base64url'));
  assert.equal(verified, true, 'signature must verify against the generated public key');
});

test('a missing key exits 2 with one actionable line', () => {
  const result = playPublish(['--dry-run', '--bundle', bundle ?? join(work, 'none.aab')], {
    PLAY_SERVICE_ACCOUNT_JSON: join(work, 'absent.json'),
  });
  const lines = result.stderr.trim().split('\n').filter(Boolean);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(lines.length, 1, `expected a single line, got:\n${result.stderr}`);
  assert.match(lines[0], /play-publish: /);
  assert.match(lines[0], /service-account key/);
  assert.match(lines[0], /Play Console/);
});

test('a garbage key exits 2 and says what is wrong', () => {
  const broken = join(work, 'broken.json');
  writeFileSync(broken, JSON.stringify({ client_email: clientEmail, private_key: 'not a pem' }));
  const result = playPublish(['--dry-run'], { PLAY_SERVICE_ACCOUNT_JSON: broken });

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /not a usable RSA PEM/);
  assert.equal(result.stderr.trim().split('\n').filter(Boolean).length, 1);
});

test('a non-zip file passed as --bundle is rejected', () => {
  const fake = join(work, 'fake.aab');
  writeFileSync(fake, 'this is not an android app bundle');
  const result = playPublish(['--dry-run', '--bundle', fake]);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /not a valid AAB/);
});

test('an unknown track is rejected before anything else happens', () => {
  const result = playPublish(['--dry-run', '--track', 'staging']);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /--track must be one of internal, alpha, beta, production/);
});

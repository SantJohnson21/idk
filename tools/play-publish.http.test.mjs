/**
 * The real HTTP exchange — against a local mock of Play, never Google.
 *
 * `--dry-run` proves only the local validation; it sends nothing. This suite
 * proves the rest: a throwaway RSA key mints an assertion, the publisher opens
 * an edit, uploads the actual bytes of store/*.aab, sets the track, commits, and
 * deletes the edit when a step fails.
 *
 * Every request lands on an http server started below, so the suite needs no
 * Google credential and no network egress, and it leaves nothing behind: the
 * keypair is generated in memory and the fixture lives in a temp dir.
 *
 * Note on the count: `--dry-run` prints seven plan lines, the seventh being the
 * conditional cleanup. A successful publish is six requests — token, bundles,
 * edit, upload, track, commit — and that is exactly what is asserted here.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBundleMeta } from './play-publish.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'tools', 'play-publish.mjs');
const STORE = join(ROOT, 'store');
const PACKAGE = 'com.rewindbowl.game';
const API = `/androidpublisher/v3/applications/${PACKAGE}`;
const EDIT_PATH = `${API}/edits/qa-edit-1`;
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const work = mkdtempSync(join(tmpdir(), 'rewind-play-http-'));
after(() => rmSync(work, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const clientEmail = 'qa@rewind-bowl-http.iam.gserviceaccount.com';

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
const bundle = (() => {
  if (!existsSync(STORE)) return null;
  const found = readdirSync(STORE)
    .filter((name) => name.endsWith('.aab'))
    .map((name) => join(STORE, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
})();
const NO_BUNDLE = !bundle && 'no store/*.aab in this checkout';
const bundleBytes = bundle ? readFileSync(bundle) : null;
const bundleMeta = bundle ? readBundleMeta(bundleBytes) : null;
const bundleSha = bundle ? createHash('sha256').update(bundleBytes).digest('hex') : null;

/* ------------------------------------------------------------------- the mock -- */

function replyTo(record) {
  const { method, path } = record;
  if (path === '/token' && method === 'POST') {
    return { status: 200, json: { access_token: 'qa-access-token', token_type: 'Bearer', expires_in: 3600 } };
  }
  if (method === 'GET' && path === `${API}/bundles`) {
    return { status: 200, json: { kind: 'androidpublisher#bundlesList', bundles: [] } };
  }
  if (method === 'POST' && path === `${API}/edits`) return { status: 200, json: { id: 'qa-edit-1' } };
  if (method === 'POST' && path === `${EDIT_PATH}/bundles`) {
    return { status: 200, json: { versionCode: String(bundleMeta?.versionCode ?? 1) } };
  }
  if (method === 'PUT' && path.startsWith(`${EDIT_PATH}/tracks/`)) {
    return { status: 200, json: { track: path.split('/').pop() } };
  }
  if (method === 'POST' && path === `${EDIT_PATH}:commit`) return { status: 200, json: { id: 'qa-edit-1' } };
  if (method === 'DELETE' && path === EDIT_PATH) return { status: 200, json: { id: 'qa-edit-1' } };
  return { status: 404, json: { error: { code: 404, message: `unexpected ${method} ${path}` } } };
}

/** A short, stable name for each request, so order assertions read clearly. */
function label(record) {
  if (record.path === '/token') return 'token';
  if (record.method === 'GET' && record.path === `${API}/bundles`) return 'bundle-list';
  if (record.method === 'POST' && record.path === `${API}/edits`) return 'edit-open';
  if (record.method === 'POST' && record.path === `${EDIT_PATH}/bundles`) return 'bundle-upload';
  if (record.method === 'PUT' && record.path.startsWith(`${EDIT_PATH}/tracks/`)) return 'track-set';
  if (record.method === 'POST' && record.path === `${EDIT_PATH}:commit`) return 'commit';
  if (record.method === 'DELETE' && record.path === EDIT_PATH) return 'edit-delete';
  return `${record.method} ${record.path}`;
}

/**
 * Start a mock Play. `fail(record, index)` may return a {status, json} reply to
 * force a failure at a chosen point; returning null lets the default answer run.
 */
async function startMock(fail) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const record = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'] ?? '',
      body,
    };
    requests.push(record);
    const reply = (fail && fail(record, requests.length)) || replyTo(record);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.json));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    requests,
    async close() {
      const done = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.(); // fetch keeps sockets alive
      await done;
    },
    /** Run the real CLI as a child process, pointed at this mock. */
    run(args) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
          cwd: ROOT,
          env: {
            ...process.env,
            PLAY_SERVICE_ACCOUNT_JSON: fixture,
            PLAY_API_BASE_URL: origin,
            PLAY_TOKEN_URI: `${origin}/token`,
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('close', (status) => resolve({ status, stdout, stderr, output: stdout + stderr }));
      });
    },
  };
}

/* ----------------------------------------------------------------------- tests -- */

test(
  'a publish sends token → edit → upload → track → commit, in that order',
  { skip: NO_BUNDLE },
  async () => {
    const mock = await startMock();
    try {
      const notes = 'Closed test 1.0.0 (1) — mock run.';
      const result = await mock.run(['--yes', '--bundle', bundle, '--track', 'internal', '--notes', notes]);

      assert.equal(result.status, 0, result.output);
      assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list', 'edit-open', 'bundle-upload', 'track-set', 'commit']);
      assert.deepEqual(
        mock.requests.map((request) => `${request.method} ${request.path}`),
        [
          `POST /token`,
          `GET ${API}/bundles`,
          `POST ${API}/edits`,
          `POST ${EDIT_PATH}/bundles`,
          `PUT ${EDIT_PATH}/tracks/internal`,
          `POST ${EDIT_PATH}:commit`,
        ],
      );
      assert.match(result.stdout, /HTTP plan — 7 requests/);

      // 1. The assertion is a real RSA signature over the expected claims.
      const token = mock.requests[0];
      assert.match(token.contentType, /application\/x-www-form-urlencoded/);
      const form = new URLSearchParams(token.body.toString('utf8'));
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

      const assertion = form.get('assertion');
      assert.ok(assertion, 'the token request must carry an assertion');
      const parts = assertion.split('.');
      assert.equal(parts.length, 3, 'a JWT is header.payload.signature');

      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      assert.equal(header.alg, 'RS256');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      assert.equal(claims.iss, clientEmail);
      assert.equal(claims.aud, `${mock.origin}/token`);
      assert.equal(claims.scope, SCOPE);
      const now = Math.floor(Date.now() / 1000);
      assert.ok(claims.iat <= now + 5 && claims.iat > now - 120, `iat ${claims.iat} is not current (${now})`);
      assert.equal(claims.exp - claims.iat, 3600);

      const verified = createVerify('RSA-SHA256')
        .update(`${parts[0]}.${parts[1]}`)
        .verify(publicKey, Buffer.from(parts[2], 'base64url'));
      assert.equal(verified, true, 'the signature must verify against the generated public key');

      // 2. Every API call carries the minted token, never the key.
      for (const request of mock.requests.slice(1)) {
        assert.equal(request.authorization, 'Bearer qa-access-token');
      }

      // 3. The uploaded bytes are the bundle on disk, byte for byte.
      const upload = mock.requests[3];
      assert.equal(upload.search, '?uploadType=media');
      assert.match(upload.contentType, /application\/octet-stream/);
      assert.equal(upload.body.length, bundleBytes.length, 'uploaded size must equal the AAB size');
      assert.equal(createHash('sha256').update(upload.body).digest('hex'), bundleSha, 'uploaded body hash must match the AAB');

      // 4. The track call names the track and carries the en-US notes.
      const track = JSON.parse(mock.requests[4].body.toString('utf8'));
      assert.equal(track.track, 'internal');
      assert.equal(track.releases.length, 1);
      assert.equal(track.releases[0].status, 'completed');
      assert.deepEqual(track.releases[0].versionCodes, [String(bundleMeta.versionCode)]);
      assert.deepEqual(track.releases[0].releaseNotes, [{ language: 'en-US', text: notes }]);

      // 5. Commit is last, and nothing was cleaned up on the happy path.
      assert.equal(mock.requests.filter((request) => label(request) === 'commit').length, 1);
      assert.equal(mock.requests.filter((request) => label(request) === 'edit-delete').length, 0);
      assert.match(result.stdout, /edit qa-edit-1 committed/);
    } finally {
      await mock.close();
    }
  },
);

test('--track and --notes-file reach Play verbatim', { skip: NO_BUNDLE }, async () => {
  const notesPath = join(work, 'notes.txt');
  writeFileSync(notesPath, 'Beta notes read from a file.\n');
  const mock = await startMock();
  try {
    const result = await mock.run(['--yes', '--bundle', bundle, '--track', 'beta', '--notes-file', notesPath]);
    assert.equal(result.status, 0, result.output);

    const put = mock.requests.find((request) => request.method === 'PUT');
    assert.equal(put.path, `${EDIT_PATH}/tracks/beta`);
    const body = JSON.parse(put.body.toString('utf8'));
    assert.equal(body.track, 'beta');
    assert.equal(body.releases[0].releaseNotes[0].text, 'Beta notes read from a file.');
    assert.equal(body.releases[0].releaseNotes[0].language, 'en-US');
    assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list', 'edit-open', 'bundle-upload', 'track-set', 'commit']);
  } finally {
    await mock.close();
  }
});

test('a versionCode Play already has is refused before an edit is opened', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock((record) =>
    record.method === 'GET' && record.path === `${API}/bundles`
      ? { status: 200, json: { bundles: [{ versionCode: bundleMeta.versionCode, sha256: 'stale' }] } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--bundle', bundle]);
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, new RegExp(`versionCode ${bundleMeta.versionCode} is already on Play`));
    assert.match(result.stderr, /-PversionCode=\d+/);
    assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list']);
    assert.equal(mock.requests.filter((request) => label(request) === 'edit-open').length, 0);
  } finally {
    await mock.close();
  }
});

test('a rejected key fails before any edit is opened', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock((record) =>
    record.path === '/token'
      ? { status: 401, json: { error: 'invalid_grant', error_description: 'Invalid JWT: unable to parse' } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--bundle', bundle]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /Google refused the key \(HTTP 401/);
    assert.match(result.stderr, /Release to testing tracks/);
    assert.deepEqual(mock.requests.map(label), ['token']);
  } finally {
    await mock.close();
  }
});

test('a 403 on the first API call opens no edit and needs no cleanup', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock((record) =>
    record.method === 'POST' && record.path === `${API}/edits`
      ? { status: 403, json: { error: { code: 403, message: 'The caller does not have permission' } } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--bundle', bundle]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /HTTP 403/);
    assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list', 'edit-open']);
    assert.doesNotMatch(result.stderr, /deleted/);
  } finally {
    await mock.close();
  }
});

test('a failed upload deletes the open edit and never commits', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock((record) =>
    record.path === `${EDIT_PATH}/bundles`
      ? { status: 500, json: { error: { code: 500, message: 'Internal error while uploading' } } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--bundle', bundle]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /HTTP 500/);
    assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list', 'edit-open', 'bundle-upload', 'edit-delete']);
    assert.match(result.stderr, /edit qa-edit-1 deleted — Play has no half-built release/);
    assert.equal(mock.requests.filter((request) => label(request) === 'commit').length, 0);
  } finally {
    await mock.close();
  }
});

test('a failed commit deletes the open edit and leaves nothing published', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock((record) =>
    record.path === `${EDIT_PATH}:commit` && record.method === 'POST'
      ? { status: 503, json: { error: { code: 503, message: 'Service unavailable' } } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--bundle', bundle]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /HTTP 503/);
    assert.deepEqual(mock.requests.map(label), ['token', 'bundle-list', 'edit-open', 'bundle-upload', 'track-set', 'commit', 'edit-delete']);
    assert.match(result.stderr, /edit qa-edit-1 deleted/);
    assert.doesNotMatch(result.stdout, /committed/);
  } finally {
    await mock.close();
  }
});

test('without --yes on a non-TTY stdin it refuses and sends nothing', { skip: NO_BUNDLE }, async () => {
  const mock = await startMock();
  try {
    const result = await mock.run(['--bundle', bundle, '--track', 'internal']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, /refusing to publish without --yes when stdin is not a terminal/);
    assert.equal(mock.requests.length, 0, 'a refusal must not mint a token or open an edit');
  } finally {
    await mock.close();
  }
});

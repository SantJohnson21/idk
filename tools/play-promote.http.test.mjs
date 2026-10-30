/**
 * Promotion over real HTTP, against the local mock Play.
 *
 * These are the checks `--dry-run` cannot make: the track read, the refusal when
 * the source has no such build, the edit → track set → validate → commit
 * exchange, and the cleanup that follows a failure. No Google credential and no
 * network egress are involved; the key is generated in memory.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API, EDIT_PATH, startMockPlay } from './mock-play.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROMOTE = join(ROOT, 'tools', 'play-promote.mjs');

const work = mkdtempSync(join(tmpdir(), 'rewind-promote-'));
after(() => rmSync(work, { recursive: true, force: true }));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fixture = join(work, 'service-account.json');
writeFileSync(
  fixture,
  JSON.stringify({
    type: 'service_account',
    project_id: 'rewind-bowl-qa',
    private_key_id: 'qa-key-id',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    client_email: 'qa@rewind-bowl-promote.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
);

const TRACKS = [
  { track: 'internal', releases: [{ name: '1.0.0 (1)', versionCodes: ['1'], status: 'completed' }] },
  { track: 'alpha', releases: [] },
  { track: 'beta', releases: [] },
  { track: 'production', releases: [] },
];

const startMock = (options = {}) =>
  startMockPlay({
    fixture,
    cli: PROMOTE,
    tracks: TRACKS,
    ...(typeof options === 'function' ? { fail: options } : options),
  });

function label(record) {
  if (record.path === '/token') return 'token';
  if (record.method === 'GET' && record.path === `${API}/tracks`) return 'track-list';
  if (record.method === 'POST' && record.path === `${API}/edits`) return 'edit-open';
  if (record.method === 'PUT' && record.path === `${EDIT_PATH}/tracks/alpha`) return 'track-set';
  if (record.method === 'POST' && record.path === `${EDIT_PATH}:validate`) return 'validate';
  if (record.method === 'POST' && record.path === `${EDIT_PATH}:commit`) return 'commit';
  if (record.method === 'DELETE' && record.path === EDIT_PATH) return 'edit-delete';
  return `${record.method} ${record.path}`;
}

test('a promotion goes token → track-list → edit → track-set → validate → commit', async () => {
  const mock = await startMock();
  try {
    const result = await mock.run(['--yes', '--from', 'internal', '--to', 'alpha']);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(mock.requests.map(label), [
      'token',
      'track-list',
      'edit-open',
      'track-set',
      'validate',
      'commit',
    ]);
    assert.deepEqual(
      mock.requests.map((request) => `${request.method} ${request.path}`),
      [
        'POST /token',
        `GET ${API}/tracks`,
        `POST ${API}/edits`,
        `PUT ${EDIT_PATH}/tracks/alpha`,
        `POST ${EDIT_PATH}:validate`,
        `POST ${EDIT_PATH}:commit`,
      ],
    );

    for (const request of mock.requests.slice(1)) {
      assert.equal(request.authorization, 'Bearer qa-access-token');
    }

    const put = JSON.parse(mock.requests[3].body.toString('utf8'));
    assert.equal(put.track, 'alpha');
    assert.equal(put.releases.length, 1);
    assert.deepEqual(put.releases[0].versionCodes, ['1']);
    assert.equal(put.releases[0].status, 'completed');

    // A promotion never uploads anything.
    assert.equal(mock.requests.filter((request) => request.path.endsWith('/bundles')).length, 0);
    assert.match(result.stdout, /promoted versionCode 1 from internal to alpha/);
  } finally {
    await mock.close();
  }
});

test('it refuses before opening an edit when the source track has no release', async () => {
  const mock = await startMock({
    tracks: TRACKS.map((track) => (track.track === 'internal' ? { track: 'internal', releases: [] } : track)),
  });
  try {
    const result = await mock.run(['--yes', '--from', 'internal', '--to', 'alpha']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, /the internal track has no completed release/);
    assert.match(result.stderr, /play:publish/);
    assert.deepEqual(mock.requests.map(label), ['token', 'track-list']);
    assert.equal(mock.requests.filter((request) => label(request) === 'edit-open').length, 0);
  } finally {
    await mock.close();
  }
});

test('it refuses a versionCode the source track does not carry', async () => {
  const mock = await startMock();
  try {
    const result = await mock.run(['--yes', '--from', 'internal', '--to', 'beta', '--version-code', '9']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.stderr, /versionCode 9 is not on the internal track/);
    assert.deepEqual(mock.requests.map(label), ['token', 'track-list']);
  } finally {
    await mock.close();
  }
});

test('a failure after the edit opens deletes the edit', async () => {
  const mock = await startMock((record) =>
    record.path === `${EDIT_PATH}:validate`
      ? { status: 400, json: { error: { code: 400, message: 'Track is not available for the given app' } } }
      : null,
  );
  try {
    const result = await mock.run(['--yes', '--from', 'internal', '--to', 'alpha']);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /HTTP 400/);
    assert.deepEqual(mock.requests.map(label), [
      'token',
      'track-list',
      'edit-open',
      'track-set',
      'validate',
      'edit-delete',
    ]);
    assert.match(result.stderr, /edit qa-edit-1 deleted/);
    assert.equal(mock.requests.filter((request) => label(request) === 'commit').length, 0);
  } finally {
    await mock.close();
  }
});

test('--dry-run prints the plan and sends nothing', async () => {
  const mock = await startMock();
  try {
    const result = await mock.run(['--dry-run']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /PLAY PROMOTE — DRY RUN/);
    assert.match(result.stdout, /HTTP plan — 7 requests, none sent in a dry run/);
    assert.match(result.stdout, /no network calls made/);
    assert.match(
      result.stdout,
      /GET\s+http:\/\/127\.0\.0\.1:\d+\/androidpublisher\/v3\/applications\/com\.rewindbowl\.game\/tracks/,
    );
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

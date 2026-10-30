/**
 * A local stand-in for Google Play's Android Publisher API.
 *
 * Both `play-publish.http.test.mjs` and `play-promote.http.test.mjs` drive the
 * real CLI against this server: it records every request (method, path, query,
 * auth header, bytes) and answers the handful of endpoints the tools use. No
 * Google credential and no network egress are involved; the caller supplies a
 * throwaway service-account file that it wrote to a temp dir.
 *
 * A test can force a failure point with `fail(record, index)`: return a
 * `{ status, json }` reply from it, or null to let the default routing answer.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PACKAGE = 'com.rewindbowl.game';
export const API = `/androidpublisher/v3/applications/${PACKAGE}`;
export const EDIT_PATH = `${API}/edits/qa-edit-1`;
export const ACCESS_TOKEN = 'qa-access-token';
export const PUBLISH_CLI = join(ROOT, 'tools', 'play-publish.mjs');

/** What Play reports for an app whose only upload is versionCode 1 on internal. */
export const DEFAULT_TRACKS = [
  { track: 'internal', releases: [{ name: '1.0.0 (1)', versionCodes: ['1'], status: 'completed' }] },
  { track: 'alpha', releases: [] },
  { track: 'beta', releases: [] },
  { track: 'production', releases: [] },
];

function defaultReply(record, { versionCode, tracks }) {
  const { method, path } = record;
  if (path === '/token' && method === 'POST') {
    return { status: 200, json: { access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 } };
  }
  if (method === 'GET' && path === `${API}/bundles`) {
    return { status: 200, json: { kind: 'androidpublisher#bundlesList', bundles: [] } };
  }
  if (method === 'GET' && path === `${API}/tracks`) {
    return { status: 200, json: { kind: 'androidpublisher#tracksList', tracks } };
  }
  if (method === 'POST' && path === `${API}/edits`) return { status: 200, json: { id: 'qa-edit-1' } };
  if (method === 'POST' && path === `${EDIT_PATH}/bundles`) {
    return { status: 200, json: { versionCode: String(versionCode) } };
  }
  if (method === 'PUT' && path.startsWith(`${EDIT_PATH}/tracks/`)) {
    return { status: 200, json: { track: path.split('/').pop() } };
  }
  if (method === 'POST' && path === `${EDIT_PATH}:validate`) return { status: 200, json: {} };
  if (method === 'POST' && path === `${EDIT_PATH}:commit`) return { status: 200, json: { id: 'qa-edit-1' } };
  if (method === 'DELETE' && path === EDIT_PATH) return { status: 200, json: { id: 'qa-edit-1' } };
  return { status: 404, json: { error: { code: 404, message: `unexpected ${method} ${path}` } } };
}

/**
 * Start the mock. `fixture` is the temp service-account JSON the CLI reads,
 * `cli` picks which tool `run()` executes, and `tracks` seeds GET /tracks.
 */
export async function startMockPlay({
  fixture,
  cli = PUBLISH_CLI,
  versionCode = 1,
  tracks = DEFAULT_TRACKS,
  fail,
} = {}) {
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
    const reply = (fail && fail(record, requests.length)) || defaultReply(record, { versionCode, tracks });
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
    run(args, env = {}) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [cli, ...args], {
          cwd: ROOT,
          env: {
            ...process.env,
            PLAY_SERVICE_ACCOUNT_JSON: fixture,
            PLAY_API_BASE_URL: origin,
            PLAY_TOKEN_URI: `${origin}/token`,
            ...env,
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

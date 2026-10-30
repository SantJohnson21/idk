#!/usr/bin/env node
/**
 * Publish a signed AAB to Google Play, without Gradle, gcloud or npm packages.
 *
 * Play has no unauthenticated upload path: a release goes through either the
 * web UI behind a human's Google account, or the Android Publisher v3 REST API
 * behind a service account. This script takes the second route, so the only
 * thing it needs from you is one JSON key created once in the console.
 *
 *   node tools/play-publish.mjs --dry-run
 *   node tools/play-publish.mjs --track internal --notes "..." 
 *
 * Why hand-rolled: the bundle is built by Gradle, but this repo has no JDK,
 * no bundletool and no npm dependencies in a clean checkout, so `fastlane
 * supply` and `gcloud` are both out of reach. RS256 signing plus five REST
 * calls is small enough to keep in node:crypto and node:zlib.
 *
 * Nothing here prints the private key or the access token, and error text is
 * scrubbed before it reaches the terminal.
 */
import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_API_BASE = 'https://androidpublisher.googleapis.com';
const API_VERSION = 'androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DEFAULT_PACKAGE = 'com.rewindbowl.game';
const TRACKS = ['internal', 'alpha', 'beta', 'production'];
const NOTES_LIMIT = 500;
const BUNDLE_NAME = 'base/manifest/AndroidManifest.xml';
const CONFIG_NAME = 'BundleConfig.pb';

/** A failure the user can act on. Exit 2 = bad input/config, not a Play problem. */
class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/* ------------------------------------------------------------------ redaction -- */

const REDACTIONS = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[redacted private key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]'],
  [/\bya29\.[A-Za-z0-9._-]+/g, '[redacted token]'],
  [/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[redacted]"'],
];

/** Strip anything that looks like a credential, then flatten to one line. */
export function redact(value) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------------------- args -- */

const USAGE = `usage: node tools/play-publish.mjs [options]

  --bundle <path>       AAB to upload (default: newest store/*.aab)
  --package <name>      must match the bundle's package (default: ${DEFAULT_PACKAGE})
  --track <name>        internal | alpha | beta | production (default: internal)
  --notes <text>        release notes, en-US, ${NOTES_LIMIT} characters max
  --notes-file <path>   read those notes from a file instead
  --dry-run             validate everything, print the HTTP plan, send nothing
  --yes                 skip the typed confirmation (required in a non-TTY)
  --help                this text

The service-account JSON is read from $PLAY_SERVICE_ACCOUNT_JSON, or from
store/play-service-account.json when that exists.

$PLAY_API_BASE_URL replaces https://androidpublisher.googleapis.com and
$PLAY_TOKEN_URI replaces https://oauth2.googleapis.com/token. Both exist so the
test suite can point this script at a local mock instead of Google.`;

export function parseArgs(argv) {
  const opts = { dryRun: false, yes: false, help: false };
  const takesValue = {
    '--bundle': 'bundle',
    '--package': 'package',
    '--track': 'track',
    '--notes': 'notes',
    '--notes-file': 'notesFile',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (takesValue[arg]) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`${arg} needs a value`);
      }
      opts[takesValue[arg]] = value;
    } else throw new CliError(`unknown option ${arg} (try --help)`);
  }
  if (opts.track && !TRACKS.includes(opts.track)) {
    throw new CliError(`--track must be one of ${TRACKS.join(', ')} — got "${opts.track}"`);
  }
  if (opts.notes && opts.notesFile) {
    throw new CliError('pass --notes or --notes-file, not both');
  }
  return opts;
}

/* ------------------------------------------------------------------------ zip -- */
/* An AAB is a zip. Node has zlib but no zip reader, so the central directory is
 * walked directly — 80 lines instead of a dependency, and it works for both the
 * stored and deflated entries aapt2 writes. */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * @returns {Map<string, {method: number, compressedSize: number, size: number, offset: number}>}
 */
export function readZipDirectory(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || offset === 0xffffffff) {
      throw new CliError('this bundle is a zip64 archive, which this reader does not handle');
    }
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    entries.set(name, { method, compressedSize, size, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buf, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new CliError(`the bundle has no ${name} entry`);
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL) {
    throw new CliError(`the bundle's ${name} entry has a broken local header`);
  }
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new CliError(`the bundle's ${name} entry uses unsupported compression ${entry.method}`);
}

/* ------------------------------------------------------------- protobuf / AAB -- */
/* Inside an AAB the manifest is protobuf-encoded XML (Resources.proto), not the
 * binary AXML an APK carries. Only three attributes matter here, and a varint
 * walker is enough to reach them. */

function readVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    if (i >= buf.length) throw new CliError('truncated protobuf varint in the bundle manifest');
    const byte = buf[i++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, i];
    shift += 7;
    if (shift > 49) throw new CliError('malformed protobuf varint in the bundle manifest');
  }
}

/** Decode one protobuf message into {field, wire, value|bytes} records. */
export function decodeFields(buf) {
  const fields = [];
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = readVarint(buf, i);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (field === 0) break;
    if (wire === 0) {
      let value;
      [value, i] = readVarint(buf, i);
      fields.push({ field, wire, value });
    } else if (wire === 1) {
      fields.push({ field, wire, bytes: buf.subarray(i, i + 8) });
      i += 8;
    } else if (wire === 2) {
      let length;
      [length, i] = readVarint(buf, i);
      fields.push({ field, wire, bytes: buf.subarray(i, i + length) });
      i += length;
    } else if (wire === 5) {
      fields.push({ field, wire, bytes: buf.subarray(i, i + 4) });
      i += 4;
    } else {
      throw new CliError(`unsupported protobuf wire type ${wire} in the bundle manifest`);
    }
    if (i > buf.length) throw new CliError('truncated protobuf message in the bundle manifest');
  }
  return fields;
}

const messages = (fields, field) => fields.filter((f) => f.field === field && f.wire === 2);
const text = (fields, field) => {
  const found = messages(fields, field)[0];
  return found ? found.bytes.toString('utf8') : undefined;
};

/** versionCode is usually a decimal string; fall back to the compiled int. */
function compiledInt(attribute) {
  for (const container of [...messages(attribute, 6), ...messages(attribute, 5)]) {
    const item = decodeFields(container.bytes);
    const primitive = messages(item, 7)[0];
    if (!primitive) continue;
    const values = decodeFields(primitive.bytes);
    const decimal = values.find((f) => f.field === 6 && f.wire === 0);
    if (decimal) return decimal.value;
    const hex = messages(values, 7)[0];
    if (hex) {
      const digits = hex.bytes.toString('latin1');
      if (/^[0-9a-fA-F]+$/.test(digits)) return parseInt(digits, 16);
    }
  }
  return undefined;
}

/**
 * Read package, versionName and versionCode out of a real AAB, proving on the
 * way that it is a zip with a bundle manifest and a BundleConfig.pb.
 */
export function readBundleMeta(buf) {
  const entries = readZipDirectory(buf);
  if (!entries) throw new CliError('that file is not a valid AAB — its zip directory is unreadable');
  if (!entries.has(CONFIG_NAME)) throw new CliError(`that file is not an AAB — no ${CONFIG_NAME} at the root`);
  if (!entries.has(BUNDLE_NAME)) throw new CliError(`that file is not an AAB — no ${BUNDLE_NAME}`);

  let root;
  try {
    root = decodeFields(readZipEntry(buf, entries, BUNDLE_NAME));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`could not read ${BUNDLE_NAME} inside the bundle`);
  }
  const rootNode = messages(root, 1)[0]; // XmlNode.element
  if (!rootNode) throw new CliError('the bundle manifest has no root element');
  const element = decodeFields(rootNode.bytes);
  if (text(element, 3) !== 'manifest') {
    throw new CliError('the bundle manifest does not start with <manifest>');
  }

  const attributes = messages(element, 4).map((f) => decodeFields(f.bytes));
  const attribute = (name) => attributes.find((a) => text(a, 2) === name);

  const packageName = attribute('package') && text(attribute('package'), 3);
  const versionName = attribute('versionName') && text(attribute('versionName'), 3);
  const codeAttribute = attribute('versionCode');
  let versionCode;
  if (codeAttribute) {
    const asText = text(codeAttribute, 3);
    versionCode = asText && /^\d+$/.test(asText) ? Number(asText) : compiledInt(codeAttribute);
  }

  if (!packageName) throw new CliError('the bundle manifest has no package name');
  if (!versionName) throw new CliError('the bundle manifest has no versionName');
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new CliError('the bundle manifest has no readable versionCode');
  }
  return { packageName, versionName, versionCode, entries: entries.size };
}

/* ------------------------------------------------------------------- the key -- */

export function resolveKeyPath(env = process.env) {
  const fromEnv = env.PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (fromEnv) return resolve(REPO_ROOT, fromEnv);
  return join(REPO_ROOT, 'store', 'play-service-account.json');
}

/** The key's own token_uri, unless an explicit override is set for tests. */
export function resolveTokenUri(account, env = process.env) {
  const override = env.PLAY_TOKEN_URI?.trim();
  return override || account?.tokenUri || DEFAULT_TOKEN_URI;
}

/**
 * Parse and prove the service account: right fields, and a PEM that can
 * actually produce an RS256 signature. Nothing here touches the network.
 */
export function loadServiceAccount(path) {
  const hint =
    'create one in Play Console → Setup → API access → Create service account, download the JSON key, ' +
    'and save it there (or point PLAY_SERVICE_ACCOUNT_JSON at it)';
  if (!existsSync(path)) {
    throw new CliError(`no Google Play service-account key at ${path} — ${hint}`);
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`could not read ${path} (${error.code ?? 'read error'}) — ${hint}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CliError(`${path} is not valid JSON — download the service-account key again from Play Console`);
  }
  for (const field of ['client_email', 'private_key']) {
    if (typeof json[field] !== 'string' || !json[field]) {
      throw new CliError(`${path} has no "${field}" — that is not a service-account key`);
    }
  }
  const tokenUri = typeof json.token_uri === 'string' ? json.token_uri : DEFAULT_TOKEN_URI;
  try {
    const key = createPrivateKey({ key: json.private_key, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa') throw new Error(`it is a ${key.asymmetricKeyType} key`);
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits && bits < 2048) throw new Error(`a ${bits}-bit RSA key is too small for Google`);
    createSign('RSA-SHA256').update('probe').sign(json.private_key);
  } catch (error) {
    throw new CliError(`the private_key in ${path} is not a usable RSA PEM (${redact(error.message)})`);
  }
  return {
    clientEmail: json.client_email,
    privateKey: json.private_key,
    privateKeyId: typeof json.private_key_id === 'string' ? json.private_key_id : undefined,
    tokenUri,
  };
}

const base64url = (value) => Buffer.from(value).toString('base64url');

/** A signed RS256 JWT assertion — the whole of "authentication" for this API. */
export function buildAssertion({
  clientEmail,
  privateKey,
  privateKeyId,
  tokenUri = DEFAULT_TOKEN_URI,
  scope = SCOPE,
  nowMs = Date.now(),
}) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (privateKeyId) header.kid = privateKeyId;
  const claims = { iss: clientEmail, scope, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600 };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

/* ----------------------------------------------------------------- the plan -- */

/** The API host, overridable so the mock suite never needs Google. */
export function apiBase(env = process.env) {
  return (env.PLAY_API_BASE_URL?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export const applicationsUrl = (packageName, base = apiBase()) =>
  `${base}/${API_VERSION}/applications/${encodeURIComponent(packageName)}`;

export function planRequests({
  base,
  track,
  versionCode,
  versionName,
  bundleBytes,
  notes,
  tokenUri = DEFAULT_TOKEN_URI,
}) {
  const edit = `${base}/edits/{editId}`;
  return [
    { step: 'POST', url: tokenUri, detail: 'OAuth2 token from a signed JWT assertion' },
    { step: 'GET', url: `${base}/bundles`, detail: 'list uploads — refuse a versionCode Play already has' },
    { step: 'POST', url: `${base}/edits`, detail: 'open an edit (the staging area for one release)' },
    {
      step: 'POST',
      url: `${edit}/bundles?uploadType=media`,
      detail: `body: ${bundleBytes.length.toLocaleString('en-US')} B, application/octet-stream`,
    },
    {
      step: 'PUT',
      url: `${edit}/tracks/${track}`,
      detail: JSON.stringify({
        track,
        releases: [
          {
            name: `${versionName} (${versionCode})`,
            versionCodes: [String(versionCode)],
            status: 'completed',
            ...(notes ? { releaseNotes: [{ language: 'en-US', text: notes }] } : {}),
          },
        ],
      }),
    },
    { step: 'POST', url: `${edit}:commit`, detail: 'publish the edit — this is the point of no return' },
    { step: 'DELETE', url: edit, detail: 'only if a later step fails, so no half-built release is left behind' },
  ];
}

/* ------------------------------------------------------------------- network -- */

async function readError(response) {
  const body = await response.text().catch(() => '');
  return redact(body).slice(0, 600) || response.statusText;
}

async function call(url, { method = 'GET', token, body, contentType, timeoutMs = 180_000 }) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new CliError(`${method} ${url} failed before a response (${redact(error.message)})`, 1);
  }
  if (!response.ok) {
    throw new CliError(`${method} ${url} → HTTP ${response.status}: ${await readError(response)}`, 1);
  }
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function mintToken(account, tokenUrl = account.tokenUri) {
  const assertion = buildAssertion({
    clientEmail: account.clientEmail,
    privateKey: account.privateKey,
    privateKeyId: account.privateKeyId,
    tokenUri: tokenUrl,
  });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();
  let response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new CliError(`could not reach ${tokenUrl} (${redact(error.message)})`, 1);
  }
  const raw = await response.text();
  if (!response.ok) {
    throw new CliError(
      `Google refused the key (HTTP ${response.status}: ${redact(raw).slice(0, 300)}) — ` +
        'check that the service account was granted "Release to testing tracks" in Play Console → Setup → API access',
      1,
    );
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CliError('the token endpoint returned something that is not JSON', 1);
  }
  if (!json.access_token) throw new CliError('the token endpoint returned no access_token', 1);
  return json.access_token;
}

/* --------------------------------------------------------------------- input -- */

function newestBundle() {
  const dir = join(REPO_ROOT, 'store');
  if (!existsSync(dir)) throw new CliError('no store/ directory to look for an AAB in');
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith('.aab'))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!candidates.length) {
    throw new CliError('no AAB found in store/ — build one with npm run mobile:aab, or pass --bundle <path>');
  }
  return candidates[0];
}

function readNotes(opts) {
  if (opts.notes) return opts.notes.trim();
  if (!opts.notesFile) return undefined;
  const path = resolve(REPO_ROOT, opts.notesFile);
  if (!existsSync(path)) throw new CliError(`no notes file at ${path}`);
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new CliError(`${path} is empty — Play would show a blank "What's new"`);
  return text;
}

async function confirm() {
  if (!process.stdin.isTTY) {
    throw new CliError('refusing to publish without --yes when stdin is not a terminal');
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Type "publish" to continue: ');
    if (answer.trim() !== 'publish') throw new CliError('cancelled — nothing was uploaded');
  } finally {
    rl.close();
  }
}

/* ---------------------------------------------------------------------- flow -- */

export async function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const bundlePath = opts.bundle ? resolve(REPO_ROOT, opts.bundle) : newestBundle();
  if (!existsSync(bundlePath)) throw new CliError(`no bundle at ${bundlePath}`);
  const bundleBytes = readFileSync(bundlePath);
  const meta = readBundleMeta(bundleBytes);
  const sha = createHash('sha256').update(bundleBytes).digest('hex');

  const packageName = opts.package ?? meta.packageName;
  if (packageName !== meta.packageName) {
    throw new CliError(`--package ${packageName} does not match the bundle's own package ${meta.packageName}`);
  }

  const notes = readNotes(opts);
  if (notes && [...notes].length > NOTES_LIMIT) {
    throw new CliError(`release notes are ${[...notes].length} characters; Play allows ${NOTES_LIMIT}`);
  }

  const keyPath = resolveKeyPath();
  const account = loadServiceAccount(keyPath); // validates the key in a dry run too
  const tokenUrl = resolveTokenUri(account);
  const track = opts.track ?? 'internal';
  const base = applicationsUrl(packageName);

  console.log(`\n${opts.dryRun ? 'PLAY PUBLISH — DRY RUN' : 'PLAY PUBLISH'}\n`);
  console.log(`  bundle      ${bundlePath}`);
  console.log(`  size        ${bundleBytes.length.toLocaleString('en-US')} B · sha256 ${sha.slice(0, 12)}…`);
  console.log(`  manifest    ${meta.packageName} · versionName ${meta.versionName} · versionCode ${meta.versionCode}`);
  console.log(`  track       ${track}`);
  console.log(`  notes       ${notes ? `${[...notes].length} chars (en-US)` : 'none — Play keeps the existing notes'}`);
  console.log(`  key         ${keyPath} · ${account.clientEmail}`);

  const plan = planRequests({
    base,
    track,
    versionCode: meta.versionCode,
    versionName: meta.versionName,
    bundleBytes,
    notes,
    tokenUri: tokenUrl,
  });
  console.log(`\nHTTP plan — ${plan.length} requests${opts.dryRun ? ', none sent in a dry run' : ''}:`);
  plan.forEach((request, index) => {
    console.log(`  ${String(index + 1).padStart(2)}  ${request.step.padEnd(6)} ${request.url}`);
    console.log(`             ${request.detail}`);
  });

  if (opts.dryRun) {
    console.log('\ndry run: key parsed, RSA signature produced, bundle read, notes checked — no network calls made.\n');
    return 0;
  }

  if (!opts.yes) await confirm();

  const token = await mintToken(account, tokenUrl);

  // Play keeps every uploaded versionCode forever, and uploading one it already
  // has fails half-way through an edit. This read is cheap; do it first.
  const existing = await call(`${base}/bundles`, { token });
  const taken = (Array.isArray(existing.bundles) ? existing.bundles : [])
    .map((bundle) => Number(bundle.versionCode))
    .filter((code) => Number.isFinite(code));
  if (taken.includes(meta.versionCode)) {
    throw new CliError(
      `versionCode ${meta.versionCode} is already on Play — bump it ` +
        `(./gradlew bundleRelease -PversionCode=${meta.versionCode + 1}) and rebuild the AAB`,
    );
  }

  const edit = await call(`${base}/edits`, {
    method: 'POST',
    token,
    body: JSON.stringify({}),
    contentType: 'application/json',
  });
  const editId = edit.id;
  if (!editId) throw new CliError('Play opened an edit but returned no edit id', 1);
  console.log(`\n  edit ${editId} opened`);

  let committed = false;
  try {
    const uploaded = await call(`${base}/edits/${editId}/bundles?uploadType=media`, {
      method: 'POST',
      token,
      body: bundleBytes,
      contentType: 'application/octet-stream',
    });
    const versionCode = Number(uploaded.versionCode ?? meta.versionCode);
    console.log(`  bundle uploaded · versionCode ${versionCode}`);

    const release = {
      track,
      releases: [
        {
          name: `${meta.versionName} (${versionCode})`,
          versionCodes: [String(versionCode)],
          status: 'completed',
          ...(notes ? { releaseNotes: [{ language: 'en-US', text: notes }] } : {}),
        },
      ],
    };
    await call(`${base}/edits/${editId}/tracks/${track}`, {
      method: 'PUT',
      token,
      body: JSON.stringify(release),
      contentType: 'application/json',
    });
    console.log(`  ${track} release set to completed`);

    await call(`${base}/edits/${editId}:commit`, { method: 'POST', token });
    committed = true;
    console.log(`  edit ${editId} committed`);
  } catch (error) {
    if (!committed) {
      try {
        await call(`${base}/edits/${editId}`, { method: 'DELETE', token });
        console.error(`  edit ${editId} deleted — Play has no half-built release from this run`);
      } catch (cleanupError) {
        console.error(
          `  could not delete edit ${editId}: ${redact(cleanupError.message)} — delete it in Play Console if it persists`,
        );
      }
    }
    throw error;
  }

  console.log(`\npublished ${meta.versionName} (${meta.versionCode}) to ${track}.`);
  console.log(`https://play.google.com/console/u/0/developers/-/app/${packageName}/tracks/${track}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    process.exitCode = await run();
  } catch (error) {
    const message = error instanceof CliError ? error.message : redact(error?.message ?? error);
    console.error(`play-publish: ${message}`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

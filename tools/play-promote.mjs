#!/usr/bin/env node
/**
 * Promote a build that is already on Google Play from one track to another —
 * internal → closed testing (`alpha`) → production — without re-uploading it.
 *
 *   node tools/play-promote.mjs --dry-run
 *   node tools/play-promote.mjs --from internal --to alpha
 *
 * This is a sibling of `play-publish.mjs` and shares its key handling, token
 * minting and HTTP helper, so a promotion needs the same one service-account
 * key and nothing else. The difference is what it sends: no bundle, just a
 * track release pointing at a versionCode Play already stores.
 *
 * Why read the tracks first: Play has no "move this build" call, so the source
 * of truth for what is live is `GET /tracks`. Doing that before opening an edit
 * means a refusal leaves nothing to clean up.
 *
 * Nothing here prints the private key or the access token, and error text is
 * scrubbed before it reaches the terminal.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  CliError,
  applicationsUrl,
  call,
  confirm,
  loadServiceAccount,
  mintToken,
  redact,
  resolveKeyPath,
  resolveTokenUri,
} from './play-publish.mjs';

const DEFAULT_PACKAGE = 'com.rewindbowl.game';
const TRACKS = ['internal', 'alpha', 'beta', 'production'];
const DEFAULT_FROM = 'internal';
const DEFAULT_TO = 'alpha'; // closed testing

const USAGE = `usage: node tools/play-promote.mjs [options]

  --from <track>        source track (default: ${DEFAULT_FROM})
  --to <track>          target track (default: ${DEFAULT_TO}, closed testing)
  --version-code <n>    promote this version instead of the newest released one
  --package <name>      application id (default: ${DEFAULT_PACKAGE})
  --dry-run             print the HTTP plan, send nothing
  --yes                 skip the typed confirmation (required in a non-TTY)
  --help                this text

Tracks: ${TRACKS.join(' | ')}.

The service-account JSON is read from $PLAY_SERVICE_ACCOUNT_JSON, or from
store/play-service-account.json when that exists.

$PLAY_API_BASE_URL replaces https://androidpublisher.googleapis.com and
$PLAY_TOKEN_URI replaces https://oauth2.googleapis.com/token. Both exist so the
test suite can point this script at a local mock instead of Google.`;

export function parseArgs(argv) {
  const opts = { dryRun: false, yes: false, help: false };
  const takesValue = {
    '--from': 'from',
    '--to': 'to',
    '--version-code': 'versionCode',
    '--package': 'package',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (takesValue[arg]) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new CliError(`${arg} needs a value`);
      opts[takesValue[arg]] = value;
    } else throw new CliError(`unknown option ${arg} (try --help)`);
  }
  for (const [name, value] of [
    ['--from', opts.from],
    ['--to', opts.to],
  ]) {
    if (value && !TRACKS.includes(value)) {
      throw new CliError(`${name} must be one of ${TRACKS.join(', ')} — got "${value}"`);
    }
  }
  if (opts.from && opts.to && opts.from === opts.to) {
    throw new CliError(`--from and --to are both ${opts.from} — a promotion has to move somewhere else`);
  }
  if (opts.versionCode !== undefined) {
    const code = Number(opts.versionCode);
    if (!Number.isInteger(code) || code <= 0) {
      throw new CliError(`--version-code must be a positive integer — got "${opts.versionCode}"`);
    }
    opts.versionCode = code;
  }
  return opts;
}

/* ------------------------------------------------------------------ the app -- */

/** Newest completed versionCode on a track, or undefined when nothing is live. */
export function releasedVersionCode(tracks, trackName) {
  const track = (Array.isArray(tracks) ? tracks : []).find((entry) => entry.track === trackName);
  const releases = Array.isArray(track?.releases) ? track.releases : [];
  const completed = releases.filter((release) => release.status === 'completed');
  const codes = completed
    .flatMap((release) => (Array.isArray(release.versionCodes) ? release.versionCodes : []))
    .map(Number)
    .filter((code) => Number.isInteger(code) && code > 0);
  return codes.length ? Math.max(...codes) : undefined;
}

/** Whether a specific build appears anywhere on a track, released or not. */
export function trackHasVersion(tracks, trackName, versionCode) {
  const track = (Array.isArray(tracks) ? tracks : []).find((entry) => entry.track === trackName);
  const releases = Array.isArray(track?.releases) ? track.releases : [];
  return releases.some((release) =>
    (Array.isArray(release.versionCodes) ? release.versionCodes : []).map(Number).includes(versionCode),
  );
}

/* ----------------------------------------------------------------- the plan -- */

export function planPromotion({ base, from, to, versionCode, tokenUri }) {
  const edit = `${base}/edits/{editId}`;
  const code = versionCode ?? '{versionCode}';
  return [
    { step: 'POST', url: tokenUri, detail: 'OAuth2 token from a signed JWT assertion' },
    { step: 'GET', url: `${base}/tracks`, detail: `read every track and find what ${from} is running` },
    { step: 'POST', url: `${base}/edits`, detail: 'open an edit (the staging area for one release)' },
    {
      step: 'PUT',
      url: `${edit}/tracks/${to}`,
      detail: JSON.stringify({
        track: to,
        releases: [{ name: `${code} promoted from ${from}`, versionCodes: [String(code)], status: 'completed' }],
      }),
    },
    { step: 'POST', url: `${edit}:validate`, detail: 'let Play check the edit before committing it' },
    { step: 'POST', url: `${edit}:commit`, detail: 'publish the edit — this is the point of no return' },
    { step: 'DELETE', url: edit, detail: 'only if a later step fails, so no half-built edit is left behind' },
  ];
}

function printPlan(plan, dryRun) {
  console.log(`\nHTTP plan — ${plan.length} requests${dryRun ? ', none sent in a dry run' : ''}:`);
  plan.forEach((request, index) => {
    console.log(`  ${String(index + 1).padStart(2)}  ${request.step.padEnd(6)} ${request.url}`);
    console.log(`             ${request.detail}`);
  });
}

/* ---------------------------------------------------------------------- flow -- */

export async function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const packageName = opts.package ?? DEFAULT_PACKAGE;
  const from = opts.from ?? DEFAULT_FROM;
  const to = opts.to ?? DEFAULT_TO;

  const keyPath = resolveKeyPath();
  const account = loadServiceAccount(keyPath); // validated in a dry run too
  const tokenUrl = resolveTokenUri(account);
  const base = applicationsUrl(packageName);

  console.log(`\n${opts.dryRun ? 'PLAY PROMOTE — DRY RUN' : 'PLAY PROMOTE'}\n`);
  console.log(`  package     ${packageName}`);
  console.log(`  from        ${from}`);
  console.log(`  to          ${to}`);
  console.log(`  version     ${opts.versionCode ?? `the newest completed release on ${from}`}`);
  console.log(`  key         ${keyPath} · ${account.clientEmail}`);

  if (opts.dryRun) {
    printPlan(planPromotion({ base, from, to, versionCode: opts.versionCode, tokenUri: tokenUrl }), true);
    console.log('\ndry run: key parsed, RSA signature produced — no network calls made.\n');
    return 0;
  }

  const token = await mintToken(account, tokenUrl);

  // Read before writing: a refusal here leaves no edit behind to clean up.
  const listed = await call(`${base}/tracks`, { token });
  const tracks = Array.isArray(listed.tracks) ? listed.tracks : [];

  const versionCode = opts.versionCode ?? releasedVersionCode(tracks, from);
  if (versionCode === undefined) {
    throw new CliError(
      `the ${from} track has no completed release — publish one first ` +
        `(npm run play:publish -- --track ${from}), then promote it`,
    );
  }
  if (!trackHasVersion(tracks, from, versionCode)) {
    throw new CliError(
      `versionCode ${versionCode} is not on the ${from} track — pass --version-code with one that is, ` +
        'or publish that build first',
    );
  }

  console.log(`\n  ${from} is running versionCode ${versionCode}`);
  printPlan(planPromotion({ base, from, to, versionCode, tokenUri: tokenUrl }), false);

  if (!opts.yes) await confirm('promote');

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
    const release = {
      track: to,
      releases: [
        {
          name: `${versionCode} promoted from ${from}`,
          versionCodes: [String(versionCode)],
          status: 'completed',
        },
      ],
    };
    await call(`${base}/edits/${editId}/tracks/${to}`, {
      method: 'PUT',
      token,
      body: JSON.stringify(release),
      contentType: 'application/json',
    });
    console.log(`  ${to} set to versionCode ${versionCode}`);

    await call(`${base}/edits/${editId}:validate`, { method: 'POST', token, body: '{}', contentType: 'application/json' });
    console.log('  edit validated');

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

  console.log(`\npromoted versionCode ${versionCode} from ${from} to ${to}.\n`);
  console.log(`https://play.google.com/console/u/0/developers/-/app/${packageName}/tracks/${to}\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    process.exitCode = await run();
  } catch (error) {
    const message = error instanceof CliError ? error.message : redact(error?.message ?? error);
    console.error(`play-promote: ${message}`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

#!/usr/bin/env node
/**
 * Checks adb and the attached Android device before a hardware pass.
 *
 *   node scripts/adb-preflight.mjs
 *   node scripts/adb-preflight.mjs --apk artifacts/rewind-bowl-debug.apk
 *
 * When a phone is attached it prints the install and launch lines with the
 * device serial filled in. When there is none it prints the same commands
 * without `-s`, plus the USB-debugging steps, and exits 1 so automation stops
 * before building a bundle nobody can install.
 *
 * adb is resolved from ADB, PATH, ANDROID_HOME / ANDROID_SDK_ROOT,
 * android/local.properties, then the usual SDK install locations.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
let apkArg;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--apk') {
    apkArg = argv[++i];
    if (!apkArg) usageError('--apk needs a path');
  } else if (arg.startsWith('--apk=')) {
    apkArg = arg.slice('--apk='.length);
    if (!apkArg) usageError('--apk needs a path');
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/adb-preflight.mjs [--apk <path>]');
    process.exit(0);
  } else {
    usageError(`unknown argument ${arg}`);
  }
}

function usageError(message) {
  console.error(`adb-preflight: ${message}`);
  console.error('Usage: node scripts/adb-preflight.mjs [--apk <path>]');
  process.exit(1);
}

const shellQuote = (value) =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

function run(command, args) {
  try {
    return {
      ok: true,
      out: execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      out: String(error?.stdout ?? '').trim(),
      error: String(error?.stderr ?? error?.message ?? '').trim(),
    };
  }
}

function findOnPath() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function sdkRoots() {
  const roots = [];
  if (process.env.ANDROID_HOME) roots.push({ path: process.env.ANDROID_HOME, source: 'ANDROID_HOME' });
  if (process.env.ANDROID_SDK_ROOT) {
    roots.push({ path: process.env.ANDROID_SDK_ROOT, source: 'ANDROID_SDK_ROOT' });
  }

  const localProperties = join(ROOT, 'android/local.properties');
  if (existsSync(localProperties)) {
    const match = readFileSync(localProperties, 'utf8').match(/^\s*sdk\.dir\s*=\s*(.+)\s*$/m);
    if (match) roots.push({ path: match[1].trim(), source: 'android/local.properties' });
  }

  roots.push(
    { path: join(homedir(), 'Android/Sdk'), source: '~/Android/Sdk' },
    { path: join(homedir(), 'Library/Android/sdk'), source: '~/Library/Android/sdk' },
    { path: join(homedir(), 'android-sdk'), source: '~/android-sdk' },
  );
  return roots;
}

function resolveAdb() {
  if (process.env.ADB) return { command: process.env.ADB, source: 'ADB' };

  const onPath = findOnPath();
  if (onPath) return { command: onPath, source: 'PATH' };

  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  for (const root of sdkRoots()) {
    const candidate = join(root.path, 'platform-tools', exe);
    if (existsSync(candidate)) return { command: candidate, source: root.source };
  }

  return null;
}

function readIdentity() {
  const fallback = {
    packageName: 'com.rewindbowl.game.debug',
    activity: 'com.rewindbowl.game.MainActivity',
  };
  try {
    const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
    const appId = gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1];
    if (!appId) return fallback;
    const suffix = gradle.match(/applicationIdSuffix\s+["']([^"']+)["']/)?.[1] ?? '';
    const namespace = gradle.match(/namespace\s+["']([^"']+)["']/)?.[1] ?? appId;
    const packageName = appId + (suffix ? (suffix.startsWith('.') ? suffix : `.${suffix}`) : '');
    return { packageName, activity: `${namespace}.MainActivity` };
  } catch {
    return fallback;
  }
}

function resolveApk() {
  const defaultApk = 'artifacts/rewind-bowl-debug.apk';
  const builtApk = 'android/app/build/outputs/apk/debug/app-debug.apk';
  const display = apkArg ?? (existsSync(join(ROOT, defaultApk)) ? defaultApk : builtApk);
  const absolute = resolve(ROOT, display);
  return { display, absolute, exists: existsSync(absolute) };
}

function parseDevices(output) {
  const lines = output.split(/\r?\n/);
  const header = lines.findIndex((line) => /^List of devices attached/.test(line.trim()));
  const rows = (header >= 0 ? lines.slice(header + 1) : lines).filter((line) => line.trim());
  const devices = [];
  for (const row of rows) {
    const match = row.trim().match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) continue;
    const meta = {};
    for (const token of (match[3] ?? '').split(/\s+/)) {
      const split = token.indexOf(':');
      if (split > 0) meta[token.slice(0, split)] = token.slice(split + 1);
    }
    devices.push({
      serial: match[1],
      state: match[2],
      model: meta.model ?? 'unknown model',
      device: meta.device ?? '',
    });
  }
  return devices;
}

function printCommands(adbCommand, serial, apk, identity) {
  const prefix = serial
    ? `${shellQuote(adbCommand)} -s ${shellQuote(serial)}`
    : shellQuote(adbCommand);
  console.log(`  ${prefix} install -r ${shellQuote(apk.display)}`);
  console.log(
    `  ${prefix} shell am start -n ${shellQuote(
      `${identity.packageName}/${identity.activity}`,
    )}`,
  );
}

function main() {
  console.log('REWIND BOWL · ANDROID ADB PREFLIGHT');
  console.log('===================================');
  console.log();

  const identity = readIdentity();
  const apk = resolveApk();
  const adb = resolveAdb();

  if (!adb) {
    console.log('adb: NOT FOUND');
    console.log('  Install Android platform-tools, or set ANDROID_HOME / ANDROID_SDK_ROOT.');
    console.log();
    if (!apk.exists) {
      console.log(`Build the APK first:  npm run mobile:apk   (missing ${apk.display})`);
      console.log();
    }
    console.log('Once adb is available and a phone is attached, run:');
    printCommands('adb', null, apk, identity);
    console.log();
    console.log('USB debugging: Settings → Developer options → USB debugging, then accept');
    console.log('the “Allow USB debugging” prompt on the phone.');
    console.log();
    console.log('Or let Capacitor build, install and launch:  npm run mobile:run:android');
    process.exitCode = 1;
    return;
  }

  console.log(`adb: ${shellQuote(adb.command)} (${adb.source})`);
  const version = run(adb.command, ['version']);
  if (!version.ok) {
    console.log(`adb could not run: ${version.error || 'unknown error'}`);
    console.log();
    console.log('Once adb works and a phone is attached, run:');
    printCommands(adb.command, null, apk, identity);
    process.exitCode = 1;
    return;
  }
  console.log(`  ${version.out.split(/\r?\n/)[0]}`);

  const listing = run(adb.command, ['devices', '-l']);
  if (!listing.ok) {
    console.log(`adb devices failed: ${listing.error || 'unknown error'}`);
    console.log();
    console.log('Once the phone is attached, run:');
    printCommands(adb.command, null, apk, identity);
    process.exitCode = 1;
    return;
  }

  const devices = parseDevices(listing.out);
  const authorised = devices.filter((device) => device.state === 'device');
  const blocked = devices.filter((device) => device.state !== 'device');

  console.log(`devices: ${authorised.length} authorised, ${blocked.length} not ready`);
  for (const device of blocked) {
    console.log(`  ${device.serial}  ${device.state}  ${device.model}`);
  }

  if (!authorised.length) {
    console.log();
    console.log('No authorised Android device is attached.');
    if (blocked.some((device) => device.state === 'unauthorized')) {
      console.log('  A phone is connected but not authorised: unlock it and accept the');
      console.log('  “Allow USB debugging” prompt, then run this command again.');
    } else {
      console.log('  Connect a phone over USB, enable USB debugging, and accept the prompt.');
    }
    console.log();
    console.log(`Check with:  ${shellQuote(adb.command)} devices -l`);
    console.log();
    if (!apk.exists) {
      console.log(`Build the APK first:  npm run mobile:apk   (missing ${apk.display})`);
      console.log();
    }
    console.log('Install and launch:');
    printCommands(adb.command, null, apk, identity);
    console.log();
    console.log('Or let Capacitor build, install and launch:  npm run mobile:run:android');
    process.exitCode = 1;
    return;
  }

  if (!apk.exists) {
    console.log();
    console.log(`APK not found: ${apk.display}`);
    console.log('Build it with:  npm run mobile:apk');
    console.log();
    process.exitCode = 1;
  }

  for (const device of authorised) {
    console.log();
    console.log(`Authorised device: ${device.serial} · ${device.model}${device.device ? ` · ${device.device}` : ''}`);
    printCommands(adb.command, device.serial, apk, identity);
  }

  console.log();
  if (apk.exists) {
    console.log('Ready. Use DEVICE-CHECK.md §D for the D1a backgrounding check.');
  } else {
    console.log('Build the APK, then run this preflight again.');
  }
}

main();

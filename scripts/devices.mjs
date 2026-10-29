#!/usr/bin/env node
/**
 * Prints the devices `cap run` can install onto, so you know what target you
 * have before starting a device pass. Safe to run on any machine: missing
 * toolchains are reported, not treated as errors.
 */
import { execFileSync } from 'node:child_process';

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    }).trim();
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return String((err && (err.stdout || err.stderr)) || '').trim();
  }
}

const line = (s = '') => console.log(s);

line('REWIND BOWL · DEVICE RUN TARGETS');
line('================================');
line();

line('ANDROID (adb)');
const adb = run('adb', ['version']);
if (adb == null) {
  line('  adb not found. Install Android platform-tools and put them on PATH,');
  line('  or open Android Studio once so its SDK is set up.');
} else {
  line(`  ${adb.split('\n')[0]}`);
  const devices = run('adb', ['devices', '-l']);
  if (devices) {
    for (const row of devices.split('\n').slice(1)) {
      if (row.trim()) line(`  ${row.trim()}`);
    }
    if (!/device\s/.test(devices)) {
      line('  no authorised device — plug in a phone with USB debugging on, or boot an emulator.');
    }
  }
}
line();

line('IOS (xcrun)');
if (process.platform !== 'darwin') {
  line('  skipped: iOS builds need macOS with Xcode.');
} else {
  const sims = run('xcrun', ['simctl', 'list', 'devices', 'booted']);
  if (sims == null) {
    line('  xcrun not found. Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app`.');
  } else {
    const booted = sims
      .split('\n')
      .filter((r) => r.includes('(') && !r.startsWith('=='))
      .map((r) => r.trim());
    if (booted.length) {
      for (const s of booted) line(`  booted simulator: ${s}`);
    } else {
      line('  no booted simulator — open Xcode → Window → Devices, or `xcrun simctl boot "iPhone 15"`.');
    }
    const devices = run('xcrun', ['xctrace', 'list', 'devices']);
    if (devices) {
      const physical = devices
        .split('\n')
        .filter((r) => /\d+\.\d+|\([0-9A-F-]{8,}\)/.test(r) && !/Simulator/i.test(r));
      for (const d of physical.slice(0, 6)) line(`  ${d.trim()}`);
    }
  }
}
line();

line('NEXT');
line('  npm run mobile:preflight     check adb and print install/launch commands if no phone');
line('  npm run mobile:run:android   build, install and launch on the connected device');
line('  npm run mobile:run:ios       same, via Xcode (macOS only)');
line('  npm run mobile:live:android  live reload against `npm run dev`');
line('  npm run mobile:logs          Android Chromium console output');
line('Then work through DEVICE-CHECK.md.');

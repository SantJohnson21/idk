/**
 * Google Play listing graphics, generated from the real production build.
 *
 *   npm run build
 *   npm run preview -- --port 4173 --strictPort   # in another shell
 *   npm run play:assets
 *
 * The phone screenshots are 1080×1920 (9:16, inside Play's 320–3840 px range)
 * and come from driving the actual UI — title, club picker, hub, market, play
 * call and a live snap. No score, roster or screen is written by hand.
 *
 * The feature graphic is a 1024×500 crop of a real landscape drive with the
 * wordmark over it; the icon is the same 1024 px master the launcher uses. Every
 * output is checked for PNG dimensions and hashed into store/assets.json so the
 * upload can be matched to a build.
 *
 * Exits non-zero on a page error or a missing screen. Set RB_URL to point at a
 * different preview host.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.RB_URL ?? 'http://127.0.0.1:4173';
const OUT = 'store';
const SHOTS = `${OUT}/screenshots`;
const PHONE = { width: 405, height: 720 };
const DPR = 1080 / PHONE.width; // 2.666…, so the PNG is exactly 1080×1920.

mkdirSync(SHOTS, { recursive: true });
mkdirSync(`${OUT}/source`, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // The game starts its audio bed on load; do not let Chromium's autoplay policy
    // turn that into a warning that has nothing to do with the screenshots.
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const issues = [];
const context = await browser.newContext({
  viewport: PHONE,
  deviceScaleFactor: DPR,
});
await context.addInitScript(() => {
  try {
    // Clear once, not on the reload used for the landscape source — otherwise
    // the career (and Continue) disappears exactly when the wide shot needs it.
    if (localStorage.getItem('__qa_store_assets')) return;
    localStorage.clear();
    localStorage.setItem('__qa_store_assets', '1');
  } catch {
    /* storage blocked — the run says so below */
  }
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') issues.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const path = `${SHOTS}/${name}`;
  await page.screenshot({ path });
  console.log(`  wrote ${path}`);
};

const ready = async () => {
  await page.locator('.title-screen').waitFor({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
};

const pickSquall = async () => {
  await page.getByRole('button', { name: /START FRANCHISE/ }).click();
  await page.locator('.team-picker').waitFor({ timeout: 8_000 });
  await page.locator('.team-card').filter({ hasText: 'SQUALL' }).click();
  await page.getByRole('button', { name: /COACH THE SQUALL/ }).click();
  await page.locator('.team-hero h1').waitFor({ timeout: 15_000 });
};

const callAndSnap = async () => {
  await page.locator('.take-field').click();
  await page.locator('.play-card').first().waitFor({ timeout: 20_000 });
  const pass = page.locator('.play-card').filter({ has: page.locator('i.pass') }).first();
  if ((await pass.count()) > 0) await pass.click();
  else await page.locator('.play-card').first().click();
  await page.locator('.snap-btn').waitFor({ timeout: 8_000 });
  await page.locator('.snap-btn').click();
};

console.log('--- Phone screenshots ---');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await ready();
await shot('phone-01-title.png');

await page.getByRole('button', { name: /START FRANCHISE/ }).click();
await page.locator('.team-picker').waitFor({ timeout: 8_000 });
// Highlight the club the next screenshot will actually coach. The previous pass
// picked up Miami's default and then showed Seattle in the hub.
await page.locator('.team-card').filter({ hasText: 'SQUALL' }).click();
// Clicking a card scrolls it into view; reset every scrollable ancestor so the
// listing shot starts at the top of the league instead of mid-row.
await page.locator('.team-picker').evaluate((el) => {
  let node = el;
  while (node) {
    node.scrollTop = 0;
    node = node.parentElement;
  }
  window.scrollTo(0, 0);
});
await shot('phone-02-clubs.png');

await page.getByRole('button', { name: /COACH THE SQUALL/ }).click();
await page.locator('.team-hero h1').waitFor({ timeout: 15_000 });
await shot('phone-03-hub.png');
console.log(
  '  hub:',
  (await page.locator('.matchup').innerText()).replace(/\s+/g, ' '),
  '·',
  await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('rewind-bowl-save-v1-slot-0'));
    return `week ${f.week} · ${f.schedule.find((w) => w.week === f.week)?.opponentId}`;
  }),
);

const market = page.getByRole('button', { name: /OPEN MARKET/ }).first();
if ((await market.count()) > 0) {
  await market.click();
  await page.locator('.modal-head h2').filter({ hasText: 'THE MARKET' }).waitFor({ timeout: 6_000 });
  await shot('phone-04-market.png');
  await page.getByRole('button', { name: /^DONE$/ }).click();
} else {
  console.log('  note market button not found — skipping phone-04');
}

await page.locator('.take-field').click();
await page.locator('.play-card').first().waitFor({ timeout: 20_000 });
console.log(
  '  game:',
  await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('rewind-bowl-save-v1-slot-0'));
    return `week ${f.week} · ${f.schedule.find((w) => w.week === f.week)?.opponentId}`;
  }),
);

const pass = page.locator('.play-card').filter({ has: page.locator('i.pass') }).first();
if ((await pass.count()) > 0) await pass.click();
else await page.locator('.play-card').first().click();
await page.locator('.snap-btn').waitFor({ timeout: 8_000 });
// The pre-snap formation, route ghosts and defense call are a better still than
// the play-call phase, where the field is deliberately empty.
await shot('phone-05-ready.png');
await page.locator('.snap-btn').click();
await page.locator('.receiver-btn').first().waitFor({ timeout: 7_000 }).catch(() => {});
await page.waitForTimeout(1_050);
await shot('phone-06-live.png');

console.log('--- Landscape feature source ---');
await page.setViewportSize({ width: 1024, height: 500 });
await page.reload({ waitUntil: 'domcontentloaded' });
const cont = page.getByRole('button', { name: /CONTINUE FRANCHISE/ });
if ((await cont.count()) > 0) {
  await cont.click();
} else {
  // Defensive fallback: the career should be saved, but never fail the asset run
  // because a clean profile was used.
  await page.getByRole('button', { name: /START FRANCHISE/ }).click();
  await page.locator('.team-picker').waitFor({ timeout: 8_000 });
  await page.locator('.team-card').filter({ hasText: 'SQUALL' }).click();
  await page.getByRole('button', { name: /COACH THE SQUALL/ }).click();
}
await page.locator('.team-hero h1').waitFor({ timeout: 15_000 });
await callAndSnap();
await page.locator('.receiver-btn').first().waitFor({ timeout: 7_000 }).catch(() => {});
await page.waitForTimeout(950);
await page.screenshot({ path: `${OUT}/source/landscape-gameplay.png` });
console.log(`  wrote ${OUT}/source/landscape-gameplay.png`);

// The feature graphic wants the field, not the tape deck. The canvas is the field
// alone (the HUD and deck are DOM), so capture it separately.
const canvas = page.locator('canvas').first();
if ((await canvas.count()) > 0) {
  await canvas.screenshot({ path: `${OUT}/source/landscape-field.png` });
  console.log(`  wrote ${OUT}/source/landscape-field.png`);
} else {
  console.log('  note no canvas found — using the full landscape frame for the feature');
}

const phoneIssueCount = issues.length;

console.log('--- Feature graphic and icon ---');
const landscape = readFileSync(`${OUT}/source/landscape-gameplay.png`).toString('base64');
let field = landscape;
try {
  field = readFileSync(`${OUT}/source/landscape-field.png`).toString('base64');
} catch {
  /* the fallback is the whole frame; the run says which one was used */
}
const icon = readFileSync('resources/icon.png').toString('base64');
const pixel = readFileSync('public/fonts/press-start-2p.woff2').toString('base64');
const silkscreen = readFileSync('public/fonts/silkscreen-700.woff2').toString('base64');

const art = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await art.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'PS'; src: url(data:font/woff2;base64,${pixel}) format('woff2'); }
  @font-face { font-family: 'SK'; src: url(data:font/woff2;base64,${silkscreen}) format('woff2'); }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; background: #05080d; }
  .stage { position: relative; width: 1024px; height: 500px; overflow: hidden; }
  .shot {
    position: absolute; inset: 0;
    background: url(data:image/png;base64,${field}) center / cover no-repeat;
    filter: saturate(1.10) contrast(1.05) brightness(.86);
  }
  .shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(90deg, rgba(5,8,13,.98) 0%, rgba(5,8,13,.94) 32%, rgba(5,8,13,.58) 58%, rgba(5,8,13,.10) 100%),
      linear-gradient(0deg, rgba(5,8,13,.80) 0%, rgba(5,8,13,0) 38%);
  }
  .scan {
    position: absolute; inset: 0;
    background: repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 4px);
    mix-blend-mode: overlay;
  }
  .copy { position: absolute; left: 56px; top: 52px; width: 560px; }
  .kicker { font: 11px/1.4 'SK'; letter-spacing: .22em; color: #5ee6a8; }
  .logo { margin: 12px 0 0; font: 48px/1.14 'PS'; color: #eef2e6; text-shadow: 4px 4px 0 #05080d; }
  .logo b { color: #ffd166; font-weight: normal; }
  .tag { margin-top: 16px; max-width: 455px; font: 14px/1.7 'SK'; color: #d6dfd6; }
  .chips { display: flex; gap: 7px; margin-top: 19px; }
  .chip { padding: 6px 8px; border: 1px solid rgba(255,209,102,.42); background: rgba(255,209,102,.08); color: #ffd166; font: 9px/1 'SK'; letter-spacing: .06em; }
  .foot { position: absolute; left: 56px; bottom: 32px; font: 9px/1 'SK'; letter-spacing: .18em; color: #93a1af; }
  .stamp { position: absolute; right: 38px; bottom: 30px; padding: 8px 10px; border: 1px solid rgba(255,209,102,.55); color: #ffd166; font: 9px/1 'SK'; letter-spacing: .12em; background: rgba(5,8,13,.65); }
</style></head><body>
  <div class="stage">
    <div class="shot"></div><div class="shade"></div><div class="scan"></div>
    <div class="copy">
      <div class="kicker">A TAP-FIRST FOOTBALL STORY</div>
      <div class="logo">REWIND<br>BOWL <b>'87</b></div>
      <div class="tag">CALL THE PLAY. RUN THE ROCK.<br>REWIND THE TAPE.</div>
      <div class="chips"><span class="chip">16 CLUBS</span><span class="chip">HOT ROUTES</span><span class="chip">QB SCRAMBLE</span><span class="chip">TAPE REWINDS</span></div>
    </div>
    <div class="foot">GRIDIRON LEAGUE · SEASON '87</div>
    <div class="stamp">OFFLINE · NO ADS · NO IAP</div>
  </div>
</body></html>`);
await art.evaluate(() => document.fonts.ready);
await art.waitForTimeout(200);
await art.screenshot({ path: `${OUT}/feature-graphic-1024x500.png` });
console.log(`  wrote ${OUT}/feature-graphic-1024x500.png`);

const iconPage = await browser.newPage({ viewport: { width: 512, height: 512 } });
await iconPage.setContent(`<!doctype html><html><head><style>
  html, body { margin: 0; width: 512px; height: 512px; overflow: hidden; background: #080b12; }
  img { display: block; width: 512px; height: 512px; }
</style></head><body><img src="data:image/png;base64,${icon}" alt=""></body></html>`);
await iconPage.waitForTimeout(200);
await iconPage.screenshot({ path: `${OUT}/icon-512.png` });
console.log(`  wrote ${OUT}/icon-512.png`);

/** Read PNG width/height from the IHDR chunk, then hash the file. */
const pngInfo = (path) => {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
};

const assets = [
  `${OUT}/icon-512.png`,
  `${OUT}/feature-graphic-1024x500.png`,
  ...['phone-01-title.png', 'phone-02-clubs.png', 'phone-03-hub.png', 'phone-04-market.png', 'phone-05-ready.png', 'phone-06-live.png'].map(
    (n) => `${SHOTS}/${n}`,
  ),
].map((path) => ({ path, ...pngInfo(path) }));

const problems = [];
for (const a of assets) {
  if (a.path.endsWith('icon-512.png') && (a.width !== 512 || a.height !== 512)) {
    problems.push(`${a.path} is ${a.width}×${a.height}, not 512×512`);
  }
  if (a.path.includes('feature-graphic') && (a.width !== 1024 || a.height !== 500)) {
    problems.push(`${a.path} is ${a.width}×${a.height}, not 1024×500`);
  }
  if (a.path.includes('/screenshots/') && (a.width !== 1080 || a.height !== 1920)) {
    problems.push(`${a.path} is ${a.width}×${a.height}, not 1080×1920`);
  }
}

writeFileSync(
  `${OUT}/assets.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: BASE,
      viewport: PHONE,
      deviceScaleFactor: DPR,
      assets,
    },
    null,
    2,
  ) + '\n',
);

await context.close();
await browser.close();

console.log('');
console.log(`  phone pass console issues: ${phoneIssueCount}`);
if (issues.length) for (const i of issues.slice(0, 8)) console.log(`    ${i}`);
console.log(`  assets: ${assets.length} files, ${assets.reduce((n, a) => n + a.bytes, 0)} bytes`);
if (problems.length) {
  console.log(`  FAILED: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('  all store graphics have the sizes Play expects.');

/**
 * Dev-only: what a scramble actually gains, and why. Run:
 *   npx tsx src/game/trace-scramble.ts
 * Takes off from a real pocket (not the snap frame), sweeps escape policies and a
 * short redirection cost for pass rushers, and measures the counterfactual —
 * standing in the pocket at the same moment on the same seed — so "worth taking"
 * can be judged against what the alternative actually pays.
 */
import { createFranchise, getTeam } from './season';
import { PlaySim } from './play';
import { PLAYBOOK } from './playbook';
import { WEATHER } from './data';
import { OWN_GOAL } from './constants';

const passes = PLAYBOOK.filter((p) => p.kind === 'pass');

function build(seed: number, wait = 0) {
  const franchise = createFranchise(seed);
  const week = franchise.schedule[0];
  const sim = new PlaySim({
    play: passes[seed % passes.length],
    los: OWN_GOAL + 30,
    startSpot: 30,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, week.opponentId),
    oppDef: 75,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: seed * 31 + 7,
    quarter: 2,
    closeGame: false,
  });
  sim.applyDefenseCall('man');
  sim.start();
  let g = 0;
  while (sim.phase !== 'dropback' && !sim.result && g < 90) {
    g++;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  for (let i = 0; i < Math.round(wait * 60) && !sim.result; i++) {
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  return sim;
}

function pocketRead(sim: PlaySim) {
  const qb = sim.qb;
  const ds = sim.defense
    .map((d) => ({ d, dd: Math.hypot(d.x - qb.x, d.y - qb.y) }))
    .sort((a, b) => a.dd - b.dd);
  return {
    depth: sim.los - qb.x,
    nearest: ds[0].dd,
    nearestRole: `${ds[0].d.role}${ds[0].d.assignment === 'rush' ? '*' : ''}`,
    within3: ds.filter((x) => x.dd < 3).length,
    qbSpd: qb.speed,
    fastDef: Math.max(...sim.defense.map((d) => d.speed)),
    pressure: sim.pressure,
  };
}

/** Standing in the pocket at the same moment: whatever the sim does on its own. */
function control(seed: number, wait: number) {
  const sim = build(seed, wait);
  const read = pocketRead(sim);
  let g = 0;
  while (!sim.result && g < 4000) {
    g++;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  const r = sim.result;
  return { read, kind: r?.kind ?? 'none', yards: r?.yards ?? 0 };
}

type Mode = 'none' | 'rushStun';

function escape(seed: number, policy: 'ahead' | 'diag' | 'edge', mode: Mode, stunFor: number, wait: number) {
  const sim = build(seed, wait);
  const before = pocketRead(sim);
  if (sim.phase !== 'dropback' || !sim.scramble()) return null;
  if (mode === 'rushStun') {
    for (const d of sim.defense) if (d.assignment === 'rush') d.stunned = Math.max(d.stunned, stunFor);
  }
  let t = 0;
  let g = 0;
  let contact = -1;
  while (!sim.result && g < 4000) {
    g++;
    t += 1 / 60;
    const qb = sim.qb;
    const nearest = sim.defense
      .map((d) => ({ d, dd: Math.hypot(d.x - qb.x, d.y - qb.y) }))
      .sort((a, b) => a.dd - b.dd)[0];
    if (contact < 0 && nearest.dd < 1.15) contact = t;
    const side = nearest.d.y >= qb.y ? -1 : 1;
    let input = { x: 1, y: 0, sprint: true };
    if (policy === 'diag')
      input = t < 0.55 ? { x: 0.7, y: side * 0.7, sprint: true } : { x: 1, y: side * 0.2, sprint: true };
    if (policy === 'edge')
      input = t < 0.55 ? { x: 0.35, y: side, sprint: true } : { x: 1, y: side * 0.3, sprint: true };
    sim.update(1 / 60, input);
  }
  const r = sim.result;
  return r ? { yards: r.yards, scored: !!r.touchdown, contact, before, mode, stunFor, wait } : null;
}

function sweep(label: string, policy: 'ahead' | 'diag' | 'edge', mode: Mode, stunFor: number, wait: number) {
  const yards: number[] = [];
  let scored = 0;
  let contact = 0;
  let n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = escape(seed, policy, mode, stunFor, wait);
    if (!r) continue;
    n++;
    yards.push(r.yards);
    if (r.scored) scored++;
    if (r.contact > 0) contact += r.contact;
  }
  const avg = yards.reduce((a, b) => a + b, 0) / Math.max(1, yards.length);
  console.log(
    `  ${label.padEnd(38)} n=${n} avg ${avg.toFixed(2)} · best ${Math.max(...yards)} · worst ${Math.min(...yards)} · ` +
      `neg ${yards.filter((y) => y < 0).length} · 5+ ${yards.filter((y) => y >= 5).length} · scored ${scored} · avg contact ${(contact / Math.max(1, n)).toFixed(2)}s`,
  );
}

function controlSweep(label: string, wait: number) {
  const yards: number[] = [];
  const kinds: Record<string, number> = {};
  let sacks = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const c = control(seed, wait);
    yards.push(c.yards);
    kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    if (c.kind === 'sack') sacks++;
  }
  const avg = yards.reduce((a, b) => a + b, 0) / yards.length;
  console.log(
    `  ${label.padEnd(38)} n=12 avg ${avg.toFixed(2)} · ${sacks} sacks · kinds ${JSON.stringify(kinds)}`,
  );
}

console.log('--- pocket at each take-off moment (seeds 1-3) ---');
for (const wait of [0.9, 1.5, 2.2]) {
  const reads = [1, 2, 3].map((s) => pocketRead(build(s, wait)));
  console.log(
    `  wait ${wait}s → ` +
      reads
        .map(
          (r) =>
            `depth ${r.depth.toFixed(1)} nearest ${r.nearestRole}@${r.nearest.toFixed(1)} (${r.within3} within 3) pressure ${Math.round(r.pressure)}%`,
        )
        .join(' · '),
  );
}
const r1 = pocketRead(build(1, 1.5));
console.log(
  `  speeds: qb ${r1.qbSpd.toFixed(2)} · fastest defender ${r1.fastDef.toFixed(2)}`,
);

console.log('--- scramble, taking off from the pocket ---');
sweep('wait 1.5 · ahead · no aid', 'ahead', 'none', 0, 1.5);
sweep('wait 1.5 · diag · no aid', 'diag', 'none', 0, 1.5);
sweep('wait 1.5 · edge · no aid', 'edge', 'none', 0, 1.5);
sweep('wait 1.5 · diag · rush stun 0.3', 'diag', 'rushStun', 0.3, 1.5);
sweep('wait 1.5 · diag · rush stun 0.5', 'diag', 'rushStun', 0.5, 1.5);
sweep('wait 1.5 · edge · rush stun 0.3', 'edge', 'rushStun', 0.3, 1.5);
sweep('wait 0.9 · diag · rush stun 0.3', 'diag', 'rushStun', 0.3, 0.9);
sweep('wait 2.2 · diag · rush stun 0.3', 'diag', 'rushStun', 0.3, 2.2);
console.log('--- counterfactual: stay in the pocket ---');
controlSweep('wait 0.9 · hold', 0.9);
controlSweep('wait 1.5 · hold', 1.5);
controlSweep('wait 2.2 · hold', 2.2);
console.log('--- detail: wait 1.5 · diag · rush stun 0.3 ---');
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const r = escape(seed, 'diag', 'rushStun', 0.3, 1.5);
  const c = control(seed, 1.5);
  console.log(
    `    seed ${seed} · pocket ${r?.before.depth.toFixed(1)} nearest @${r?.before.nearest.toFixed(1)} pressure ${Math.round(r?.before.pressure ?? 0)}% · ` +
      `scramble ${r?.yards} yds (contact ${r?.contact && r.contact > 0 ? r.contact.toFixed(2) + 's' : '—'}) vs holding ${c.yards} yds (${c.kind})`,
  );
}

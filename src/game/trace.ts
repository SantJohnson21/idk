import { createFranchise, getTeam } from './season';
import { PlaySim } from './play';
import { PLAYBOOK } from './playbook';
import { WEATHER } from './data';

const franchise = createFranchise(11);
const week = franchise.schedule[0];
const opponent = getTeam(franchise, week.opponentId);
const play = PLAYBOOK.find((p) => p.id === 'cross-fire')!;
const sim = new PlaySim({
  play,
  los: 35,
  startSpot: 25,
  roster: franchise.roster,
  team: getTeam(franchise, franchise.teamId),
  opp: opponent,
  oppDef: 75,
  weather: WEATHER.CLEAR,
  energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
  seed: 42,
  quarter: 1,
  closeGame: false,
});
sim.applyDefenseCall('zone');
sim.start();
let threw = false;
let tick = 0;
for (let i = 0; i < 2000; i++) {
  tick += 1 / 60;
  if (sim.phase === 'dropback' && !threw && sim.elapsed > 2) {
    const rb = sim.offense.find((a) => a.slot === 'RB')!;
    console.log(
      `THROW to RB at (${(rb.x + rb.vx * 0.5).toFixed(1)}, ${(rb.y + rb.vy * 0.5).toFixed(1)}) rb=(${rb.x.toFixed(1)},${rb.y.toFixed(1)})`,
    );
    sim.throwTo(rb.x + rb.vx * 0.5, rb.y + rb.vy * 0.5);
    threw = true;
  }
  sim.update(1 / 60, sim.phase === 'carry' ? { x: 1, y: 0, sprint: true } : { x: 0, y: 0, sprint: false });
  if (i % 30 === 0 || sim.phase === 'carry' || sim.phase === 'dead') {
    const carrier = sim.carrier;
    const defs = sim.defense
      .map((d) => ({ d, dd: carrier ? Math.hypot(d.x - carrier.x, d.y - carrier.y) : 0 }))
      .sort((a, b) => a.dd - b.dd)
      .slice(0, 3);
    console.log(
      `t=${tick.toFixed(1)} phase=${sim.phase} carrier=${carrier?.slot ?? carrier?.role ?? '-'} pos=(${carrier?.x.toFixed(1)},${carrier?.y.toFixed(1)}) nearest=${defs.map((x) => `${x.d.role}#${x.d.jersey}@${x.dd.toFixed(1)}`).join(' ')}`,
    );
  }
  if (sim.result) {
    console.log('RESULT', sim.result.kind, sim.result.yards, sim.result.headline, sim.result.description);
    break;
  }
}

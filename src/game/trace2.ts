import { createFranchise, getTeam } from './season';
import { Match } from './match';
import { WEATHER } from './data';

const seed = 11;
const franchise = createFranchise(seed);
const week = franchise.schedule[0];
const opponent = getTeam(franchise, week.opponentId);
const match = new Match({ franchise, opponent, week, weather: WEATHER[week.weather], seed: seed + 7 });
match.begin();
// Force cross-fire for the trace.
match.cards = [match.cards.find((c) => c.id === 'cross-fire')!, ...match.cards];
match.choosePlay('cross-fire');
let threw = false;
let t = 0;
for (let i = 0; i < 3000; i++) {
  t += 1 / 60;
  const sim = match.sim!;
  if (sim.phase === 'dropback' && !threw && sim.elapsed > 1.9) {
    const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
    const r = reads[0];
    console.log('THROW', r.slot, r.percent, 'to', r.projected.x.toFixed(1), r.projected.y.toFixed(1));
    console.log(
      '  receivers:',
      sim.getReads().map((x) => `${x.slot}:${x.percent}%@(${x.projected.x.toFixed(0)},${x.projected.y.toFixed(0)}) d=${x.defenderDist.toFixed(1)}`).join(' '),
    );
    match.throwAt(r.projected.x, r.projected.y);
    threw = true;
  }
  if (sim.phase === 'carry') match.setStick(1, 0, sim.elapsed > 0.7);
  else match.setStick(0, 0, false);
  match.update(1 / 60);
  if (i % 30 === 0 || (match.phase === 'result' && sim.result)) {
    const carrier = sim.carrier;
    const defs = carrier
      ? sim.defense
          .map((d) => ({ d, dd: Math.hypot(d.x - carrier.x, d.y - carrier.y) }))
          .sort((a, b) => a.dd - b.dd)
          .slice(0, 3)
      : [];
    console.log(
      `t=${t.toFixed(1)} match=${match.phase} sim=${sim.phase} carrier=${carrier?.slot ?? '-'}@(${carrier?.x.toFixed(1)},${carrier?.y.toFixed(1)}) nearest=${defs.map((x) => `${x.d.role}#${x.d.jersey}@${x.dd.toFixed(1)}(${x.d.assignment})`).join(' ')}`,
    );
  }
  if (sim.result) {
    console.log('RESULT', sim.result.kind, sim.result.yards, sim.result.description);
    console.log('last outcome', match.lastOutcome?.yards, match.lastOutcome?.kind);
    break;
  }
}

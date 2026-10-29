import { createFranchise, getTeam } from './season';
import { PlaySim } from './play';
import { PLAYBOOK } from './playbook';
import { WEATHER } from './data';

const franchise = createFranchise(11);
const week = franchise.schedule[0];
const opponent = getTeam(franchise, week.opponentId);
const play = PLAYBOOK.find((p) => p.id === 'deep-post')!;
const sim = new PlaySim({
  play,
  los: 45,
  startSpot: 35,
  roster: franchise.roster,
  team: getTeam(franchise, franchise.teamId),
  opp: opponent,
  oppDef: 75,
  weather: WEATHER.CLEAR,
  energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
  seed: 8,
  quarter: 1,
  closeGame: false,
});
sim.applyDefenseCall('zone');
sim.start();
for (let i = 0; i < 300; i++) {
  sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  if (i % 30 === 0) {
    const slot = sim.offense.find((a) => a.slot === 'SLOT')!;
    const s1 = sim.defense.filter((a) => a.role === 'S')[0];
    const s2 = sim.defense.filter((a) => a.role === 'S')[1];
    const cb1 = sim.defense.find((a) => a.role === 'CB')!;
    console.log(
      `t=${(i / 60).toFixed(2)} slot=(${slot.x.toFixed(1)},${slot.y.toFixed(1)}) S1=(${s1.x.toFixed(1)},${s1.y.toFixed(1)}) asg=${s1.assignment} cover=${s1.coverId} d=${Math.hypot(s1.x - slot.x, s1.y - slot.y).toFixed(1)} | S2=(${s2.x.toFixed(1)},${s2.y.toFixed(1)}) | CB1=(${cb1.x.toFixed(1)},${cb1.y.toFixed(1)})`,
    );
  }
}
console.log(
  'reads',
  sim.getReads().map((r) => `${r.slot}:${r.percent}% d=${r.defenderDist.toFixed(1)}`),
);

import { createFranchise, getTeam } from './season';
import { PlaySim } from './play';
import { PLAYBOOK } from './playbook';
import { WEATHER } from './data';

const franchise = createFranchise(101);
const week = franchise.schedule[0];
const opponent = getTeam(franchise, week.opponentId);
for (const id of ['quick-slant', 'off-tackle', 'pa-bomb']) {
  const play = PLAYBOOK.find((p) => p.id === id)!;
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
    seed: 9,
    quarter: 1,
    closeGame: false,
  });
  sim.applyDefenseCall('zone');
  sim.start();
  console.log('\nPLAY', play.name, 'LOS', sim.los, 'QB', sim.qb.x.toFixed(2), sim.qb.y.toFixed(2));
  for (let i = 0; i < 240; i++) {
    sim.update(1 / 60, { x: 1, y: 0, sprint: false });
    if (i === 30 || i === 60 || i === 90 || i === 120) {
      const qb = sim.qb;
      const nearest = sim.defense
        .map((d) => ({ d, dist: Math.hypot(d.x - qb.x, d.y - qb.y), role: d.role, asg: d.assignment }))
        .sort((a, b) => a.dist - b.dist)[0];
      console.log(
        ` t=${(i / 60).toFixed(2)} phase=${sim.phase} qb=(${qb.x.toFixed(1)},${qb.y.toFixed(1)}) nearest ${nearest.role}/${nearest.asg} d=${nearest.dist.toFixed(2)} pos (${nearest.d.x.toFixed(1)},${nearest.d.y.toFixed(1)})`,
      );
      console.log(
        '   OL:',
        sim.offense
          .filter((a) => a.role === 'OL')
          .map((o) => `(${o.x.toFixed(1)},${o.y.toFixed(1)})`)
          .join(' '),
      );
      console.log(
        '   DL:',
        sim.defense
          .filter((a) => a.role === 'DL')
          .map((o) => `(${o.x.toFixed(1)},${o.y.toFixed(1)})`)
          .join(' '),
      );
    }
    if (sim.result) {
      console.log(' RESULT', sim.result.kind, sim.result.yards, sim.result.headline);
      break;
    }
  }
}

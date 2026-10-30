/**
 * The two traits that used to be decoration.
 *
 * BALLHAWK was priced on the market and printed on the roster but no simulation
 * code read it. Footing (`weather.speedMod`) existed on every weather row and was
 * never applied. These checks measure the effect rather than trusting the wiring:
 * both compare the same seeds with and without the mechanic, so reverting either
 * change makes the totals identical and the directional assertion fails.
 *
 * Run with `npx tsx src/game/traits.test.ts` (and via `npm test`).
 */
import assert from 'node:assert/strict';
import type { Player, Weather } from './types';
import { Match } from './match';
import { PlaySim } from './play';
import { PLAYBOOK } from './playbook';
import { WEATHER } from './data';
import { OWN_GOAL } from './constants';
import {
  BALLHAWK_TAKEAWAY,
  BALLHAWK_TAKEAWAY_CAP,
  ballhawkTakeawayBonus,
  createFranchise,
  getTeam,
} from './season';

const DEFENSIVE: Player['pos'][] = ['DL', 'LB', 'CB', 'S'];

console.log('--- BALLHAWK ---');

// 1. The bonus is a real, capped number and only defenders count.
{
  const roster: Player[] = createFranchise(5).roster.map((p) => ({ ...p, quirk: 'iron_man' as const }));
  assert.equal(ballhawkTakeawayBonus(roster), 0, 'no hawks, no bonus');

  const defenders = roster.filter((p) => DEFENSIVE.includes(p.pos));
  assert.ok(defenders.length >= 4, 'a roster should carry a secondary');

  const one = roster.map((p) => (p.id === defenders[0].id ? { ...p, quirk: 'ballhawk' as const } : p));
  assert.equal(ballhawkTakeawayBonus(one), BALLHAWK_TAKEAWAY, 'one hawk is one step');

  const three = roster.map((p) =>
    defenders.slice(0, 3).some((d) => d.id === p.id) ? { ...p, quirk: 'ballhawk' as const } : p,
  );
  assert.equal(
    ballhawkTakeawayBonus(three),
    Math.min(BALLHAWK_TAKEAWAY_CAP, 3 * BALLHAWK_TAKEAWAY),
    'three hawks stack',
  );

  const all = roster.map((p) => (DEFENSIVE.includes(p.pos) ? { ...p, quirk: 'ballhawk' as const } : p));
  assert.equal(ballhawkTakeawayBonus(all), BALLHAWK_TAKEAWAY_CAP, 'the bonus caps at three');

  const receiver: Player[] = roster.map((p) => ({ ...p, quirk: 'iron_man' as const }));
  const wideout = receiver.find((p) => p.pos === 'WR')!;
  receiver[receiver.findIndex((p) => p.id === wideout.id)] = { ...wideout, quirk: 'ballhawk' as const };
  assert.equal(ballhawkTakeawayBonus(receiver), 0, 'a BALLHAWK receiver does not play defense');
  console.log(
    `  bonus: 0 → ${BALLHAWK_TAKEAWAY} → ${3 * BALLHAWK_TAKEAWAY} → capped ${BALLHAWK_TAKEAWAY_CAP}`,
  );
}

// 2. A roster with hawks gets measurably better defensive results. Each sample
//    starts from the same franchise and rng seed; the only difference is the
//    defenders' quirk, so the only reason the numbers can move is the mechanic.
function defenseSample(withHawks: boolean, seeds: number[]) {
  let points = 0;
  let takeaways = 0;
  let drives = 0;
  for (const seed of seeds) {
    const franchise = createFranchise(seed);
    if (withHawks) {
      for (const p of franchise.roster) {
        if (DEFENSIVE.includes(p.pos)) p.quirk = 'ballhawk';
      }
    }
    const week = franchise.schedule[0];
    const opponent = getTeam(franchise, week.opponentId);
    const match = new Match({
      franchise,
      opponent,
      week,
      weather: WEATHER.CLEAR,
      seed: seed * 37 + 11,
    });
    match.begin();
    // `startDefense` is the match's own entry point; the test reaches it rather
    // than rebuilding the drive so the bonus, the rating and the rng are the real
    // ones a game snap would use.
    (match as unknown as { startDefense(spot: number): void }).startDefense(25);
    const drive = match.drive;
    assert.ok(drive, `seed ${seed} should produce an opponent drive`);
    points += drive.points;
    if (drive.turnover) takeaways++;
    drives++;
  }
  return { points, takeaways, drives };
}

{
  const seeds = Array.from({ length: 240 }, (_, i) => i + 1);
  const plain = defenseSample(false, seeds);
  const hawks = defenseSample(true, seeds);
  console.log(
    `  ${plain.drives} drives: as dealt ${plain.points} pts / ${plain.takeaways} takeaways · ` +
      `all-hawk ${hawks.points} pts / ${hawks.takeaways} takeaways`,
  );
  assert.ok(
    hawks.takeaways > plain.takeaways,
    `BALLHAWK should produce more takeaways (plain ${plain.takeaways}, hawks ${hawks.takeaways})`,
  );
  assert.ok(
    hawks.points < plain.points,
    `BALLHAWK should allow fewer points (plain ${plain.points}, hawks ${hawks.points})`,
  );
}

console.log('--- Weather footing ---');

/** Rush the same handoffs on the same seeds, changing only the weather. */
function rushYards(weather: Weather, seeds: number[]): number {
  let total = 0;
  for (const seed of seeds) {
    const franchise = createFranchise(seed);
    const week = franchise.schedule[0];
    const runs = PLAYBOOK.filter((p) => p.kind === 'run' && p.runCarrier !== 'QB');
    const sim = new PlaySim({
      play: runs[seed % runs.length],
      los: OWN_GOAL + 30,
      startSpot: 30,
      roster: franchise.roster,
      team: getTeam(franchise, franchise.teamId),
      opp: getTeam(franchise, week.opponentId),
      oppDef: 75,
      weather: WEATHER[weather],
      energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
      seed: seed * 17,
      quarter: 1,
      closeGame: false,
    });
    sim.applyDefenseCall('runstuff');
    sim.start();
    let steps = 0;
    while (!sim.result && steps < 5000) {
      steps++;
      sim.update(
        1 / 60,
        sim.phase === 'carry'
          ? { x: 1, y: 0.08, sprint: true }
          : { x: 0, y: 0, sprint: false },
      );
    }
    assert.ok(sim.result, `seed ${seed} should resolve the run`);
    total += sim.result!.yards;
  }
  return total;
}

{
  const seeds = Array.from({ length: 48 }, (_, i) => i + 1);
  const clear = rushYards('CLEAR', seeds);
  const rain = rushYards('RAIN', seeds);
  const snow = rushYards('SNOW', seeds);
  console.log(
    `  ${seeds.length} carries: clear ${clear} yds · rain ${rain} yds · snow ${snow} yds`,
  );
  assert.ok(
    rain < clear,
    `rain footing should cost rushing yards (clear ${clear}, rain ${rain})`,
  );
  assert.ok(
    snow < rain,
    `snow footing should cost more than rain (rain ${rain}, snow ${snow})`,
  );
}

console.log('trait wiring OK');

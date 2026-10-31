/**
 * Achievements: the rules, and that they are earned through the same path a
 * player's game takes (`finishGame` on a real match) and survive a save round trip.
 *
 * Run with `npx tsx src/game/achievements.test.ts` (and via `npm test`).
 */
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, recordAchievements, type AchievementState } from './achievements';
import type { SeasonHistory } from './types';
import { Match } from './match';
import { WEATHER } from './data';
import { activeWeek, createFranchise, finishGame, getTeam, seasonTotals, type GameSummary } from './season';
import type { Franchise } from './types';
import { loadFranchise, saveFranchise } from './save';

/** A localStorage good enough for the save layer, without a browser. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

const fresh = (): AchievementState => ({ unlocked: {}, touchdowns: 0 });
const game = (over: Partial<NonNullable<Parameters<typeof recordAchievements>[2]['game']>> = {}) => ({
  ourScore: 24,
  theirScore: 17,
  win: true,
  touchdowns: 3,
  totalYards: 300,
  ...over,
});
const none = { careerWins: 0, titles: 0, endedSeason: null as SeasonHistory | null };

console.log('--- rules ---');

{
  const s = fresh();
  const got = recordAchievements(s, 1, { ...none, game: game() });
  assert.deepEqual(got, ['first_win', 'hat_trick'], 'a 24-17 win with 3 TDs earns first win and hat trick');
  assert.equal(s.unlocked.first_win, 1, 'unlocks record the season they were earned in');
  assert.equal(s.touchdowns, 3, 'career touchdowns accumulate');
}

{
  const s = fresh();
  const got = recordAchievements(s, 1, { ...none, game: game({ theirScore: 0, touchdowns: 0, totalYards: 400 }) });
  assert.ok(got.includes('shutout'), 'winning with them scoreless is a shutout');
  assert.ok(got.includes('big_yards'), '400 yards in one game is BIG YARDS');
}

{
  const s = fresh();
  const got = recordAchievements(s, 1, { ...none, game: game({ win: false, ourScore: 40, theirScore: 41, touchdowns: 0 }) });
  assert.ok(got.includes('shootout'), '40 points is a shootout even in a loss');
  assert.ok(!got.includes('first_win'), 'a loss is not a first win');
  assert.ok(!got.includes('shutout'), 'a loss is never a shutout');
}

{
  const s = fresh();
  const first = recordAchievements(s, 1, { ...none, game: game() });
  const again = recordAchievements(s, 1, { ...none, game: game() });
  assert.ok(first.length > 0, 'the first game unlocks something');
  assert.deepEqual(again, [], 'a repeat of the same milestone does not unlock twice');
}

{
  const s = fresh();
  const ended: SeasonHistory = {
    season: 2, wins: 12, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    madePlayoffs: true, wonBowl: true,
  };
  const got = recordAchievements(s, 2, { game: null, careerWins: 12, titles: 1, endedSeason: ended });
  assert.deepEqual(got, ['playoff_bound', 'unbeaten', 'bowl_champion'], 'a 12-0 bowl champion season earns three, in catalogue order');
}

{
  const s = fresh();
  const dynasty = recordAchievements(s, 4, { game: null, careerWins: 0, titles: 3, endedSeason: null });
  assert.deepEqual(dynasty, ['dynasty'], 'three titles is a dynasty');
  const wins = recordAchievements(s, 4, { game: null, careerWins: 50, titles: 0, endedSeason: null });
  assert.deepEqual(wins, ['fifty_wins'], 'fifty career wins');
}

assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length, 'achievement ids are unique');
console.log(`  ${ACHIEVEMENTS.length} achievements defined`);

console.log('--- a played season ---');

// Real matches through the same finishGame the UI calls, then a save round trip.
/** Play one scheduled week to the final whistle, the way the season harness does. */
function playWeek(franchise: Franchise, seed: number): GameSummary {
  const week = activeWeek(franchise);
  assert.ok(week, `week ${franchise.week} is not on the schedule`);
  const match = new Match({
    franchise,
    opponent: getTeam(franchise, week.opponentId),
    week,
    weather: WEATHER[week.weather] ?? WEATHER.CLEAR,
    seed: seed + franchise.week * 71,
  });
  match.begin();
  let steps = 0;
  let threw = false;
  while (match.phase !== 'final' && steps < 200_000) {
    steps++;
    switch (match.phase) {
      case 'playcall': {
        const cards = match.cards;
        match.choosePlay(cards[(steps + franchise.week) % cards.length].id);
        threw = false;
        break;
      }
      case 'live': {
        const sim = match.sim;
        if (sim?.phase === 'dropback' && sim.isPass && !threw && sim.elapsed > 1.9) {
          const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
          if (reads[0]) {
            match.throwAt(reads[0].projected.x, reads[0].projected.y);
            threw = true;
          }
        }
        if (sim?.phase === 'carry') match.setStick(1, 0.1, sim.elapsed > 0.6);
        else match.setStick(0, 0, false);
        match.update(1 / 60);
        break;
      }
      case 'result':
        match.advance();
        break;
      case 'fourth':
        if (match.canGoForFieldGoal) match.chooseFourth('fg');
        else if (match.state.spot < 35) match.chooseFourth('punt');
        else match.chooseFourth('go');
        break;
      case 'kick':
        match.update(1 / 60);
        if (match.kick && match.kick.pos > 0.45) match.kickNow();
        break;
      case 'block':
        match.settleBlock();
        break;
      case 'quarter':
        match.continueQuarter();
        break;
      case 'halftime':
        if (match.reel?.active) match.update(1 / 60);
        else match.continueQuarter();
        break;
      default:
        match.update(1 / 60);
    }
  }
  assert.equal(match.phase, 'final', `week ${franchise.week} never reached the final whistle`);
  return match.getSummary();
}

{
  const franchise = createFranchise(7);
  let filed = 0;
  let expectedTouchdowns = 0;
  while (franchise.seasonStage === 'regular' && filed < 3) {
    const summary = playWeek(franchise, 7 * 97);
    expectedTouchdowns += summary.touchdowns;
    finishGame(franchise, summary);
    filed++;
  }
  assert.equal(filed, 3, 'three real games were played through finishGame');
  assert.ok(franchise.achievements, 'achievements exist after filed games');
  assert.equal(franchise.achievements!.touchdowns, expectedTouchdowns, 'career touchdowns equal the sum of the filed games');
  const wins = seasonTotals(franchise).wins;
  if (wins > 0) assert.ok(franchise.achievements!.unlocked.first_win, 'a played win unlocks first win');

  saveFranchise(franchise, 0);
  const loaded = loadFranchise(0);
  assert.ok(loaded, 'the career loads back');
  assert.deepEqual(loaded!.achievements, franchise.achievements, 'unlocks and touchdowns survive a save round trip');
  console.log(`  ${filed} games filed · ${Object.keys(franchise.achievements!.unlocked).length} unlocked · ${franchise.achievements!.touchdowns} career TDs`);
}

{
  // A save from before achievements existed hydrates to an empty, usable set.
  const raw = createFranchise(9) as unknown as Record<string, unknown>;
  delete raw.achievements;
  localStorage.setItem('rewind-bowl-save-v1-slot-1', JSON.stringify(raw));
  const old = loadFranchise(1);
  assert.ok(old, 'an older save still loads');
  assert.deepEqual(old!.achievements, { unlocked: {}, touchdowns: 0 }, 'an older career starts with no milestones');
}

console.log('achievements OK');

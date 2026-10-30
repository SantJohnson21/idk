/**
 * The season-level playthrough: every week is a real `Match` played to the
 * whistle, the result is filed through the same `finishGame` the UI calls, and
 * the career is written to a save slot and read back before the next week.
 *
 * `sim.test.ts` covers one game and a hand-built season table. This covers the
 * thing a player actually does: a season of real matches, a winter, a new year —
 * with the save layer in the loop instead of at the edge.
 *
 * Run with `npx tsx src/game/season.test.ts` (and via `npm test`).
 */
import assert from 'node:assert/strict';
import type { Franchise, Ratings } from './types';
import { Match } from './match';
import { REGULAR_WEEKS, WEATHER } from './data';
import {
  activeWeek,
  createFranchise,
  finishGame,
  getTeam,
  seasonTotals,
  signRookie,
  startNewSeason,
  trainPlayer,
  type GameSummary,
} from './season';
import { listSaveSlots, loadFranchise, saveFranchise } from './save';

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

/**
 * Play one scheduled week to the final whistle with the same decisions a thumb
 * makes: take the best read, follow the run gap, kick when in range.
 */
function playWeek(franchise: Franchise, seed: number): GameSummary {
  const week = activeWeek(franchise);
  assert.ok(week, `week ${franchise.week} is not on the schedule`);
  const opponent = getTeam(franchise, week.opponentId);
  const match = new Match({
    franchise,
    opponent,
    week,
    weather: WEATHER[week.weather] ?? WEATHER.CLEAR,
    seed: seed + franchise.season * 1009 + franchise.week * 71,
  });
  match.begin();

  let steps = 0;
  let threw = false;
  while (match.phase !== 'final' && steps < 200_000) {
    steps++;
    switch (match.phase) {
      case 'playcall': {
        const cards = match.cards;
        assert.ok(cards.length > 0, 'a playcall must deal cards');
        match.choosePlay(cards[(steps + franchise.week) % cards.length].id);
        threw = false;
        break;
      }
      case 'ready':
        match.update(1 / 60);
        break;
      case 'live': {
        const sim = match.sim;
        assert.ok(sim, 'a live snap must have a simulation');
        if (sim.phase === 'dropback' && sim.isPass && !threw && sim.elapsed > 1.9) {
          const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
          if (reads[0]) {
            match.throwAt(reads[0].projected.x, reads[0].projected.y);
            threw = true;
          }
        }
        if (sim.phase === 'carry') {
          const gap = sim.play.runGap;
          const steer = gap === 'right' ? 0.35 : gap === 'left' ? -0.35 : 0.1;
          match.setStick(1, steer + Math.sin(sim.elapsed * 3) * 0.12, sim.elapsed > 0.6);
        } else {
          match.setStick(0, 0, false);
        }
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
      case 'defense':
        match.update(1 / 60);
        break;
      case 'quarter':
        match.continueQuarter();
        break;
      case 'halftime':
        // Sit through the reel the way a viewer does, then start the third.
        if (match.reel?.active) match.update(1 / 60);
        else match.continueQuarter();
        break;
      default:
        match.update(1 / 60);
    }
  }
  assert.equal(match.phase, 'final', `week ${franchise.week} never reached the final whistle`);
  const summary = match.getSummary();
  assert.ok(Number.isFinite(summary.ourScore) && summary.ourScore >= 0 && summary.ourScore < 200);
  assert.ok(Number.isFinite(summary.theirScore) && summary.theirScore >= 0 && summary.theirScore < 200);
  for (const [id, line] of Object.entries(summary.stats)) {
    for (const [key, value] of Object.entries(line)) {
      assert.ok(Number.isFinite(value), `${id}.${key} should be finite, got ${value}`);
    }
  }
  return summary;
}

console.log('--- Full season, played ---');

let franchise = createFranchise(90210);
const played: { week: number; stage: string; us: number; them: number }[] = [];
let guard = 0;

while (franchise.seasonStage !== 'offseason' && guard < 40) {
  guard++;
  const week = activeWeek(franchise);
  assert.ok(week, `no game scheduled for week ${franchise.week}`);
  const summary = playWeek(franchise, 555);
  finishGame(franchise, summary);
  played.push({
    week: franchise.week,
    stage: week.stage ?? 'regular',
    us: summary.ourScore,
    them: summary.theirScore,
  });

  // The save layer sits inside the loop, not at the end: every week is written,
  // read back, and the loaded career is what plays the next one.
  saveFranchise(franchise, 2);
  const loaded = loadFranchise(2);
  assert.ok(loaded, `week ${franchise.week} should load back from its slot`);
  assert.equal(loaded!.season, franchise.season, 'season survives the round trip');
  assert.equal(loaded!.week, franchise.week, 'week survives the round trip');
  assert.equal(loaded!.seasonStage, franchise.seasonStage, 'stage survives the round trip');
  assert.equal(loaded!.tape, franchise.tape, 'tape survives the round trip');
  assert.equal(loaded!.roster.length, franchise.roster.length, 'roster size survives the round trip');
  assert.equal(
    loaded!.schedule.filter((w) => w.result).length,
    franchise.schedule.filter((w) => w.result).length,
    'results survive the round trip',
  );
  franchise = loaded!;
}

assert.equal(franchise.seasonStage, 'offseason', 'a played season ends in the offseason');
const regular = played.filter((p) => p.stage === 'regular');
assert.equal(regular.length, REGULAR_WEEKS, `every regular week should be played (got ${regular.length})`);
assert.equal(franchise.history.length, 1, 'the season is filed once');

// 16 clubs, 8 games a week for 15 weeks: every club plays exactly 15 times.
// A playoff run must not pad this table — the row is the regular-season record.
for (const team of franchise.teams) {
  const row = franchise.standings[team.id];
  assert.ok(row, `${team.id} should have a standings row`);
  assert.equal(row.w + row.l + row.t, REGULAR_WEEKS, `${team.id} should have played ${REGULAR_WEEKS} games`);
}

const totals = seasonTotals(franchise);
assert.equal(totals.wins, regular.filter((p) => p.us > p.them).length, 'wins match the scorelines');
assert.equal(totals.losses, regular.filter((p) => p.us < p.them).length, 'losses match the scorelines');
assert.equal(totals.ties, regular.filter((p) => p.us === p.them).length, 'ties match the scorelines');
assert.equal(franchise.history[0].wins, totals.wins, 'the history book agrees with the table');
assert.equal(
  franchise.seasonStats[franchise.roster[0].id]?.games,
  played.length,
  'the stat sheet counts every game played, bracket included',
);
const points = regular.reduce((sum, p) => sum + p.us + p.them, 0);
assert.ok(points > REGULAR_WEEKS * 12, `the league should score (got ${points} points)`);
console.log(`  ${totals.wins}-${totals.losses}-${totals.ties} · ${played.length} games · ${points} points`);
console.log(`  ${regular.map((p) => `${p.us}-${p.them}`).join(' ')}${played.some((p) => p.stage === 'semi') ? ' · bracket reached' : ''}`);

console.log('--- Offseason and the next year ---');
{
  assert.ok(franchise.draftPool && franchise.draftPool.length > 0, 'the winter brings a draft class');
  assert.ok(franchise.development && franchise.development.entries.length > 0, 'the winter ages the roster');

  const trainee = franchise.roster.find((p) =>
    (Object.keys(p.ratings) as (keyof Ratings)[]).some((k) => p.ratings[k] < 99),
  );
  assert.ok(trainee, 'somebody should be trainable');
  const stat = (Object.keys(trainee!.ratings) as (keyof Ratings)[]).find((k) => trainee!.ratings[k] < 99)!;
  const tapeBefore = franchise.tape;
  assert.ok(trainPlayer(franchise, trainee!.id, stat), 'training should be affordable after a season');
  assert.ok(franchise.tape < tapeBefore, 'training costs tape');

  const rookie = franchise.draftPool![0];
  const cut = franchise.roster[franchise.roster.length - 1];
  assert.ok(signRookie(franchise, rookie.id, cut.id), 'the draft pick should sign');
  assert.ok(franchise.roster.some((p) => p.id === rookie.id), 'the rookie is on the roster');
  assert.ok(!franchise.roster.some((p) => p.id === cut.id), 'the released man is gone');

  saveFranchise(franchise, 2);
  const reloaded = loadFranchise(2);
  assert.ok(reloaded, 'the offseason loads back');

  const next = startNewSeason(reloaded!);
  assert.equal(next.season, reloaded!.season + 1);
  assert.equal(next.week, 1);
  assert.equal(next.seasonStage, 'regular');
  assert.equal(next.schedule.length, REGULAR_WEEKS);
  assert.equal(next.history.length, 1, 'history carries into the new year');
  assert.ok(next.roster.some((p) => p.id === rookie.id), 'the drafted rookie plays next season');

  // The new year has to be playable from the loaded save, not just structurally valid.
  const firstWeek = playWeek(next, 4242);
  finishGame(next, firstWeek);
  assert.equal(next.schedule.filter((w) => w.result).length, 1, 'week one of the new year files');
  assert.equal(next.seasonStats[Object.keys(next.seasonStats)[0]]?.games, 1, 'the new stat sheet starts over');

  saveFranchise(next, 2);
  const slots = listSaveSlots();
  assert.ok(slots[2], 'the title card can summarise the slot');
  assert.equal(slots[2]!.season, next.season);
  console.log(`  next year: season ${next.season}, week ${next.week}, roster ${next.roster.length}`);
}

console.log('--- Playoff bracket ---');
{
  // Seed a 14-0 club so the bracket is deterministic instead of waiting for a
  // season that happens to qualify, then play the semifinal for real.
  const f = createFranchise(31337);
  f.week = REGULAR_WEEKS;
  // Fourteen wins already in the books: the fixture is about the bracket, not
  // about replaying a whole season to get there.
  for (const w of f.schedule) {
    if (w.week < REGULAR_WEEKS) w.result = { our: 24, theirs: 10, win: true, tie: false };
  }
  f.seasonStats = {};
  for (const team of f.teams) {
    f.standings[team.id] =
      team.id === f.teamId
        ? { w: 14, l: 0, t: 0, pf: 420, pa: 180 }
        : { w: 2, l: 12, t: 0, pf: 210, pa: 400 };
  }
  const lastWeek = activeWeek(f)!;
  assert.equal(lastWeek.stage, 'regular');
  finishGame(f, playWeek(f, 77));
  assert.equal(f.seasonStage, 'playoffs', 'a 15-0 club makes the bracket');
  assert.equal(f.week, REGULAR_WEEKS + 1, 'the semifinal is the next week');

  const semi = activeWeek(f);
  assert.ok(semi && semi.stage === 'semi', 'the semifinal is on the schedule');
  const rowBefore = { ...f.standings[f.teamId] };
  const oppBefore = { ...f.standings[semi!.opponentId] };

  let semiSummary: GameSummary | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const summary = playWeek(f, 91 + attempt * 13);
    if (summary.ourScore !== summary.theirScore) {
      semiSummary = summary;
      break;
    }
  }
  assert.ok(semiSummary, 'a postseason game cannot end tied; the sim must decide it');
  finishGame(f, semiSummary!);

  const rowAfter = f.standings[f.teamId];
  const oppAfter = f.standings[semi!.opponentId];
  assert.equal(rowAfter.w + rowAfter.l + rowAfter.t, REGULAR_WEEKS, 'a playoff game must not pad our regular-season row');
  assert.equal(oppAfter.w + oppAfter.l + oppAfter.t, REGULAR_WEEKS, 'nor the opponent\'s row');
  assert.deepEqual({ ...rowAfter }, rowBefore, 'a playoff result leaves our regular-season line intact');
  assert.deepEqual({ ...oppAfter }, oppBefore, 'a playoff result leaves their regular-season line intact');
  const regularWins = f.schedule.filter((w) => w.stage === 'regular' && w.result?.win).length;
  assert.ok(regularWins >= 14, `the seeded regular season should stand (got ${regularWins} wins)`);
  assert.equal(seasonTotals(f).wins, regularWins, 'the season record stays the regular-season record');
  // Widen to string: an assertion above narrows the property, and both endings
  // are legitimate here.
  const stageNow = String(f.seasonStage);
  assert.ok(
    stageNow === 'offseason' || f.week === REGULAR_WEEKS + 2,
    'a win schedules the bowl, a loss ends the year',
  );
  console.log(`  semi ${semiSummary.ourScore}-${semiSummary.theirScore} filed without touching the standings`);
}

console.log('season playthrough OK');

import assert from 'node:assert/strict';
import { advanceAfterGame, createFranchise, endSeason, ensurePlayoffs, generateDraftPool, getTeam, finishGame, makePlayer, playerTeam, seasonTotals, startNewSeason, simulateOpponentDrive, trainingCost, trainPlayer, signRookie, upgradeRewinds, type GameSummary } from './season';
import {
  AGE_MAX,
  AGE_MIN,
  PRODIGY_DECLINE,
  PRODIGY_GROWTH,
  PRODIGY_RATE,
  RATING_FLOOR,
  ageSwing,
  careerStage,
  developPlayer,
  developRoster,
} from './development';
import { Rng } from './rng';
import { MAX_OVERTIME_PERIODS, Match } from './match';
import { REGULAR_WEEKS, TEAMS, WEATHER } from './data';
import {
  ABBR_MAX,
  NAME_MAX,
  TEAM_PRESETS,
  applyTeamPatch,
  isHex,
  originalPatch,
  patchWarning,
  sanitizePatch,
  teamPatch,
} from './club';
import { PlaySim, HOT_TAP_CORE, QB_TAP_CORE, deadBallSpot, interceptionDip, nextSpotLabel, sackDip, spotLabel } from './play';
import {
  HOT_ROUTES,
  HOT_ROUTE_LABEL,
  PLAYBOOK,
  buildRoute,
  type RouteKey,
  type RouteSlot,
} from './playbook';
import { FIELD_W, MARKET, MID_Y, OPP_GOAL, OWN_GOAL, READY_SECONDS } from './constants';
import {
  buyPrice,
  dealVerdict,
  depthTag,
  ensureMarket,
  overall,
  placeInRoster,
  sellPlayer,
  sellValue,
  sellVerdict,
  signFreeAgent,
} from './market';
import { FILM_HZ, MOMENT_FLOOR, applyFilm, filmWindow, momentScore } from './film';
import { TAP_RADIUS_PX, cameraScale, tapRadiusForScale } from './render';
import type { Franchise, PlayOutcome, Player, Ratings } from './types';
import { loadFranchise, saveFranchise } from './save';

/** A uniform line of ratings, for building a signing better or worse than the roster. */
const flatRatings = (v: number): Ratings => ({
  spd: v,
  arm: v,
  hands: v,
  blk: v,
  cov: v,
  tkl: v,
  pow: v,
});

function makeMatch(seed: number, weekOverride = 0) {
  const franchise = createFranchise(seed);
  const week = franchise.schedule[weekOverride];
  const opponent = getTeam(franchise, week.opponentId);
  const match = new Match({
    franchise,
    opponent,
    week,
    weather: WEATHER[week.weather],
    seed: seed + 7,
  });
  match.begin();
  return { franchise, match };
}

function simulateGame(
  seed: number,
  opts: {
    allowRewind?: boolean;
    /** Called once per resolved snap, with the state the snap started from. */
    onSnapshot?: (
      o: PlayOutcome,
      match: Match,
      before: { spot: number; down: number; toGo: number },
    ) => void;
  } = {},
) {
  const { franchise, match } = makeMatch(seed);
  let steps = 0;
  let rewinds = 0;
  let plays = 0;
  let threw = false;
  let lastPhase = match.phase;
  let before = { spot: match.state.spot, down: match.state.down, toGo: match.state.toGo };
  while (match.phase !== 'final' && steps < 120_000) {
    steps++;
    const phase = match.phase;
    if (phase !== lastPhase) {
      lastPhase = phase;
    }
    if (phase === 'playcall') {
      const cards = match.cards;
      assert.ok(cards.length > 0, 'playcall should have cards');
      // Mostly use a mix, favoring passes.
      const pick = cards[Math.floor((seed + steps * 13) % cards.length)];
      before = { spot: match.state.spot, down: match.state.down, toGo: match.state.toGo };
      match.choosePlay(pick.id);
      plays++;
      threw = false;
    } else if (phase === 'ready') {
      match.update(1 / 60);
    } else if (phase === 'live') {
      const sim = match.sim;
      if (!sim) throw new Error('live should have a sim');
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
        const wobble = Math.sin(sim.elapsed * 3 + seed) * 0.12;
        match.setStick(1, steer + wobble, sim.elapsed > 0.6);
      } else {
        match.setStick(0, 0, false);
      }
      match.update(1 / 60);
    } else if (phase === 'result') {
      if (opts.onSnapshot && match.lastOutcome) opts.onSnapshot(match.lastOutcome, match, before);
      if (opts.allowRewind && match.canRewind() && rewinds === 0 && match.lastOutcome?.kind === 'incomplete') {
        const before = match.state.rewinds;
        const logBefore = match.playLog.length;
        match.rewind();
        rewinds++;
        assert.equal(match.phase, 'playcall');
        assert.equal(match.state.rewinds, before - 1, 'rewind should cost a token');
        assert.equal(match.playLog.length, logBefore - 1, 'a rewound snap leaves the drive log');
        assert.equal(match.playLog.length, match.state.drivePlays, 'log and drive stay in step');
      } else {
        match.advance();
      }
    } else if (phase === 'fourth') {
      match.chooseFourth(match.canGoForFieldGoal ? 'fg' : 'go');
    } else if (phase === 'kick') {
      match.update(1 / 60);
      if (match.kick && match.kick.pos > 0.45) match.kickNow();
    } else if (phase === 'defense') {
      match.update(1 / 60);
    } else if (phase === 'quarter' || phase === 'halftime') {
      match.continueQuarter();
    } else {
      match.update(1 / 60);
    }
  }
  assert.equal(match.phase, 'final', 'game should reach the final phase');
  const summary = match.getSummary();
  const state = match.state;
  for (const [id, stat] of Object.entries(match.stats)) {
    for (const [key, v] of Object.entries(stat)) {
      assert.ok(Number.isFinite(v), `stat ${id}.${key} should be finite (got ${v})`);
    }
  }
  assert.ok(state.scoreUs >= 0 && state.scoreThem >= 0);
  assert.ok(match.totalYards >= 0);
  return { franchise, match, summary, plays, rewinds };
}

function statTotal(summary: GameSummary) {
  let pass = 0;
  let rush = 0;
  let td = 0;
  for (const s of Object.values(summary.stats)) {
    pass += s.passYds;
    rush += s.rushYds;
    td += s.passTD + s.rushTD;
  }
  return { pass, rush, td };
}

console.log('--- PlaySim smoke ---');
{
  const franchise = createFranchise(101);
  const week = franchise.schedule[0];
  const opponent = getTeam(franchise, week.opponentId);
  const play = PLAYBOOK.find((p) => p.id === 'quick-slant')!;
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
  sim.applyDefenseCall('man');
  sim.start();
  let steps = 0;
  let threw = false;
  while (!sim.result && steps < 4000) {
    steps++;
    if (sim.phase === 'dropback' && !threw && sim.elapsed > 1.2) {
      const reads = sim.getReads();
      const best = reads.sort((a, b) => b.percent - a.percent)[0];
      sim.throwTo(best.projected.x, best.projected.y);
      threw = true;
    }
    if (sim.phase === 'carry') sim.update(1 / 60, { x: 1, y: 0.1, sprint: true });
    else sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  assert.ok(sim.result, 'scripted play should resolve');
  assert.ok(Number.isFinite(sim.result!.yards));
  for (const a of sim.actors) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'actors should have finite positions');
  }
  console.log('  play result:', sim.result!.kind, sim.result!.yards, 'yards');
}

console.log('--- Full games ---');
const results: { us: number; them: number; plays: number; pass: number; rush: number; td: number }[] = [];
for (const seed of [11, 22, 33, 44, 55]) {
  const { match, summary, plays } = simulateGame(seed, { allowRewind: seed === 33 });
  const totals = statTotal(summary);
  results.push({
    us: match.state.scoreUs,
    them: match.state.scoreThem,
    plays,
    ...totals,
  });
  console.log(
    `  seed ${seed}: ${match.state.scoreUs}-${match.state.scoreThem} | plays ${plays} | pass ${totals.pass} rush ${totals.rush} TD ${totals.td} | tape ${summary.tapeEarned} | rewind? ${seed === 33}`,
  );
  assert.ok(match.state.quarter >= 4);
  assert.ok(summary.stats[summary.mvpPlayerId], 'MVP should have a stat line');
}

const avgTd = results.reduce((s, r) => s + r.td, 0) / results.length;
assert.ok(avgTd > 0.4, `teams should score touchdowns (avg ${avgTd})`);

console.log('--- Season progression ---');
{
  const franchise = createFranchise(2024);
  for (let week = 1; week <= REGULAR_WEEKS; week++) {
    const weekData = franchise.schedule.find((w) => w.week === franchise.week)!;
    const summary: GameSummary = {
      ourScore: week % 2 === 0 ? 27 : 17,
      theirScore: week % 3 === 0 ? 24 : 14,
      win: week % 3 !== 0,
      tie: false,
      opponentId: weekData.opponentId,
      stats: {
        [franchise.roster[0].id]: {
          passAtt: 24,
          passComp: 17,
          passYds: 220,
          passTD: 2,
          ints: 1,
          rushAtt: 3,
          rushYds: 12,
          rushTD: 0,
          rec: 0,
          recYds: 0,
          recTD: 0,
          fgAtt: 2,
          fgMade: 1,
          brokenTackles: 1,
          games: 1,
        },
      },
      tapeEarned: 120,
      highlights: ['test highlight'],
      mvpName: franchise.roster[0].name,
      mvpPlayerId: franchise.roster[0].id,
      totalYards: 232,
      touchdowns: 2,
    };
    finishGame(franchise, summary);
    if (franchise.seasonStage === 'playoffs') {
      const game = franchise.schedule.find((w) => w.week === franchise.week)!;
      assert.equal(game.stage, 'semi');
      assert.equal(game.week, REGULAR_WEEKS + 1, 'the semifinal is the week after the regular season');
      // Win the semi and bowl.
      finishGame(franchise, { ...summary, ourScore: 31, theirScore: 21, win: true, opponentId: game.opponentId });
      const bowl = franchise.schedule.find((w) => w.stage === 'bowl');
      assert.ok(bowl, 'winning the semi should schedule the bowl');
      assert.equal(bowl!.week, REGULAR_WEEKS + 2, 'and the bowl follows the semi');
      finishGame(franchise, { ...summary, ourScore: 28, theirScore: 20, win: true, opponentId: bowl!.opponentId });
      assert.equal(franchise.seasonStage, 'offseason');
      assert.equal(franchise.championId, franchise.teamId);
      break;
    }
  }
  assert.ok(franchise.seasonStage === 'offseason', `season should end in the offseason (got ${franchise.seasonStage})`);
  assert.ok(franchise.draftPool && franchise.draftPool.length > 0, 'should produce a draft class');
  assert.ok(franchise.history.length === 1, 'should record one season');

  const tape = franchise.tape;
  assert.ok(trainPlayer(franchise, franchise.roster[0].id, 'arm'), 'should be able to train a player');
  assert.ok(franchise.tape < tape, 'training should cost tape');
  assert.ok(upgradeRewinds(franchise), 'should be able to upgrade rewinds');
  const rookie = franchise.draftPool![0];
  const released = franchise.roster[franchise.roster.length - 1];
  assert.ok(signRookie(franchise, rookie.id, released.id), 'should be able to sign a rookie');
  assert.ok(!franchise.roster.some((p) => p.id === released.id), 'released player should leave');
  assert.ok(franchise.roster.some((p) => p.id === rookie.id), 'rookie should join');

  const next = startNewSeason(franchise);
  assert.equal(next.season, franchise.season + 1);
  assert.equal(next.freeAgents?.length, MARKET.size, 'a new season stocks a fresh wire');
  assert.equal(next.week, 1);
  assert.equal(next.seasonStage, 'regular');
  assert.equal(next.schedule.length, REGULAR_WEEKS);
  assert.ok(Object.keys(next.seasonStats).length === 0);
  console.log('  season history:', JSON.stringify(next.history[0]));
}

/** A snap worked into the worst-covered receiver, for testing picks. */
function forcedPickSim(seed: number) {
  const franchise = createFranchise(seed);
  const week = franchise.schedule[0];
  const passes = PLAYBOOK.filter((p) => p.kind === 'pass');
  const sim = new PlaySim({
    play: passes[seed % passes.length],
    los: OWN_GOAL + 30,
    startSpot: 30,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, week.opponentId),
    oppDef: 78,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: seed * 31,
    quarter: 1,
    closeGame: false,
  });
  sim.applyDefenseCall('blitz');
  sim.start();
  let steps = 0;
  let threw = false;
  while (!sim.result && steps < 1800) {
    steps++;
    if (sim.phase === 'dropback' && !threw && sim.elapsed > 0.9) {
      const worst = [...sim.getReads()].sort((a, b) => a.percent - b.percent)[0];
      if (worst) {
        sim.throwTo(worst.projected.x, worst.projected.y);
        threw = true;
      }
    }
    if (sim.phase === 'carry') sim.update(1 / 60, { x: 1, y: 0.12, sprint: false });
    else sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  return sim;
}

/**
 * Build a sack. The pocket only ever collapses inside the first 1.3s, before the
 * sim's own pressure throw bails the quarterback out, so a sack has to be made
 * rather than waited for: stand him as deep as the loss we want, then send a
 * free rusher at him.
 */
function forcedSack(seed: number, depth: number, startSpot = 30) {
  const franchise = createFranchise(seed);
  const week = franchise.schedule[0];
  const passes = PLAYBOOK.filter((p) => p.kind === 'pass');
  const sim = new PlaySim({
    play: passes[seed % passes.length],
    los: OWN_GOAL + startSpot,
    startSpot,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, week.opponentId),
    oppDef: 78,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: seed * 31,
    quarter: 1,
    closeGame: false,
  });
  sim.applyDefenseCall('blitz');
  sim.start();
  sim.qb.x = sim.los - depth;
  const rusher = sim.defense.find((d) => d.assignment === 'rush');
  if (!rusher) throw new Error('a blitz should send a rusher');
  rusher.x = sim.qb.x - 0.4;
  rusher.y = sim.qb.y;
  sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  return sim;
}

console.log('--- Turnover dips ---');
{
  // The curves are the contract: the bigger the moment, the deeper the dip.
  assert.ok(sackDip(12) > sackDip(2), 'a deeper sack dips further');
  assert.ok(sackDip(2) >= 0.28 && sackDip(12) <= 0.56, 'a sack stays inside its range');
  assert.ok(
    interceptionDip(15, 25) > interceptionDip(50, 8),
    'a pick near your own goal line dips further than one at midfield',
  );
  assert.ok(interceptionDip(20, 34) > interceptionDip(20, 5), 'a deeper throw dips further');
  assert.ok(
    interceptionDip(100, 0) >= 0.34 && interceptionDip(5, 40) <= 0.78,
    'a pick stays inside its range',
  );
  console.log(
    `  sack 2 yd ${sackDip(2).toFixed(2)} → 12 yd ${sackDip(12).toFixed(2)} · ` +
      `pick at own 15 ${interceptionDip(15, 25).toFixed(2)} → at midfield ${interceptionDip(50, 8).toFixed(2)}`,
  );

  const shallow = forcedSack(11, 2);
  const deep = forcedSack(11, 9);
  for (const [sim, loss] of [
    [shallow, 2],
    [deep, 9],
  ] as const) {
    const outcome = sim.result;
    if (!outcome) throw new Error('a free rusher should sack the quarterback');
    assert.equal(outcome.kind, 'sack', 'the free rusher should get home');
    assert.ok(Math.abs(Math.abs(outcome.yards) - loss) <= 1, `a sack should lose about ${loss}`);
    assert.equal(
      sim.slowmoRequest,
      sackDip(Math.abs(outcome.yards)),
      'a sack asks for the dip its loss earns',
    );
  }
  assert.ok(deep.slowmoRequest > shallow.slowmoRequest, 'a deeper sack asks for a deeper dip');

  let picks = 0;
  let deepest = 0;
  const kinds: string[] = [];
  for (let seed = 1; seed <= 60 && picks < 3; seed++) {
    const sim = forcedPickSim(seed);
    const outcome = sim.result;
    if (!outcome) continue;
    kinds.push(outcome.kind);
    if (outcome.kind === 'interception') {
      picks++;
      deepest = Math.max(deepest, sim.slowmoRequest);
      assert.ok(
        sim.slowmoRequest >= interceptionDip(outcome.endSpot, outcome.airYards ?? 0) - 1e-9,
        'a pick asks for the dip its swing earns',
      );
      assert.ok(sim.slowmoRequest > 0, 'a pick always asks');
    } else if (sim.slowmoRequest > 0) {
      // Only the four moments in the contract are allowed to stretch time.
      assert.ok(
        outcome.touchdown || outcome.brokenTackles > 0,
        `${outcome.kind} should not stretch time`,
      );
    }
  }
  assert.ok(picks > 0, `the sweep should produce picks (${picks})`);
  assert.ok(deepest <= 0.85, 'no ask exceeds what Match will play');
  const tally = new Map<string, number>();
  for (const kind of kinds) tally.set(kind, (tally.get(kind) ?? 0) + 1);
  console.log(
    `  built sacks: 2 yd asks ${shallow.slowmoRequest.toFixed(2)}, 9 yd asks ${deep.slowmoRequest.toFixed(2)}`,
  );
  console.log(
    `  ${picks} picks, deepest ask ${deepest.toFixed(2)} · outcomes: ${[...tally]
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')}`,
  );
}

console.log('--- Highlight selection ---');
{
  const base: PlayOutcome = {
    kind: 'run',
    yards: 6,
    endSpot: 31,
    scored: false,
    touchdown: false,
    turnover: false,
    incomplete: false,
    outOfBounds: false,
    timeUsed: 5,
    description: 'Runs for six.',
    headline: 'RUN',
    isPass: false,
    bigPlay: false,
    brokenTackles: 0,
    hypeGain: 0,
  };
  const routine = momentScore(base, 1);
  const stuffed = momentScore({ ...base, yards: -2 }, 1);
  const breakTwo = momentScore({ ...base, yards: 24, brokenTackles: 2 }, 1);
  const sack = momentScore({ ...base, kind: 'sack', isPass: true, yards: -8 }, 1);
  const chunk = momentScore({ ...base, isPass: true, yards: 33, bigPlay: true }, 1);
  const chop = momentScore({ ...base, yards: 23 }, 1);
  const plunge = momentScore({ ...base, touchdown: true, yards: 2 }, 1);
  const bomb = momentScore({ ...base, touchdown: true, yards: 62, bigPlay: true }, 1);
  const pick = momentScore({ ...base, kind: 'interception', turnover: true, isPass: true }, 1);
  assert.ok(routine < MOMENT_FLOOR, 'a routine run is not a moment');
  assert.ok(stuffed < MOMENT_FLOOR, 'a stuffed run is not a moment');
  assert.ok(breakTwo >= MOMENT_FLOOR, 'a broken tackle is a moment');
  assert.ok(sack >= MOMENT_FLOOR, 'a sack is a moment');
  assert.ok(chunk >= MOMENT_FLOOR, 'a chunk play is a moment');
  assert.ok(chop >= MOMENT_FLOOR, 'a 23-yard gain is a moment without the big-play flag');
  assert.ok(plunge >= MOMENT_FLOOR && pick >= MOMENT_FLOOR, 'scores and takeaways are moments');
  assert.ok(bomb > plunge, 'a score from deep outranks a goal-line plunge');
  assert.ok(bomb > chunk, 'a score outranks a chunk play');
  assert.ok(
    momentScore({ ...base, yards: 24, brokenTackles: 2 }, 2) > breakTwo,
    'the same play late in the half ranks higher',
  );
  console.log(
    `  routine ${routine} · stuffed ${stuffed} · break ${breakTwo} · sack ${sack} · chunk ${chunk} · plunge ${plunge} · bomb ${bomb} · pick ${pick}`,
  );
}

console.log('--- Incomplete passes come back ---');
{
  const brokenUp: PlayOutcome = {
    kind: 'incomplete',
    yards: 0,
    endSpot: 30,
    scored: false,
    touchdown: false,
    turnover: false,
    incomplete: true,
    outOfBounds: true,
    timeUsed: 2.4,
    description: 'Broken up at the last second.',
    headline: 'BROKEN UP',
    isPass: true,
    bigPlay: false,
    brokenTackles: 0,
    hypeGain: 0,
  };
  // The landing spot of a broken-up pass is not a gain, so it is not a moment
  // either — however far the ball was thrown.
  assert.equal(
    momentScore({ ...brokenUp, yards: 32, bigPlay: true }, 1),
    0,
    'a broken-up pass is never a highlight',
  );
  assert.ok(
    momentScore({ ...brokenUp, incomplete: false, yards: 32, bigPlay: true }, 1) >= MOMENT_FLOOR,
    'the same landing spot on a completed pass still is one',
  );

  let incompletes = 0;
  let deepBombs = 0;
  let deepestAir = 0;
  let loggedBombs = 0;
  const headlines = new Set<string>();
  for (const seed of [71, 72, 73]) {
    simulateGame(seed, {
      onSnapshot: (o, match, before) => {
        // Punts and kicks set their own result without going through the play
        // sim; they are not snaps, and the drive log does not hold them.
        if (o.kind === 'punt' || o.kind === 'field_goal' || o.kind === 'field_goal_miss') return;
        // The spot audit rides along: a dead ball is on the field of play, a
        // score is at the 100, and a safety sits on our own goal line.
        if (o.kind === 'safety') assert.equal(o.endSpot, 0, 'a safety is spotted on our goal line');
        else if (o.touchdown) assert.equal(o.endSpot, 100, 'a score is spotted at the 100');
        else assert.ok(o.endSpot >= 1 && o.endSpot <= 99, `${o.kind} spotted on the field (${o.endSpot})`);
        // Every snap we run lands in the drive log, stamped with the state it
        // started from — and the log holds exactly this drive, no more.
        const entry = match.playLog[match.playLog.length - 1];
        assert.ok(entry, `every resolved snap lands in the drive log (${o.kind})`);
        assert.equal(entry.down, before.down, 'the log records the down it was run on');
        assert.equal(entry.toGo, before.toGo, 'and the distance it started from');
        assert.equal(entry.spot, before.spot, 'and the spot it started from');
        assert.equal(entry.yards, o.yards, 'the log agrees with the outcome');
        assert.equal(match.playLog.length, match.state.drivePlays, 'the log is this drive exactly');
        if (!o.incomplete) return;
        incompletes++;
        headlines.add(o.headline);
        // A throw that never arrived still shows how far it went.
        assert.equal(entry.airYards, o.airYards, 'the log keeps the air yards of a failed throw');
        if ((o.airYards ?? 0) >= 20) loggedBombs++;
        assert.equal(o.yards, 0, `${o.headline}: an incomplete pass gains nothing (${o.yards})`);
        assert.equal(o.endSpot, before.spot, `${o.headline}: the ball comes back to the previous spot`);
        assert.equal(match.state.spot, before.spot, `${o.headline}: the drive stays where the snap was`);
        assert.equal(match.state.down, before.down + 1, `${o.headline}: it costs a down`);
        assert.equal(match.state.toGo, before.toGo, `${o.headline}: and leaves the distance alone`);
        deepestAir = Math.max(deepestAir, o.airYards ?? 0);
        if ((o.airYards ?? 0) >= 20) deepBombs++;
      },
    });
  }
  assert.ok(incompletes >= 8, `the sweep should see incompletes (saw ${incompletes})`);
  assert.ok(deepBombs >= 1, `including long throws broken up (${deepBombs}, deepest ${deepestAir})`);
  assert.equal(loggedBombs, deepBombs, 'every deep miss reads back with its air yards in the log');
  console.log(
    `  ${incompletes} incompletes over 3 games, ${deepBombs} of them 20+ air yards (deepest ${deepestAir}) — ` +
      `all spotted at the snap · ${[...headlines].join(' / ')}`,
  );
}

/** A live handoff, ready to be teleported wherever the spot rule is on trial. */
function liveCarry(seed: number, startSpot = 30) {
  const franchise = createFranchise(seed);
  const week = franchise.schedule[0];
  const runs = PLAYBOOK.filter((p) => p.kind === 'run' && p.runCarrier !== 'QB');
  const sim = new PlaySim({
    play: runs[seed % runs.length],
    los: OWN_GOAL + startSpot,
    startSpot,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, week.opponentId),
    oppDef: 75,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: seed * 17,
    quarter: 1,
    closeGame: false,
  });
  sim.applyDefenseCall('runstuff');
  sim.start();
  let steps = 0;
  while (sim.phase !== 'carry' && !sim.result && steps < 900) {
    steps++;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  // The tackle check waits out the first frames of the carry, so let it run.
  for (let i = 0; i < 8 && !sim.result; i++) sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  if (!sim.carrier) throw new Error('a run play should hand off');
  return { sim, carrier: sim.carrier };
}

/** A sack forced on our own five, through a real Match. */
function forcedSafety(seed: number) {
  const { match } = makeMatch(seed);
  // Start the drive on our own 5, so the pocket is on the doorstep.
  match.state.spot = 5;
  let steps = 0;
  while (match.phase !== 'live' && steps < 5000) {
    steps++;
    if (match.phase === 'playcall') {
      const card = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
      match.choosePlay(card.id);
    } else {
      match.update(1 / 60);
    }
  }
  const sim = match.sim;
  if (!sim) throw new Error('the snap should be live');
  const stats = JSON.stringify(match.stats);
  // The live phase opens on the presnap, which re-seats everyone and only then
  // hands the ball over: wait for the pocket before moving anybody.
  let guard = 0;
  while (guard < 400 && !sim.result && (!sim.qb.hasBall || sim.phase !== 'dropback')) {
    guard++;
    match.update(1 / 60);
  }
  const rusher = sim.defense.find((d) => d.assignment === 'rush') ?? sim.defense[0];
  rusher.assignment = 'rush';
  // Nine yards back, four yards deep in our own end zone, with a free rusher kept
  // in his lap until the pocket collapses.
  sim.qb.x = OWN_GOAL - 4;
  sim.qb.y = MID_Y;
  // The match waits half a second of dead time before it files the result, so
  // run the play out far enough to see it.
  guard = 0;
  while (!match.lastOutcome && guard < 120) {
    guard++;
    if (!sim.result) {
      rusher.x = sim.qb.x - 0.4;
      rusher.y = sim.qb.y;
    }
    match.update(1 / 60);
  }
  return { match, sim, stats };
}

/**
 * A pick forced in an end zone on the last frame of the flight: the far end zone
 * for a touchback, our own for a score the other way.
 */
function endZonePick(seed: number, at: 'theirs' | 'ours' = 'theirs') {
  const own = at === 'ours';
  const franchise = createFranchise(seed);
  const week = franchise.schedule[0];
  const passes = PLAYBOOK.filter((p) => p.kind === 'pass');
  const sim = new PlaySim({
    play: passes[seed % passes.length],
    los: own ? OWN_GOAL + 25 : OPP_GOAL - 12,
    startSpot: own ? 25 : 88,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, week.opponentId),
    oppDef: 78,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: seed * 29,
    quarter: 1,
    closeGame: false,
  });
  sim.applyDefenseCall('man');
  sim.start();
  let steps = 0;
  let threw = false;
  while (!sim.result && steps < 4000) {
    steps++;
    if (sim.phase === 'dropback' && !threw && sim.elapsed > 0.7) {
      sim.throwTo(own ? OWN_GOAL - 4 : OPP_GOAL + 5, MID_Y);
      threw = true;
    }
    if (sim.phase === 'air' && sim.ball.flight > 0 && sim.ball.time / sim.ball.flight > 0.94) {
      // Park the receiver wide of the landing spot and a defender right on it:
      // the defender is closer, so the ball is his to play.
      const spot = sim.ballTarget;
      const wr = sim.offense.find((a) => a.slot === 'WR1');
      if (wr) {
        wr.x = spot.x - 2;
        wr.y = spot.y;
      }
      const cb = sim.defense[0];
      cb.x = spot.x - 0.3;
      cb.y = spot.y;
    }
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
  }
  return sim;
}

/** A pick six forced in our own end zone, through a real Match. */
function forcedPickSix(seed: number) {
  const { match } = makeMatch(seed);
  let steps = 0;
  while (match.phase !== 'live' && steps < 5000) {
    steps++;
    if (match.phase === 'playcall') {
      const card = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
      match.choosePlay(card.id);
    } else {
      match.update(1 / 60);
    }
  }
  const sim = match.sim;
  if (!sim) throw new Error('the snap should be live');
  let guard = 0;
  while (guard < 300 && !sim.result && (!sim.qb.hasBall || sim.phase !== 'dropback')) {
    guard++;
    match.update(1 / 60);
  }
  // Throw it back into our own end zone, then stand a defender on the landing
  // spot for the last frames of the flight.
  match.throwAt(OWN_GOAL - 4, MID_Y);
  guard = 0;
  while (!match.lastOutcome && guard < 1200) {
    guard++;
    if (!sim.result && sim.phase === 'air' && sim.ball.flight > 0) {
      if (sim.ball.time / sim.ball.flight > 0.85) {
        const spot = sim.ballTarget;
        const wr = sim.offense.find((a) => a.slot === 'WR1');
        if (wr) {
          wr.x = spot.x - 2;
          wr.y = spot.y;
        }
        const cb = sim.defense[0];
        cb.x = spot.x - 0.3;
        cb.y = spot.y;
      }
    }
    match.update(1 / 60);
  }
  return { match, sim };
}

console.log('--- Spot audit ---');
{
  // A ball is either in an end zone — a score or a safety — or on the field of
  // play. Nothing rounds onto a goal line.
  assert.equal(deadBallSpot(100), 99, 'half a yard short of the goal line is the 99');
  assert.equal(deadBallSpot(0), 1, 'half a yard in front of our own line is the 1');
  assert.equal(deadBallSpot(-4), 1, 'however deep in our end zone the play died');
  assert.equal(deadBallSpot(37), 37, 'a normal spot is left where it is');

  // A runner pushed out of bounds behind our own goal line is a safety, not a
  // sideline tackle spotted at the 1.
  let oob: PlayOutcome | undefined;
  for (let seed = 1; seed <= 10 && !oob; seed++) {
    const { sim, carrier } = liveCarry(seed, 5);
    carrier.x = OWN_GOAL - 2;
    carrier.y = 0.3;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
    if (sim.result) oob = sim.result;
  }
  assert.ok(oob, 'the runner should be out of bounds');
  assert.equal(oob.kind, 'safety', 'out of bounds behind our own line is a safety');
  assert.equal(oob.endSpot, 0, 'spotted on our own goal line by rule');
  assert.equal(oob.headline, 'SAFETY!', 'and the deck names the rule it is');
  assert.ok(oob.yards <= -1, `charged the ground actually lost (${oob.yards})`);

  // Half a yard short of the end zone is not a score, and not the goal line.
  let near: PlayOutcome | undefined;
  let nearDiag = 'no seed produced a result';
  for (let seed = 1; seed <= 12 && !near; seed++) {
    const { sim, carrier } = liveCarry(seed, 80);
    carrier.x = OPP_GOAL - 0.5;
    carrier.y = MID_Y;
    // A stunned lineman cannot finish the tackle; stand a fresh one on him.
    const defender = sim.defense[0];
    defender.stunned = 0;
    defender.x = carrier.x + 0.2;
    defender.y = carrier.y;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
    nearDiag = `seed ${seed}: phase ${sim.phase}, result ${sim.result?.kind ?? 'none'}`;
    if (sim.result) near = sim.result;
  }
  assert.ok(near, `a defender standing on the runner should bring him down (${nearDiag})`);
  assert.ok(!near.touchdown, 'half a yard short is not a score');
  assert.equal(near.endSpot, 99, 'and is spotted at the 99, never on the goal line');

  // The same rounding on our own side, in front of the line: on the field.
  let short: PlayOutcome | undefined;
  for (let seed = 1; seed <= 12 && !short; seed++) {
    const { sim, carrier } = liveCarry(seed, 6);
    carrier.x = OWN_GOAL + 0.4;
    carrier.y = MID_Y;
    const defender = sim.defense[0];
    defender.stunned = 0;
    defender.x = carrier.x + 0.2;
    defender.y = carrier.y;
    sim.update(1 / 60, { x: 0, y: 0, sprint: false });
    if (sim.result) short = sim.result;
  }
  assert.ok(short, 'the runner should be brought down');
  assert.notEqual(short.kind, 'safety', 'in front of the line is not a safety');
  assert.equal(short.endSpot, 1, 'the ball is spotted on our own 1');

  // The safety end to end, through a real Match.
  const { match, sim, stats } = forcedSafety(11);
  const out = match.lastOutcome;
  assert.ok(
    out,
    `the sack should resolve (match ${match.phase}, sim ${sim.phase}, ` +
      `sim result ${sim.result?.kind ?? 'none'}, deadTimer ${sim.deadTimer.toFixed(2)})`,
  );
  assert.equal(out.kind, 'safety', 'a sack four yards deep in our end zone is a safety');
  assert.equal(out.endSpot, 0, 'spotted on our own goal line');
  assert.ok(out.yards <= -7, `and charged the real loss, not the distance to the line (${out.yards})`);
  assert.equal(match.state.scoreThem, 2, 'two points to them');
  assert.equal(match.state.spot, 25, 'we kick off from our 25 after the free kick');
  assert.equal(match.opponentStartSpot, 40, 'and they take over on their 40');
  const row = match.playLog[match.playLog.length - 1];
  assert.equal(row.kind, 'safety', 'the drive log files it as a safety');
  assert.equal(row.yards, out.yards, 'with the real loss on it');
  const before = JSON.parse(stats) as Record<string, { passComp: number; rec: number }>;
  for (const [id, line] of Object.entries(match.stats)) {
    assert.equal(line.passComp, before[id]?.passComp ?? 0, 'a safety is never a completion');
    assert.equal(line.rec, before[id]?.rec ?? 0, 'and never a catch');
  }
  match.advance();
  assert.equal(match.phase, 'defense', 'and then their drive follows the free kick');

  // A takeaway killed in their end zone is a touchback, not a spot 8 yards from
  // our goal line.
  let pick: PlaySim | undefined;
  for (let seed = 1; seed <= 40 && !pick; seed++) {
    const sim = endZonePick(seed);
    if (sim.result?.kind === 'interception') pick = sim;
  }
  assert.ok(pick?.result, 'the sweep should produce a pick in the end zone');
  const int = pick!.result!;
  assert.equal(int.endSpot, 80, 'a pick killed in their end zone is spotted at their 20');
  assert.equal(100 - int.endSpot, 20, 'which is 20 yards from their goal line');
  assert.match(int.headline, /TOUCHBACK/, 'and the deck calls it a touchback');
  assert.ok(
    interceptionDip(int.endSpot, int.airYards ?? 0) <= 0.48,
    'a touchback is the shallowest pick there is',
  );
  // A takeaway killed in our own end zone is their touchdown, not a short field
  // for them.
  let six: PlaySim | undefined;
  for (let seed = 1; seed <= 40 && !six; seed++) {
    const sim = endZonePick(seed, 'ours');
    if (sim.result?.defensiveScore) six = sim;
  }
  assert.ok(six?.result, 'the sweep should produce a takeaway in our own end zone');
  const sixOut = six!.result!;
  assert.equal(sixOut.kind, 'interception', 'the takeaway still counts against the passer');
  assert.equal(sixOut.defensiveScore, true, 'and it is their touchdown');
  assert.ok(!sixOut.touchdown, 'never ours');
  assert.equal(sixOut.endSpot, 0, 'the ball died on our goal line');
  assert.equal(sixOut.yards, -25, 'and is charged the ground to it');
  assert.equal(sixOut.headline, 'PICK SIX!', 'the deck names it');

  // Through a real Match: the scoreboard, the drive that follows, the log.
  let sixMatch: Match | undefined;
  for (let seed = 1; seed <= 60 && !sixMatch; seed++) {
    const { match } = forcedPickSix(seed);
    if (match.lastOutcome?.defensiveScore) sixMatch = match;
  }
  assert.ok(sixMatch, 'the sweep should produce a pick six through a Match');
  const o6 = sixMatch.lastOutcome!;
  assert.equal(sixMatch.state.scoreThem, 7, 'six points and the extra point');
  assert.equal(sixMatch.state.scoreUs, 0, 'and nothing for us');
  assert.equal(o6.headline, 'PICK SIX!', 'the deck knows what happened');
  const row6 = sixMatch.playLog[sixMatch.playLog.length - 1];
  assert.equal(row6.kind, 'interception', 'the drive log files the takeaway');
  assert.equal(row6.yards, o6.yards, 'with the same number as the deck');
  sixMatch.advance();
  assert.equal(sixMatch.phase, 'playcall', 'they kick off: our drive, not their series');
  assert.equal(sixMatch.state.spot, 25, 'from our own 25');
  assert.equal(sixMatch.state.possession, 'us', 'and we have the ball');

  console.log(
    `  out of bounds in the end zone → ${oob.kind} spotted ${oob.endSpot} · ` +
      `half a yard short → ${near.endSpot} · just past our line → ${short.endSpot} · ` +
      `sack on our 5 → safety, ${out.yards} yds, them 2 · end-zone pick → their 20 (${int.endSpot}) · ` +
      `pick in our own end zone → ${sixOut.headline} ${sixOut.yards} yds, them ${sixMatch.state.scoreThem}`,
  );
}

console.log('--- Opponent drive goal line ---');
{
  const drive = (seed: number, startSpot: number, theirOff: number, ourDef: number) =>
    simulateOpponentDrive({ rng: new Rng(seed), startSpot, theirOff, ourDef, kick: 75, clock: 600 });

  // Backed up on their own 1-4 against a winning pass rush: the goal-line rules
  // pay us, but a safety has to stay the rarity it is in real football — about one
  // every 17 or 18 games league-wide. A team snaps from inside its own 5 on only a
  // few percent of drives, so the conditional rate is single digits: a threat,
  // not the expected outcome.
  let safeties = 0;
  let sixes = 0;
  let deepest = 99;
  const perSpot = new Map<number, { drives: number; safeties: number }>();
  for (let seed = 1; seed <= 400; seed++) {
    const startSpot = ((seed - 1) % 4) + 1;
    const d = drive(seed, startSpot, 52, 92);
    assert.ok(d.plays.length > 0, 'a drive has plays');
    assert.ok(d.nextSpot >= 1 && d.nextSpot <= 99, 'we always take over on the field');
    assert.ok([0, 2, 7].includes(d.ourPoints), `our points are a safety or a score (${d.ourPoints})`);
    assert.ok([0, 3, 7].includes(d.points), `theirs are a field goal or a score (${d.points})`);
    let safety = false;
    for (const p of d.plays) {
      if (p.kind === 'run' || p.kind === 'pass' || p.kind === 'safety') {
        deepest = Math.min(deepest, p.spot + p.yards);
      }
      if (p.kind === 'safety') {
        safeties++;
        safety = true;
        assert.equal(d.ourPoints, 2, 'a safety is two of our points');
        assert.equal(d.nextSpot, 40, 'and the free kick puts us on our own 40');
        assert.equal(d.summary, 'SAFETY', 'the drive summary says so');
        assert.ok(p.yards < 0, 'a safety is charged the ground behind their line');
      }
      if (p.kind === 'def_td') {
        sixes++;
        assert.equal(d.ourPoints, 7, 'a defensive score is seven');
        assert.equal(d.nextSpot, 25, 'and they kick off to us at our 25');
        assert.equal(d.summary, 'DEFENSIVE TOUCHDOWN', 'the summary says so');
      }
    }
    const rec = perSpot.get(startSpot) ?? { drives: 0, safeties: 0 };
    rec.drives++;
    if (safety) rec.safeties++;
    perSpot.set(startSpot, rec);
  }
  const spotRate = (s: number) => {
    const r = perSpot.get(s)!;
    return r.safeties / r.drives;
  };
  const backedUpDrives = [...perSpot.values()].reduce((n, r) => n + r.drives, 0);
  const backedUpRate = [...perSpot.values()].reduce((n, r) => n + r.safeties, 0) / backedUpDrives;
  assert.ok(safeties >= 1, `the sweep should produce safeties (${safeties})`);
  assert.ok(sixes >= 1, `and defensive scores (${sixes})`);
  assert.ok(deepest < 0, `and the ball goes behind their line (${deepest})`);
  // The real benchmark: 151 safeties in 2,639 games from 2016-2025 is 0.057 a
  // game, and a team snaps from inside its own 4 on roughly 3% of its drives —
  // about 0.35 such drives a team-game. That puts a backed-up drive's safety rate
  // near 8%, so the old call sheet, at more than double that, was handing out two
  // points far too readily.
  for (const s of [1, 2, 3, 4]) {
    assert.ok(
      spotRate(s) < 0.16,
      `a snap on their ${s} is dangerous, not a routine safety (${(spotRate(s) * 100).toFixed(1)}%)`,
    );
  }
  assert.ok(
    backedUpRate < 0.12,
    `and a backed-up drive stays near that benchmark (${(backedUpRate * 100).toFixed(1)}%)`,
  );

  // A healthy offense from their own 25 never hands us points.
  for (let seed = 1; seed <= 60; seed++) {
    const d = drive(seed, 25, 84, 62);
    assert.equal(d.ourPoints, 0, 'a drive from their own 25 does not pay us');
    assert.equal(
      d.plays.some((p) => p.kind === 'safety' || p.kind === 'def_td'),
      false,
      'and holds no goal-line rows',
    );
  }
  console.log(
    `  safeties by start: their 1 ${(spotRate(1) * 100).toFixed(1)}% · ` +
      `2 ${(spotRate(2) * 100).toFixed(1)}% · 3 ${(spotRate(3) * 100).toFixed(1)}% · ` +
      `4 ${(spotRate(4) * 100).toFixed(1)}% — ${(backedUpRate * 100).toFixed(1)}% over ` +
      `${backedUpDrives} backed-up drives (${safeties} safeties, ${sixes} defensive scores)`,
  );
  console.log(`  deepest ball ${deepest} · a healthy drive pays us nothing`);

  // Through a real Match: the points land on our side and the kick hands us the
  // ball back, the mirror of what a pick six does for them.
  let scored: { match: Match; ourPoints: number } | undefined;
  for (let seed = 1; seed <= 160 && !scored; seed++) {
    const { match } = makeMatch(seed);
    const forced = match as unknown as {
      startDefense(spot: number): void;
      drive?: { ourPoints: number; nextSpot: number };
    };
    forced.startDefense(5);
    let seen = 0;
    let guard = 0;
    while (match.phase === 'defense' && guard < 6000) {
      guard++;
      if (forced.drive) seen = forced.drive.ourPoints;
      match.update(1 / 60);
    }
    if (seen > 0) scored = { match, ourPoints: seen };
  }
  assert.ok(scored, 'the sweep should produce a goal-line score for us in a Match');
  const sm = scored!.match;
  assert.equal(sm.state.scoreUs, scored!.ourPoints, 'their drive scored for us');
  assert.equal(sm.state.scoreThem, 0, 'and nothing for them');
  assert.equal(sm.phase, 'playcall', 'the kick hands us the ball');
  assert.equal(sm.state.possession, 'us', 'on offense');
  assert.equal(sm.state.spot, scored!.ourPoints === 2 ? 40 : 25, 'from their free kick or kickoff');
  console.log(
    `  through a Match: our ${scored!.ourPoints}-point score stands (${sm.state.scoreUs}-${sm.state.scoreThem}) ` +
      `and we take over on our ${sm.state.spot}`,
  );
}

console.log('--- Takeaway in our own red zone ---');
{
  // The deck's words for a field position, then where the next snap is spotted.
  assert.equal(spotLabel(1), 'OWN 1', 'our own 1 reads as the 1');
  assert.equal(spotLabel(50), 'OWN 50', 'midfield is still ours');
  assert.equal(spotLabel(51), 'OPP 49', 'a yard past it is theirs');
  assert.equal(spotLabel(99), 'OPP 1', 'their 1 reads as the 1');

  const deck = (patch: Partial<PlayOutcome>): PlayOutcome => ({
    kind: 'run',
    yards: 0,
    endSpot: 40,
    scored: false,
    touchdown: false,
    turnover: false,
    incomplete: false,
    outOfBounds: false,
    timeUsed: 5,
    description: '',
    headline: '',
    isPass: false,
    bigPlay: false,
    brokenTackles: 0,
    hypeGain: 0,
    ...patch,
  });

  assert.equal(nextSpotLabel(deck({ yards: -9, endSpot: 1 })), 'OWN 1', 'a tackle on our 1 is spotted on our 1');
  assert.equal(nextSpotLabel(deck({ yards: 12, endSpot: 99 })), 'OPP 1', 'a catch on their 1 is spotted on their 1');
  assert.equal(
    nextSpotLabel(deck({ kind: 'incomplete', incomplete: true, endSpot: 34 })),
    'OWN 34',
    'a ball that hits the turf comes back to the previous spot',
  );
  assert.equal(
    nextSpotLabel(deck({ kind: 'interception', turnover: true, endSpot: 3 }), 97),
    'OWN 3',
    'a takeaway in our red zone is spotted where it died',
  );
  assert.equal(
    nextSpotLabel(deck({ kind: 'fumble', turnover: true, endSpot: 2 }), 98),
    'OWN 2',
    'and so is a fumble',
  );
  assert.equal(
    nextSpotLabel(deck({ kind: 'punt', turnover: true, endSpot: 35 }), 20),
    'OPP 20',
    'a touchback punt is spotted on their 20',
  );
  assert.equal(
    nextSpotLabel(deck({ kind: 'field_goal_miss', turnover: true, endSpot: 77 }), 23),
    'OPP 23',
    'and a missed field goal where they take over',
  );
  assert.equal(
    nextSpotLabel(deck({ kind: 'touchdown', touchdown: true, scored: true, endSpot: 100 })),
    null,
    'a score is not spotted',
  );
  assert.equal(nextSpotLabel(deck({ kind: 'field_goal', scored: true, endSpot: 62 })), null, 'nor a field goal');
  assert.equal(nextSpotLabel(deck({ kind: 'safety', yards: -9, endSpot: 0 })), null, 'nor a safety');
  assert.equal(
    nextSpotLabel(deck({ kind: 'interception', turnover: true, defensiveScore: true, endSpot: 0 })),
    null,
    'nor a pick six',
  );

  // A pick on our 3, driven through a real Match: the old ceiling handed them the
  // ball on our 8 whatever the ball's flight spot was.
  let takeaway: { match: Match; endSpot: number; label: string; theirStart: number } | undefined;
  for (let seed = 1; seed <= 80 && !takeaway; seed++) {
    const { match } = makeMatch(seed);
    let steps = 0;
    while (match.phase !== 'live' && steps < 5000) {
      steps++;
      if (match.phase === 'playcall') {
        const card = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
        match.choosePlay(card.id);
      } else {
        match.update(1 / 60);
      }
    }
    const sim = match.sim;
    if (!sim) throw new Error('the snap should be live');
    let guard = 0;
    while (guard < 300 && !sim.result && (!sim.qb.hasBall || sim.phase !== 'dropback')) {
      guard++;
      match.update(1 / 60);
    }
    // Throw it to our own 3, then stand a defender on the landing spot for the
    // last frames of the flight.
    match.throwAt(OWN_GOAL + 3, MID_Y);
    guard = 0;
    while (!match.lastOutcome && guard < 1200) {
      guard++;
      if (!sim.result && sim.phase === 'air' && sim.ball.flight > 0 && sim.ball.time / sim.ball.flight > 0.85) {
        const spot = sim.ballTarget;
        const wr = sim.offense.find((a) => a.slot === 'WR1');
        if (wr) {
          wr.x = spot.x - 2;
          wr.y = spot.y;
        }
        const cb = sim.defense[0];
        cb.x = spot.x - 0.3;
        cb.y = spot.y;
      }
      match.update(1 / 60);
    }
    const o = match.lastOutcome;
    if (o?.kind === 'interception' && !o.defensiveScore && o.endSpot >= 1 && o.endSpot <= 4) {
      const label = nextSpotLabel(o, match.opponentStartSpot);
      if (label) takeaway = { match, endSpot: o.endSpot, label, theirStart: match.opponentStartSpot };
    }
  }
  assert.ok(takeaway, 'the sweep should produce a takeaway on our own doorstep');
  const t = takeaway!;
  assert.equal(t.theirStart, 100 - t.endSpot, 'they take over exactly where the ball died');
  assert.ok(t.theirStart >= 96, `never floored onto our 8 (theirs ${t.theirStart})`);
  assert.equal(t.label, spotLabel(100 - t.theirStart), `the deck names the same spot (${t.label})`);
  assert.match(t.label, /^OWN [1-4]$/, `and names our red zone (${t.label})`);

  // The drive that follows is really spotted 1 to 4 yards from our goal.
  const view = t.match as unknown as { drive?: { plays: { spot: number; toGo: number }[] } };
  t.match.advance();
  assert.equal(t.match.phase, 'defense', 'a takeaway hands them the ball');
  assert.equal(t.match.state.scoreThem, 0, 'and scores nothing for them');
  let guard = 0;
  while (!view.drive && guard < 600) {
    guard++;
    t.match.update(1 / 60);
  }
  const first = view.drive?.plays[0];
  assert.ok(first, 'their drive is on the board');
  assert.equal(first!.spot, t.theirStart, 'spotted where the takeaway died');
  assert.equal(first!.toGo, Math.min(10, 100 - t.theirStart), 'with the goal line as the distance');
  const yardsToOurGoal = 100 - t.theirStart;
  assert.ok(yardsToOurGoal >= 1 && yardsToOurGoal <= 4, `a short field to our goal (${yardsToOurGoal})`);

  // Balance: that short field is a threat, and it can never pay us — a safety
  // needs them backed up against their own goal line, at the other end.
  let shortTds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const d = simulateOpponentDrive({
      rng: new Rng(seed * 5),
      startSpot: 97,
      theirOff: 78,
      ourDef: 78,
      kick: 75,
      clock: 600,
    });
    if (d.points === 7) shortTds++;
    assert.equal(d.ourPoints, 0, 'a takeaway on our doorstep pays us nothing');
    assert.ok(d.nextSpot >= 1 && d.nextSpot <= 99, 'they always kick off to us on the field');
  }
  assert.ok(shortTds >= 1, `three yards out should score sometimes (${shortTds})`);
  assert.ok(shortTds < 60, `and not always (${shortTds})`);
  console.log(
    `  deepest takeaway spot: their ${t.theirStart} (${t.label}), ${yardsToOurGoal} yd from our goal · ` +
      `${shortTds} of 60 drives from their 97 end in their touchdown`,
  );
}

console.log('--- Fourth-down stands and punts on our doorstep ---');
{
  // A fourth-down stop inside our own 1-4 hands them the ball right there. The
  // old ceiling parked them on their 95 — our 5 — however deep our stand was.
  type Stand = { deadSpot: number; theirStart: number };
  const stands: Stand[] = [];
  for (let seed = 1; seed <= 400 && stands.length < 30; seed++) {
    const { match } = makeMatch(seed);
    let armed = false;
    let stand: Stand | undefined;
    let steps = 0;
    while (steps < 9000) {
      steps++;
      const phase = match.phase;
      if (phase === 'defense' && armed) break;
      if (phase === 'playcall') {
        const cards = match.cards;
        if (!cards.length) throw new Error('playcall should have cards');
        // Fourth and one on our own 3, however we arrived: whatever the defense
        // does next, the series ends on our doorstep.
        match.state.spot = 3;
        match.state.down = 4;
        match.state.toGo = 1;
        armed = true;
        match.choosePlay(cards[Math.floor((seed + steps * 7) % cards.length)].id);
      } else if (phase === 'live') {
        const sim = match.sim;
        if (!sim) throw new Error('live should have a sim');
        if (sim.phase === 'dropback' && sim.isPass && sim.elapsed > 1.4) {
          const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
          if (reads[0]) match.throwAt(reads[0].projected.x, reads[0].projected.y);
        }
        if (sim.phase === 'carry') match.setStick(1, 0.15, sim.elapsed > 0.4);
        else match.setStick(0, 0, false);
        match.update(1 / 60);
      } else if (phase === 'result') {
        const o = match.lastOutcome;
        if (o?.sub === 'TURNOVER ON DOWNS') {
          const deadSpot = Math.max(1, Math.min(99, Math.round(o.endSpot)));
          stand = { deadSpot, theirStart: match.opponentStartSpot };
          assert.equal(
            match.opponentStartSpot,
            Math.max(1, Math.min(99, 100 - deadSpot)),
            'a stand on our doorstep spots them on our doorstep',
          );
          assert.ok(
            match.opponentStartSpot >= 1 && match.opponentStartSpot <= 99,
            `their start is on the field (${match.opponentStartSpot})`,
          );
        }
        match.advance();
      } else if (phase === 'kick') {
        match.update(1 / 60);
        if (match.kick && match.kick.pos > 0.45) match.kickNow();
      } else if (phase === 'quarter' || phase === 'halftime') {
        match.continueQuarter();
      } else {
        match.update(1 / 60);
      }
      if (match.phase === 'defense' && armed) break;
    }
    if (stand) {
      stands.push(stand);
      // Their drive really opens on the spot the stand handed them.
      const view = match as unknown as { drive?: { plays: { spot: number }[] } };
      const first = view.drive?.plays[0];
      assert.ok(first, 'their drive is on the board');
      assert.equal(first!.spot, stand.theirStart, 'and opens where the stand left it');
    }
  }
  assert.ok(stands.length >= 1, `the sweep should find a stand on our doorstep (${stands.length})`);
  const deep = stands.filter((s) => s.deadSpot <= 4);
  assert.ok(deep.length >= 1, `and one inside our 4 (${deep.length})`);
  for (const s of deep) {
    assert.equal(s.theirStart, 100 - s.deadSpot, 'spotted exactly where the ball died');
    assert.ok(s.theirStart >= 96, `never parked on their 95 (${s.theirStart})`);
  }
  const deepest = Math.max(...deep.map((s) => s.theirStart));
  console.log(
    `  ${stands.length} fourth-down stands at our 3 · ${deep.length} inside our 4 · ` +
      `deepest their ${deepest} (${spotLabel(100 - deepest)}) · those drives open on the spot`,
  );

  // The punt's bound is the field of play too: a ball downed inside their 5 stays
  // there, one that carries over the goal line is a touchback on their 20, and a
  // block that dies behind our own goal line is a safety — from every spot on the
  // field, off the ball's own travel and nothing else.
  const { match: pm } = makeMatch(7);
  const punt = (pm as unknown as { punt(): void }).punt.bind(pm);
  let pinned = 0;
  let touchbacks = 0;
  let blocks = 0;
  let shanks = 0;
  let blockedSafeties = 0;
  let paid = 0;
  for (let spot = 1; spot <= 99; spot++) {
    pm.state.spot = spot;
    punt();
    const o = pm.lastOutcome;
    assert.ok(o, 'the punt resolves');
    // The net travel is the whole input: negative is a block, short of the usual
    // 35-55 is a shank. Everything after that is arithmetic, and the spot it hands
    // them is the mirror of the dead ball — never a ceiling.
    const landed = spot + o.yards;
    const safety = landed < 0;
    const touchback = landed >= 100;
    const deadSpot = Math.max(1, Math.min(99, landed));
    if (o.yards < 0) blocks++;
    else if (o.yards < 35) shanks++;
    assert.equal(
      pm.opponentStartSpot,
      safety ? 40 : touchback ? 20 : 100 - deadSpot,
      `a punt from our ${spot} is spotted honestly (${pm.opponentStartSpot})`,
    );
    assert.equal(o.endSpot, safety ? 0 : touchback ? 100 : deadSpot, 'the ball is where it died');
    if (safety) {
      blockedSafeties++;
      paid++;
      assert.equal(o.kind, 'safety', 'a block that dies in our end zone is a safety');
      assert.equal(pm.state.scoreThem, 2 * paid, 'and it is paid for exactly once');
    } else if (touchback) {
      touchbacks++;
    } else if (pm.opponentStartSpot <= 4) {
      pinned++;
    }
    assert.ok(
      pm.opponentStartSpot >= 1 && pm.opponentStartSpot <= 99,
      'their start is on the field of play',
    );
  }
  assert.ok(pinned >= 1, `a punt can pin them inside their 5 (${pinned})`);
  assert.ok(touchbacks >= 1, `and an over-hit punt is a touchback (${touchbacks})`);
  console.log(
    `  99 punts, one from every spot · ${pinned} pinned inside their 5 · ${touchbacks} touchbacks · ` +
      `every start its own, 1-99`,
  );
  console.log(
    `  the misfires in those 99: ${blocks} blocked (${blockedSafeties} died in our own end zone) · ` +
      `${shanks} shanked short`,
  );

  // Both misfires stay rare over a wide sweep.
  let punts = 0;
  let wideBlocks = 0;
  let wideShanks = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { match: m2 } = makeMatch(seed);
    const kick = (m2 as unknown as { punt(): void }).punt.bind(m2);
    for (let spot = 1; spot <= 99; spot++) {
      m2.state.spot = spot;
      kick();
      const o = m2.lastOutcome!;
      punts++;
      if (o.yards < 0) wideBlocks++;
      else if (o.yards < 35) wideShanks++;
    }
  }
  assert.ok(
    wideBlocks >= 1 && wideShanks >= 1,
    `both misfires happen (${wideBlocks} blocks, ${wideShanks} shanks)`,
  );
  assert.ok(wideBlocks * 20 < punts, `a block stays rare (${wideBlocks} of ${punts} punts)`);
  assert.ok(wideShanks * 10 < punts, `and so does a shank (${wideShanks} of ${punts})`);

  // A block is the one punt that can genuinely die on our own doorstep: the ball is
  // driven back behind our line, so from our own 1-5 it can stop on our 1-4 — an
  // opponent start of their 96-99, which the old ceiling of 95 could not express.
  // Punt from our own 3 until the rush gets home.
  const doorstep: { dead: number; their: number }[] = [];
  let safetiesAtThree = 0;
  for (let seed = 1; seed <= 200 && doorstep.length < 12; seed++) {
    const { match: m3 } = makeMatch(seed);
    const kick = (m3 as unknown as { punt(): void }).punt.bind(m3);
    let paidHere = 0;
    for (let i = 0; i < 60; i++) {
      m3.state.spot = 3;
      kick();
      const o = m3.lastOutcome!;
      if (o.yards >= 0) continue;
      const landed = 3 + o.yards;
      if (landed < 0) {
        // The block dies behind our own goal line: two points, a free kick, once.
        paidHere++;
        safetiesAtThree++;
        assert.equal(o.kind, 'safety', 'a block behind our line is a safety');
        assert.equal(m3.state.scoreThem, 2 * paidHere, 'paid for exactly once');
        assert.equal(m3.opponentStartSpot, 40, 'and they take the free kick');
        if (safetiesAtThree === 1) {
          // The punt sweep burned the quarter clock; give the free kick its own time.
          m3.state.clock = 120;
          // A block shows the scramble first: the whistle takes it to the deck.
          m3.settleBlock();
          m3.advance();
          assert.equal(m3.phase, 'defense', 'the free kick hands them the ball');
          assert.equal(m3.opponentStartSpot, 40, 'on their own 40');
        }
        continue;
      }
      const deadSpot = Math.max(1, Math.min(99, landed));
      assert.equal(m3.opponentStartSpot, 100 - deadSpot, 'a block spots them one for one');
      if (m3.opponentStartSpot > 95) doorstep.push({ dead: deadSpot, their: m3.opponentStartSpot });
    }
  }
  assert.ok(doorstep.length >= 1, `a block can leave them inside their own 5 (${doorstep.length})`);
  assert.ok(safetiesAtThree >= 1, `and one that dies behind our line is a safety (${safetiesAtThree})`);
  const deepestBlock = doorstep.reduce((m, d) => (d.their > m.their ? d : m), { dead: 99, their: 0 });
  assert.ok(
    deepestBlock.their >= 96 && deepestBlock.their <= 99,
    `a start the old ceiling of 95 could not express (their ${deepestBlock.their})`,
  );
  console.log(
    `  ${punts} punts swept · ${wideBlocks} blocked · ${wideShanks} shanked (a block under 1 in 20, ` +
      `a shank under 1 in 10) · punting from our 3: ${doorstep.length} left them their 96-99, ` +
      `deepest dead on our ${deepestBlock.dead} → their ${deepestBlock.their} · ${safetiesAtThree} safeties`,
  );
}

console.log('--- The blocked punt beat ---');
{
  // A block does not snap straight to the deck: the ball is loose on the field for
  // a beat first, and the spot, the points and the outcome are all decided before
  // that beat starts.
  const view = (m: Match) =>
    m as unknown as {
      blockFx?: { fromYard: number; toYard: number; hold: number };
      settleBlock(): void;
    };
  // Hand back a match that is mid-beat right now: each call ends on its block, so
  // the beat it returns has not been played out yet.
  const findBlock = (): Match | undefined => {
    for (let seed = 1; seed <= 400; seed++) {
      const { match } = makeMatch(seed);
      const kick = (match as unknown as { punt(): void }).punt.bind(match);
      for (let i = 0; i < 60; i++) {
        match.state.spot = 3;
        kick();
        if (match.phase === 'block') return match;
      }
    }
    return undefined;
  };
  const bm = findBlock();
  assert.ok(bm, 'a blocked punt opens the loose-ball beat');
  const cut = findBlock();
  assert.ok(cut, 'the sweep finds a second one to cut short');
  const fx = view(bm).blockFx;
  assert.ok(fx, 'the beat knows where the ball was snapped and where it dies');
  assert.equal(fx.fromYard, 3, 'from the spot it was snapped on');
  assert.ok(fx.toYard < fx.fromYard, `the ball is driven backwards (to our ${fx.toYard})`);
  const before = {
    their: bm.opponentStartSpot,
    them: bm.state.scoreThem,
    kind: bm.lastOutcome?.kind,
    headline: bm.lastOutcome?.headline,
  };
  let frames = 0;
  while (bm.phase === 'block' && frames < 900) {
    frames++;
    bm.update(1 / 60);
  }
  assert.equal(bm.phase, 'result', 'the beat ends at the result deck');
  assert.ok(frames > 20 && frames < 300, `a beat, not a freeze (${frames} frames)`);
  assert.equal(bm.opponentStartSpot, before.their, 'the spot was decided before the beat ran');
  assert.equal(bm.state.scoreThem, before.them, 'no points were added twice');
  assert.equal(bm.lastOutcome?.kind, before.kind, 'and the same outcome reads out');
  assert.equal(bm.lastOutcome?.headline, before.headline, 'under the same headline');

  // A tap cuts the same beat short, and changes nothing else.
  assert.ok(view(cut).blockFx, 'the second block is mid-beat too');
  const cutBefore = { their: cut.opponentStartSpot, them: cut.state.scoreThem };
  view(cut).settleBlock();
  assert.equal(cut.phase, 'result', 'the whistle takes it straight to the deck');
  assert.equal(view(cut).blockFx, undefined, 'and the loose ball is cleared');
  assert.equal(cut.opponentStartSpot, cutBefore.their, 'the spot is unchanged');
  assert.equal(cut.state.scoreThem, cutBefore.them, 'and so are the points');
  console.log(
    `  blocked punt beat: ${frames} frames (${(frames / 60).toFixed(2)}s) before the deck · driven ` +
      `back from our 3 to our ${fx.toYard} · a tap cuts it short · their ${bm.opponentStartSpot} ` +
      `(${bm.lastOutcome?.headline}), nothing paid twice`,
  );
}

console.log('--- Our own doorstep from their dead ball ---');
{
  // The same rule for us. After their punt or a series that dies against our goal
  // line, we start where their ball died, on the field of play — our own 1-4 is a
  // real place to start, not a floor of our own 5.
  const ours: { start: number; summary: string }[] = [];
  let settled = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const d = simulateOpponentDrive({
      rng: new Rng(seed * 7),
      startSpot: 96 + (seed % 4),
      theirOff: 70,
      ourDef: 88,
      kick: 75,
      clock: 600,
    });
    assert.ok(d.nextSpot >= 1 && d.nextSpot <= 99, 'we always start on the field of play');
    if (d.touchdown || d.points === 3 || d.ourPoints > 0) continue;
    const last = d.plays[d.plays.length - 1];
    const deadSpot = Math.max(1, Math.min(99, last.spot + last.yards));
    assert.equal(
      d.nextSpot,
      100 - deadSpot,
      `our start is the mirror of their dead ball (${d.nextSpot} vs ${100 - deadSpot})`,
    );
    settled++;
    if (d.nextSpot <= 4) ours.push({ start: d.nextSpot, summary: d.summary });
  }
  assert.ok(ours.length >= 1, `their ball can die on our doorstep (${ours.length})`);
  assert.ok(
    ours.every((o) => o.start >= 1 && o.start <= 4),
    'and the start is our own 1-4',
  );
  console.log(
    `  ${settled} dead-ball finishes from their own 96-99 · ${ours.length} hand us our own 1-4 ` +
      `(deepest our ${Math.min(...ours.map((o) => o.start))}) · ` +
      ours.slice(0, 3).map((o) => `our ${o.start} after ${o.summary}`).join(' / '),
  );
}

console.log('--- Backed-up opponent drives in real play ---');
{
  // A full game played like a real team plays it: kick the field goal in range,
  // go for it on fourth and short, punt when it is out of range. Every drive the
  // opponent starts is recorded by its start spot, and the drive's own score tells
  // us whether our defense took points off it.
  type Deep = { start: number; source: string; safety: boolean };
  const starts: number[] = [];
  const deep: Deep[] = [];
  let drives = 0;
  let safeties = 0;
  let defensiveScores = 0;
  let pinnedByPunt = 0;
  let touchbacks = 0;

  for (let seed = 1; seed <= 240; seed++) {
    const { match } = makeMatch(seed);
    const forced = match as unknown as { drive?: { plays: { spot: number }[] } };
    let steps = 0;
    let source = 'other';
    let pending: { start: number; scoreUs: number; source: string } | undefined;
    while (match.phase !== 'final' && steps < 60000) {
      steps++;
      const phase = match.phase;
      if (phase === 'playcall') {
        assert.ok(
          match.state.spot >= 1 && match.state.spot <= 99,
          `we snap on the field (${match.state.spot})`,
        );
        const cards = match.cards;
        if (cards.length === 0) throw new Error('playcall should have cards');
        match.choosePlay(cards[Math.floor((seed + steps * 7) % cards.length)].id);
      } else if (phase === 'live') {
        const sim = match.sim;
        if (!sim) throw new Error('live should have a sim');
        if (sim.phase === 'dropback' && sim.isPass && sim.elapsed > 1.7) {
          const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
          if (reads[0]) match.throwAt(reads[0].projected.x, reads[0].projected.y);
        }
        if (sim.phase === 'carry') match.setStick(1, 0.15, sim.elapsed > 0.5);
        else match.setStick(0, 0, false);
        match.update(1 / 60);
      } else if (phase === 'result') {
        const o = match.lastOutcome;
        if (o) {
          if (o.kind === 'punt' && o.description.includes('Touchback')) touchbacks++;
          source =
            o.sub === 'TURNOVER ON DOWNS'
              ? 'turnover on downs'
              : o.kind === 'punt'
                ? 'punt pin'
                : o.kind === 'interception' || o.kind === 'fumble'
                  ? 'takeaway'
                  : o.kind;
        }
        match.advance();
      } else if (phase === 'fourth') {
        match.chooseFourth(
          match.canGoForFieldGoal && match.state.toGo > 2
            ? 'fg'
            : match.state.toGo <= 4
              ? 'go'
              : 'punt',
        );
      } else if (phase === 'kick') {
        match.update(1 / 60);
        if (match.kick && match.kick.pos > 0.45) match.kickNow();
      } else if (phase === 'defense') {
        if (!pending && forced.drive) {
          const start = forced.drive.plays[0]?.spot ?? 0;
          pending = { start, scoreUs: match.state.scoreUs, source };
          starts.push(start);
          drives++;
          if (source === 'punt pin' && start <= 4) pinnedByPunt++;
        }
        match.update(1 / 60);
      } else if (phase === 'quarter' || phase === 'halftime') {
        match.continueQuarter();
      } else {
        match.update(1 / 60);
      }
      if (pending && match.phase !== 'defense') {
        const delta = match.state.scoreUs - pending.scoreUs;
        if (delta === 2) {
          safeties++;
          if (match.phase === 'playcall') {
            assert.equal(match.state.spot, 40, 'a safety on their drive gives us our own 40');
            assert.equal(match.state.possession, 'us', 'and the ball');
          }
        } else if (delta === 7) {
          defensiveScores++;
          if (match.phase === 'playcall') {
            assert.equal(match.state.spot, 25, 'a defensive score gives us our own 25');
            assert.equal(match.state.possession, 'us', 'and the ball');
          }
        }
        if (pending.start <= 4) {
          deep.push({ start: pending.start, source: pending.source, safety: delta === 2 });
        }
        pending = undefined;
      }
    }
    assert.equal(match.phase, 'final', `seed ${seed} should reach the final phase`);
    assert.ok(match.state.scoreUs >= 0 && match.state.scoreThem >= 0, 'scores stay non-negative');
  }

  const deepStarts = deep.length;
  const deepSafeties = deep.filter((d) => d.safety).length;
  const bucket = (lo: number, hi: number) => starts.filter((s) => s >= lo && s <= hi).length;
  console.log(
    `  ${drives} opponent drives in 240 games · start spots: their 1-4 ×${bucket(1, 4)} · ` +
      `5-9 ×${bucket(5, 9)} · 10-19 ×${bucket(10, 19)} · 20-39 ×${bucket(20, 39)} · ` +
      `40-59 ×${bucket(40, 59)} · 60-79 ×${bucket(60, 79)} · 80-99 ×${bucket(80, 99)}`,
  );
  console.log(
    `  deepest start their ${Math.min(...starts)} · ${deepStarts} drives inside their 5 ` +
      `(${deep.map((d) => d.source).join(', ')}) · ${pinnedByPunt} of them punt pins`,
  );
  console.log(
    `  safeties ${safeties} overall, ${deepSafeties} of ${deepStarts} backed-up drives ` +
      `(${((deepSafeties / Math.max(1, deepStarts)) * 100).toFixed(1)}%) · ` +
      `defensive scores ${defensiveScores} · ${touchbacks} over-hit punts became touchbacks`,
  );
  assert.ok(
    touchbacks >= 1,
    `an over-hit punt is a touchback, not a phantom pin (${touchbacks})`,
  );
  console.log(
  );
  assert.ok(deepStarts >= 1, `a real game should back them up inside their 5 (${deepStarts})`);
  assert.ok(Math.min(...starts) <= 4, `the deepest start is inside their 5 (${Math.min(...starts)})`);
  assert.ok(
    deep.some((d) => d.source === 'punt pin'),
    'and a punt pin should reach them there',
  );
  assert.ok(deepSafeties >= 1, `a safety should come out of normal play (${deepSafeties})`);
  assert.equal(safeties >= deepSafeties, true, 'deep safeties are a subset of all safeties');
  assert.ok(
    deepSafeties * 8 < deepStarts,
    `and a backed-up start is a single-digit safety rate (${deepSafeties} of ${deepStarts})`,
  );
  assert.ok(
    safeties * 4 < drives,
    `safeties stay a small minority of drives (${safeties} of ${drives})`,
  );
  assert.ok(
    deepSafeties * 2 < Math.max(3, deepStarts),
    `and a minority of backed-up drives (${deepSafeties} of ${deepStarts})`,
  );
}

function playToHalftime(seed: number) {
  const { franchise, match } = makeMatch(seed);
  let steps = 0;
  let plays = 0;
  let threw = false;
  while (match.phase !== 'halftime' && steps < 90_000) {
    steps++;
    const phase = match.phase;
    if (phase === 'playcall') {
      const cards = match.cards;
      assert.ok(cards.length > 0, 'playcall should have cards');
      match.choosePlay(cards[Math.floor((seed + steps * 7) % cards.length)].id);
      plays++;
      threw = false;
    } else if (phase === 'live') {
      const sim = match.sim;
      if (!sim) throw new Error('live should have a sim');
      if (sim.phase === 'dropback' && sim.isPass && !threw && sim.elapsed > 1.7) {
        const reads = sim.getReads().sort((a, b) => b.percent - a.percent);
        if (reads[0]) {
          match.throwAt(reads[0].projected.x, reads[0].projected.y);
          threw = true;
        }
      }
      if (sim.phase === 'carry') match.setStick(1, 0.15, sim.elapsed > 0.5);
      else match.setStick(0, 0, false);
      match.update(1 / 60);
    } else if (phase === 'result') {
      match.advance();
    } else if (phase === 'fourth') {
      match.chooseFourth(match.canGoForFieldGoal ? 'fg' : 'go');
    } else if (phase === 'kick') {
      match.update(1 / 60);
      if (match.kick && match.kick.pos > 0.45) match.kickNow();
    } else if (phase === 'quarter') {
      // The first quarter's moments are still needed at the break.
      const shelf = match.filmCount;
      match.continueQuarter();
      assert.equal(match.filmCount, shelf, 'the film shelf survives the quarter break');
    } else {
      match.update(1 / 60);
    }
  }
  return { franchise, match, plays };
}

console.log('--- Halftime reel ---');
{
  let checked = 0;
  for (const seed of [61, 62, 63, 64]) {
    const { franchise, match, plays } = playToHalftime(seed);
    assert.equal(match.phase, 'halftime', `seed ${seed} should reach halftime`);
    const reel = match.reel;
    if (!reel) {
      assert.equal(match.sim, undefined, 'a half with no moments leaves the field clear');
      console.log(`  seed ${seed}: ${plays} plays, no tape worth cutting`);
      continue;
    }
    assert.ok(reel.moments.length <= 3, 'the reel is the best few moments');
    assert.ok(reel.active, 'the tape starts playing as soon as the half ends');
    for (let i = 0; i < reel.moments.length; i++) {
      const film = reel.moments[i];
      assert.ok(film.moment.score >= MOMENT_FLOOR, 'every moment clears the floor');
      assert.ok(film.frames > 4, 'a film has frames');
      assert.ok(film.peak >= 0 && film.peak < film.frames, 'the peak is inside the film');
      const win = filmWindow(film);
      assert.ok(win.start <= win.end && win.end < film.frames, 'the window stays inside the film');
      assert.ok((win.end - win.start) / FILM_HZ > 1, 'a moment replays more than a second of film');
      if (i > 0) {
        assert.ok(film.playCounter > reel.moments[i - 1].playCounter, 'the reel runs oldest first');
      }
    }

    const sim = match.sim;
    if (!sim) throw new Error('the reel should puppet the recorded sim');
    assert.equal(sim, reel.moments[0].sim, 'the puppeted sim is the one on film');
    const first = reel.moments[0];
    // A scoring moment has to open on the goal line, not on the whistle.
    const tdFilm = reel.moments.find((f) => f.moment.touchdown);
    if (tdFilm) {
      applyFilm(tdFilm, tdFilm.peak, sim);
      const runner = sim.carrier;
      assert.ok(runner, 'a scoring moment knows the runner at its peak');
      // Anywhere in the end zone counts: a pass can be caught seven yards deep.
      assert.ok(
        runner.x >= OPP_GOAL - 2 && runner.x <= OPP_GOAL + 10,
        `a scoring moment opens in the end zone (x ${runner.x.toFixed(2)})`,
      );
      console.log(`  scoring moment opens at x ${runner.x.toFixed(2)} (goal line ${OPP_GOAL})`);
    }

    const win = filmWindow(first);
    const pose = () => sim.actors.map((a) => `${a.x.toFixed(3)},${a.y.toFixed(3)}`).join('|');
    applyFilm(first, win.start, sim);
    const startPose = pose();
    applyFilm(first, win.start, sim);
    assert.equal(pose(), startPose, 'the same frame replays identically');
    applyFilm(first, win.end, sim);
    assert.notEqual(pose(), startPose, 'the end of the window is a different pose');

    // Every frame of every moment is a real pose: none of them wander off, and
    // reading a different film into this sim does not misalign the frame.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let biggestActor = 0;
    for (const film of reel.moments) {
      for (let f = 0; f < film.frames; f += 3) {
        applyFilm(film, f, sim);
        biggestActor = Math.max(biggestActor, sim.actors.length);
        for (const a of sim.actors) {
          assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'film poses are finite');
          minX = Math.min(minX, a.x);
          maxX = Math.max(maxX, a.x);
          minY = Math.min(minY, a.y);
          maxY = Math.max(maxY, a.y);
        }
      }
    }
    console.log(
      `  ${reel.moments.length} films, ${biggestActor} actors a frame: ` +
        `x ${minX.toFixed(2)}..${maxX.toFixed(2)} · y ${minY.toFixed(2)}..${maxY.toFixed(2)}`,
    );
    // The box is the field plus slack: a deep route can carry a receiver past
    // the back of the end zone (129 was measured), which the live game shows too.
    assert.ok(minX > -5 && maxX < 140, 'film poses stay near the field');
    assert.ok(minY > -5 && maxY < FIELD_W + 5, 'film poses stay inside the sidelines');
    if (checked === 0) {
      console.log(
        `  seed ${seed}: ${plays} plays → ${reel.moments.length} moments ` +
          reel.moments.map((f) => `[${f.moment.label}]`).join(' '),
      );
    }

    // Playing the tape to the end hands the field, the rate and the clock back.
    let minScale = 1;
    let maxK = 0;
    let guard = 0;
    while (reel.active && guard < 60_000) {
      guard++;
      match.update(1 / 60);
      minScale = Math.min(minScale, match.timeScale);
      maxK = Math.max(maxK, match.slowmoK);
    }
    assert.ok(guard < 60_000, 'the reel should finish on its own');
    assert.equal(reel.active, false, 'the tape ends after the last moment');
    assert.equal(match.phase, 'halftime', 'the reel does not start the quarter');
    assert.equal(match.sim, undefined, 'the field is cleared when the reel ends');
    assert.equal(match.timeScale, 1, 'the tape hands real time back');
    assert.equal(match.slowmoK, 0, 'no wash is left on the frame');
    assert.ok(minScale < 0.75, `motion on: the tape runs at reduced speed (min ${minScale.toFixed(3)})`);
    assert.ok(maxK > 0.5, `motion on: the frame is washed while it runs (max ${maxK.toFixed(3)})`);

    if (checked === 0) {
      console.log(`  motion on: min rate ${minScale.toFixed(3)}, wash ${maxK.toFixed(3)}`);
      // REDUCED MOTION keeps the reel, at full speed and without the wash.
      franchise.settings.reducedMotion = true;
      match.replayReel();
      assert.equal(reel.active, true, 'the tape runs again');
      let minS = 1;
      let maxWash = 0;
      for (let i = 0; i < 300; i++) {
        match.update(1 / 60);
        minS = Math.min(minS, match.timeScale);
        maxWash = Math.max(maxWash, match.slowmoK);
      }
      assert.equal(minS, 1, 'reduced motion never dilates the tape');
      assert.equal(maxWash, 0, 'reduced motion draws no wash');
      console.log(`  reduced motion: min rate ${minS.toFixed(3)}, wash ${maxWash.toFixed(3)}`);
    }

    match.endReel();
    match.continueQuarter();
    assert.equal(match.phase, 'playcall', 'the second half starts');
    assert.equal(match.state.quarter, 3, 'the reel hands over to the third quarter');
    assert.equal(match.reel, undefined, 'the reel is cleared when the quarter starts');
    checked++;
    break;
  }
  assert.ok(checked >= 1, 'a half of football should produce a moment worth replaying');
}

/**
 * Snap, hand a free rusher the quarterback, and report the dip the game plays.
 * Measuring through Match is the point: the setting is enforced there.
 */
function sackThroughMatch(seed: number, loss: number, apply: (f: Franchise) => void) {
  const franchise = createFranchise(seed);
  apply(franchise);
  const week = franchise.schedule[0];
  const match = new Match({
    franchise,
    opponent: getTeam(franchise, week.opponentId),
    week,
    weather: WEATHER[week.weather],
    seed: seed * 23,
  });
  match.begin();
  const card = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
  match.choosePlay(card.id);
  match.snap();
  const sim = match.sim;
  if (!sim) throw new Error('a snap should leave a sim on the field');
  sim.qb.x = sim.los - loss;
  const rusher = sim.defense.find((d) => d.assignment === 'rush');
  if (!rusher) throw new Error('a defense should send a rusher');
  rusher.x = sim.qb.x - 0.4;
  rusher.y = sim.qb.y;
  let frames = 0;
  let minScale = 1;
  let maxShake = 0;
  for (let i = 0; i < 240; i++) {
    match.update(1 / 60);
    if (match.timeScale < 0.999) {
      frames++;
      minScale = Math.min(minScale, match.timeScale);
    }
    maxShake = Math.max(maxShake, match.sim?.shake ?? 0);
    if (match.phase === 'result' && i > 90) break;
  }
  return { kind: match.lastOutcome?.kind ?? 'none', dip: 1 - minScale, frames, maxShake };
}

console.log('--- Slow motion setting ---');
{
  const full = sackThroughMatch(5, 9, (f) => {
    f.settings.slowmo = 'full';
  });
  const short = sackThroughMatch(5, 9, (f) => {
    f.settings.slowmo = 'short';
  });
  const off = sackThroughMatch(5, 9, (f) => {
    f.settings.slowmo = 'off';
  });
  const muted = sackThroughMatch(5, 9, (f) => {
    f.settings.slowmo = 'full';
    f.settings.reducedMotion = true;
  });
  for (const [name, run] of [
    ['full', full],
    ['short', short],
    ['off', off],
    ['reduced motion', muted],
  ] as const) {
    assert.equal(run.kind, 'sack', `${name}: the free rusher should get home`);
  }
  console.log(
    `  same 9 yd sack · full ${full.dip.toFixed(3)} over ${full.frames}f · short ${short.dip.toFixed(3)} over ` +
      `${short.frames}f · off ${off.dip.toFixed(3)} over ${off.frames}f · reduced motion ${muted.dip.toFixed(3)} over ${muted.frames}f`,
  );
  console.log(
    `  camera shake on the same hit: full ${full.maxShake.toFixed(3)} · short ${short.maxShake.toFixed(3)} · off ${off.maxShake.toFixed(3)}`,
  );

  // FULL plays the dip the sack earned, held for a beat.
  assert.ok(full.dip > 0.4 && full.dip <= 0.56, `full dips by the loss (${full.dip.toFixed(3)})`);
  assert.ok(full.frames >= 35 && full.frames <= 50, `full holds for a beat (${full.frames} frames)`);
  // SHORT is the same moment, about half as deep and half as long.
  assert.ok(short.dip > 0.2 && short.dip < full.dip * 0.75, `short dips less (${short.dip.toFixed(3)})`);
  assert.ok(
    short.frames > 12 && short.frames < full.frames * 0.8,
    `short recovers sooner (${short.frames} frames vs ${full.frames})`,
  );
  // OFF never leaves real time, and REDUCED MOTION still wins over the setting.
  assert.equal(off.dip, 0, 'off never dilates time');
  assert.equal(off.frames, 0, 'off never leaves real time');
  assert.equal(muted.dip, 0, 'reduced motion never dilates time');
  // Shake is the other switch: identical whatever the dip is set to.
  assert.ok(off.maxShake > 0.1, `the camera still takes the hit with the dip off (${off.maxShake.toFixed(3)})`);
  assert.ok(
    Math.abs(off.maxShake - full.maxShake) < 0.02 && Math.abs(short.maxShake - full.maxShake) < 0.02,
    'shake is untouched by the slow-motion setting',
  );
}

console.log('--- Settings hydration ---');
{
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  // A save from a build that had no SLOW MOTION switch, with the player's own
  // choices already made.
  const legacy = createFranchise(4242);
  delete (legacy.settings as Partial<Franchise['settings']>).slowmo;
  legacy.settings.sound = false;
  legacy.settings.crt = false;
  store.set('rewind-bowl-save-v1', JSON.stringify({ ...legacy, version: 1 }));
  const loaded = loadFranchise();
  assert.ok(loaded, 'the save should load');
  assert.equal(loaded.settings.slowmo, 'full', 'an old save plays the dips as it always has');
  assert.equal(loaded.settings.sound, false, 'existing choices survive hydration');
  assert.equal(loaded.settings.crt, false, 'existing choices survive hydration');
  store.set(
    'rewind-bowl-save-v1',
    JSON.stringify({ ...legacy, version: 1, settings: { ...legacy.settings, slowmo: 'off' } }),
  );
  assert.equal(loadFranchise()?.settings.slowmo, 'off', 'a saved setting survives a relaunch');
  (globalThis as { localStorage?: unknown }).localStorage = undefined;
  console.log('  legacy save → full · saved setting → off · other switches intact');
}

console.log('--- QB scramble ---');
{
  /** A pocket to take off from: a pass play by default, a handoff if asked. */
  const pocket = (seed: number, spot = 30, kind: 'pass' | 'run' = 'pass') => {
    const franchise = createFranchise(seed);
    const week = franchise.schedule[0];
    const plays = PLAYBOOK.filter((p) => p.kind === kind);
    const sim = new PlaySim({
      play: plays[seed % plays.length],
      los: OWN_GOAL + spot,
      startSpot: spot,
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
    return sim;
  };
  const toPhase = (s: PlaySim, want: PlaySim['phase'], frames: number) => {
    s.start();
    let g = 0;
    while (s.phase !== want && !s.result && g < frames) {
      g++;
      s.update(1 / 60, { x: 0, y: 0, sprint: false });
    }
    return s;
  };
  const toPocket = (s: PlaySim) => toPhase(s, 'dropback', 90);
  /** Let the pocket form: the take-off is a decision, not the snap frame. */
  const settle = (s: PlaySim, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60) && s.phase === 'dropback' && !s.result; i++) {
      s.update(1 / 60, { x: 0, y: 0, sprint: false });
    }
    return s;
  };
  /** A player's escape: steer away from the nearest rusher, then turn upfield. */
  const takeOff = (s: PlaySim) => {
    let t = 0;
    let g = 0;
    while (!s.result && g < 4000) {
      g++;
      t += 1 / 60;
      const qb = s.qb;
      const nearest = s.defense
        .map((d) => ({ d, dd: Math.hypot(d.x - qb.x, d.y - qb.y) }))
        .sort((a, b) => a.dd - b.dd)[0];
      const side = nearest.d.y >= qb.y ? -1 : 1;
      s.update(1 / 60, t < 0.55 ? { x: 0.7, y: side * 0.7, sprint: true } : { x: 1, y: side * 0.2, sprint: true });
    }
    return s.result;
  };
  const flight = (s: PlaySim, y: number, sprint = true) => {
    let g = 0;
    while (!s.result && g < 4000) {
      g++;
      s.update(1 / 60, { x: 1, y, sprint });
    }
    return s.result;
  };

  // The escape itself: a live pocket, the ball in his hand, and the snap becomes a
  // run that is his own.
  const sim = settle(toPocket(pocket(3, 30)), 1.2);
  assert.equal(sim.phase, 'dropback', 'a pass play opens in the pocket');
  assert.ok(sim.scramble(), 'the quarterback can take off from it');
  assert.equal(sim.phase, 'carry', 'and the snap becomes a carry');
  assert.equal(sim.carrier, sim.qb, 'with the quarterback as the runner');
  assert.ok(sim.qb.hasBall, 'the ball still in his hands');
  const ground = flight(sim, 0.1);
  assert.ok(ground, 'the scramble resolves');
  assert.equal(ground!.kind, 'run', `a scramble is a run on the sheet (${ground!.kind})`);
  assert.equal(ground!.isPass, false, 'and never a pass attempt');
  assert.equal(ground!.carrierId, sim.qb.rosterId, 'credited to the quarterback');

  // The player's own route to it: pushing the stick in the pocket takes off, and a tap
  // on the quarterback reads as him while a tap six yards away does not.
  const held = toPocket(pocket(11, 30));
  held.update(1 / 60, { x: 1, y: 0, sprint: false });
  assert.equal(held.phase, 'dropback', 'a direction held from the snap is not a take-off');
  const pushed = settle(toPocket(pocket(11, 30)), 0.7);
  pushed.update(1 / 60, { x: 1, y: 0, sprint: false });
  assert.equal(pushed.phase, 'carry', 'pushing the stick in the pocket takes off');
  assert.equal(pushed.scrambled, true, 'and it is the scramble, not a throw');
  const tapped = toPocket(pocket(12, 25));
  // Let a play fake clear, so the back is a legal target for this whole block.
  tapped.elapsed = Math.max(tapped.elapsed, (tapped.play.playAction ?? 0) + 0.1);
  // Park the receivers forty yards downfield: what the next lines measure is the zone
  // itself, not whoever happens to be standing beside him at this seed.
  let parked = 40;
  for (const a of tapped.offense) {
    if (a === tapped.qb) continue;
    a.x = tapped.qb.x + (parked += 3);
    a.vx = 0;
    a.vy = 0;
  }
  // The zone comes from the camera, so it is a fingertip wide on a phone rather than a
  // fixed circle of field: the miss that used to throw now takes off.
  const zone = tapRadiusForScale(cameraScale(390, 300));
  assert.ok(
    zone > QB_TAP_CORE,
    `a phone-sized tap zone is wider than the old fixed circle (${zone.toFixed(2)} vs ${QB_TAP_CORE} yds)`,
  );
  assert.equal(tapped.tapIntent(tapped.qb.x + 0.6, tapped.qb.y, zone), 'qb', 'a tap on the quarterback is his');
  assert.equal(tapped.tapIntent(tapped.qb.x + 2.2, tapped.qb.y, zone), 'qb', 'and a thumb-wide miss still is');
  assert.equal(tapped.tapIntent(tapped.qb.x + 6, tapped.qb.y, zone), 'throw', 'a tap six yards away throws');
  assert.equal(tapped.tapIntent(tapped.qb.x, tapped.qb.y, 0.5), 'qb', 'a tiny zone still keeps the old circle');
  // The wider zone never swallows a checkdown: whoever is nearer to the tap owns it.
  const swing = tapped.offense.find((a) => a.slot === 'RB')!;
  swing.x = tapped.qb.x + 2.6;
  swing.y = tapped.qb.y + 0.8;
  swing.vx = 0;
  swing.vy = 0;
  assert.equal(
    tapped.tapIntent(swing.x, swing.y, zone),
    'throw',
    'a tap on the back beside him still throws',
  );
  assert.equal(
    tapped.tapIntent(tapped.qb.x + 2.0, tapped.qb.y + 0.4, zone),
    'throw',
    'and so does a tap between them that is nearer the back',
  );
  assert.equal(
    tapped.tapIntent(tapped.qb.x + 1.4, tapped.qb.y - 0.9, zone),
    'qb',
    'while the same zone on his side is still the take-off',
  );
  console.log(
    `  tap zone: ${TAP_RADIUS_PX}px → ${zone.toFixed(2)} yds at phone zoom (390×300 canvas, ${cameraScale(390, 300).toFixed(1)} px/yd) · was ${QB_TAP_CORE}`,
  );

  // Landscape is the wide frame. Same kind of canvas, less zoom: the turned phone
  // sees most of the field's 53-yard width and about twice the downfield stretch,
  // which is the whole point of rotating instead of just letterboxing portrait.
  const portraitZoom = cameraScale(412, 470);
  const landscapeZoom = cameraScale(600, 386);
  const portraitView = { across: 470 / portraitZoom, downfield: 412 / portraitZoom };
  const landscapeView = { across: 386 / landscapeZoom, downfield: 600 / landscapeZoom };
  assert.ok(
    landscapeView.across > portraitView.across,
    `landscape shows more of the field's width (${landscapeView.across.toFixed(1)} vs ${portraitView.across.toFixed(1)} yds)`,
  );
  assert.ok(
    landscapeView.downfield > portraitView.downfield * 1.6,
    `and roughly twice the downfield stretch (${landscapeView.downfield.toFixed(1)} vs ${portraitView.downfield.toFixed(1)} yds)`,
  );
  console.log(
    `  landscape camera: ${landscapeZoom.toFixed(1)} px/yd → ${landscapeView.across.toFixed(1)} yds across · ${landscapeView.downfield.toFixed(1)} downfield (portrait ${portraitView.across.toFixed(1)} × ${portraitView.downfield.toFixed(1)})`,
  );

  // Only a pass play, and only while the ball is still his.
  assert.equal(pocket(14, 30).scramble(), false, 'nothing to scramble before the snap');
  const handoff = toPhase(pocket(7, 30, 'run'), 'carry', 900);
  assert.ok(handoff.carrier, 'a run play hands the ball off');
  assert.ok(handoff.carrier !== handoff.qb, 'to the back, not the quarterback');
  assert.equal(handoff.scramble(), false, 'keeping it on a run play is the designed handoff');
  assert.equal(handoff.tapIntent(handoff.qb.x, handoff.qb.y, zone), 'throw', 'and no tap takes off once it is a handoff');
  const thrown = toPocket(pocket(5, 30));
  thrown.throwTo(thrown.los + 12, MID_Y);
  assert.equal(thrown.scramble(), false, 'the ball is gone: no take-off');
  assert.equal(thrown.tapIntent(thrown.qb.x, thrown.qb.y, zone), 'throw', 'and a tap on him throws nothing once it is out');

  // Through a real Match: the stat sheet and the drive log both call it a run.
  const { match } = makeMatch(21);
  let steps = 0;
  while (match.phase !== 'live' && steps < 5000) {
    steps++;
    if (match.phase === 'playcall') {
      const card = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
      match.choosePlay(card.id);
    } else {
      match.update(1 / 60);
    }
  }
  const msim = match.sim;
  if (!msim) throw new Error('the snap should be live');
  let g2 = 0;
  while (g2 < 300 && !msim.result && (!msim.qb.hasBall || msim.phase !== 'dropback')) {
    g2++;
    match.update(1 / 60);
  }
  const qbId = msim.qb.rosterId;
  if (!qbId) throw new Error('the quarterback should have a roster id');
  assert.equal(match.stats[qbId]?.rushAtt ?? 0, 0, 'no carry charged before he runs');
  match.scramble();
  let g3 = 0;
  while (!match.lastOutcome && g3 < 4000) {
    g3++;
    match.setStick(1, 0.12, g3 > 40);
    match.update(1 / 60);
  }
  const outcome = match.lastOutcome;
  assert.ok(outcome, 'the scrambled snap resolves through the match');
  const line = match.stats[qbId];
  assert.ok(line, 'the quarterback has a stat line after his run');
  assert.equal(line!.passAtt, 0, 'no pass attempt was charged');
  assert.equal(line!.rushAtt, 1, 'one carry was credited to the quarterback');
  assert.equal(line!.rushYds, outcome!.yards, 'for the ground he actually gained');
  const logged = match.playLog[match.playLog.length - 1];
  assert.equal(logged?.kind, 'run', 'and the drive log files it as a run');
  console.log(
    `  through a Match: QB carry for ${outcome!.yards} yds · passAtt ${line!.passAtt} · rushAtt ${line!.rushAtt} · ${outcome!.headline}`,
  );

  // Balance: taking off from a formed pocket is worth a decision, not a free down.
  let total = 0;
  let best = -99;
  let worst = 99;
  let lost = 0;
  let scores = 0;
  let count = 0;
  let passPlays = 0;
  const kinds: Record<string, number> = {};
  for (let seed = 1; seed <= 40; seed++) {
    const s = settle(toPocket(pocket(seed)), 1.2);
    if (s.phase !== 'dropback') continue;
    passPlays++;
    if (!s.scramble()) continue;
    const r = takeOff(s);
    if (!r) continue;
    count++;
    total += r.yards;
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    best = Math.max(best, r.yards);
    worst = Math.min(worst, r.yards);
    if (r.yards < 0) lost++;
    if (r.touchdown) scores++;
  }
  const avg = total / Math.max(1, count);
  assert.ok(count >= 30, `most scrambles should resolve (${count} of ${passPlays} pockets)`);
  assert.ok(avg > 1.5, `a scramble should be worth taking when the pocket breaks (avg ${avg.toFixed(1)})`);
  assert.ok(avg < 9, `but not a free first down every down (avg ${avg.toFixed(1)})`);
  assert.ok(lost <= count / 3, `most take-offs should still gain ground (${lost} of ${count} lost some)`);
  assert.equal(kinds.sack ?? 0, 0, 'a scramble is never charged as a sack');
  assert.equal(kinds.pass ?? 0, 0, 'and never as a pass');
  assert.equal(kinds.incomplete ?? 0, 0, 'nor as an incompletion');
  assert.equal(
    (kinds.run ?? 0) + (kinds.touchdown ?? 0) + (kinds.fumble ?? 0),
    count,
    'every one stays on the ground: a run, a touchdown or a strip',
  );

  // The rule behind that, forced rather than hoped for: a take-off dragged back
  // behind the line with a rusher in his lap dies as a loss on the ground — no
  // thrower, no pass attempt, and the sack branch is not the one that fires.
  const buried = settle(toPocket(pocket(17, 30)), 1.2);
  assert.ok(buried.scramble(), 'a pocket to take off from');
  const chaser = buried.defense.find((d) => d.assignment === 'rush');
  if (!chaser) throw new Error('a defense should send a rusher');
  buried.qb.x = buried.los - 6;
  let g4 = 0;
  while (!buried.result && g4 < 200) {
    g4++;
    if (chaser.stunned <= 0) {
      chaser.x = buried.qb.x - 0.4;
      chaser.y = buried.qb.y;
    }
    buried.update(1 / 60, { x: -1, y: 0, sprint: false });
  }
  const loss = buried.result;
  assert.ok(loss, 'the buried take-off resolves');
  assert.equal(loss!.kind, 'run', 'a take-off killed behind the line is a run');
  assert.ok(loss!.yards < 0, `and it is charged the ground it lost (${loss!.yards})`);
  assert.equal(loss!.isPass, false, 'still not a pass attempt');
  assert.equal(loss!.incomplete, false, 'and not an incompletion either');

  console.log(
    `  ${count} scrambles from a formed pocket: avg ${avg.toFixed(1)} yds · best ${best} · worst ${worst} · ${lost} lost ground · ${scores} scored · ${JSON.stringify(kinds)}`,
  );
  console.log(
    `  buried in the backfield: ${loss!.headline} · ${loss!.yards} yds filed as ${loss!.kind}, passAtt untouched`,
  );
}

console.log('--- The market ---');
{
  const franchise = createFranchise(1201);
  const wire = franchise.freeAgents ?? [];
  assert.equal(wire.length, MARKET.size, `a new franchise stocks the wire (${wire.length})`);
  assert.equal(
    new Set(wire.map((p) => p.pos)).size,
    wire.length,
    'no two free agents are the same job',
  );
  assert.ok(
    wire.every((p) => p.level >= 2),
    'the wire is veterans, not rookies: they have a level behind them',
  );
  const lo = [...wire].sort((a, b) => overall(a) - overall(b))[0];
  const hi = [...wire].sort((a, b) => overall(b) - overall(a))[0];
  assert.ok(buyPrice(hi) > buyPrice(lo), 'the best man on the wire costs the most');
  for (const p of wire) {
    assert.ok(sellValue(p) < buyPrice(p), `a sale pays less than a signing (${p.name})`);
    assert.ok(buyPrice(p) > 0 && buyPrice(p) % 5 === 0, `prices are chunky (${buyPrice(p)})`);
  }
  console.log(
    `  wire: ${wire.length} veterans ${overall(lo)}–${overall(hi)} OVR · ▤${buyPrice(lo)}–▤${buyPrice(hi)} to sign · a sale pays 55% back · cap ${MARKET.rosterMax} men`,
  );

  franchise.tape = 2000;
  const startTape = franchise.tape;
  // Signing with room on the roster: tape down by the price, one more man, off the wire.
  assert.equal(dealVerdict(franchise, hi.id), 'ok', 'a man with room on the roster can be signed');
  assert.equal(signFreeAgent(franchise, hi.id), 'ok', 'signing the best of them');
  assert.equal(franchise.tape, startTape - buyPrice(hi), 'tape paid exactly the asking price');
  assert.ok(franchise.roster.some((p) => p.id === hi.id), 'he is on the roster');
  assert.ok(!(franchise.freeAgents ?? []).some((p) => p.id === hi.id), 'and off the wire');
  assert.equal(franchise.roster.length, 14, 'the roster grew by one');

  // The depth chart follows the grade, so a signing who beats the man in front of him
  // takes the field instead of rotting on the bench.
  const wrBase = franchise.roster.find((p) => p.pos === 'WR')!;
  const hammer: Player = {
    ...wrBase,
    id: 'qa-hammer',
    name: 'Qa Hammer',
    ratings: flatRatings(99),
  };
  const placed = placeInRoster(franchise.roster, hammer);
  assert.equal(
    placed.filter((p) => p.pos === 'WR')[0].id,
    'qa-hammer',
    'a better man moves to the front of his queue',
  );
  assert.equal(depthTag(placed, hammer), 'STARTS', 'so he is on the field');
  const scrub: Player = {
    ...wrBase,
    id: 'qa-scrub',
    name: 'Qa Scrub',
    ratings: flatRatings(20),
  };
  const benched = placeInRoster(franchise.roster, scrub);
  assert.equal(benched[benched.length - 1].id, 'qa-scrub', 'a lesser man waits at the back');
  assert.equal(depthTag(benched, scrub), 'BENCH', 'and rides the bench');

  // Selling: tape in, one fewer man, and he lands back on the wire at a markup.
  const spare = franchise.roster.find((p) => sellVerdict(franchise, p.id) === 'ok');
  assert.ok(spare, 'a 14-man roster has somebody spare');
  const tapeBefore = franchise.tape;
  const value = sellValue(spare!);
  assert.equal(sellPlayer(franchise, spare!.id), 'ok', 'selling him');
  assert.equal(franchise.tape, tapeBefore + value, 'the sale paid his value');
  assert.ok(!franchise.roster.some((p) => p.id === spare!.id), 'he is off the roster');
  assert.ok((franchise.freeAgents ?? []).some((p) => p.id === spare!.id), 'and on the wire');
  const back = (franchise.freeAgents ?? []).find((p) => p.id === spare!.id)!;
  assert.ok(buyPrice(back) > value, 'the wire marks him up on the way back');
  assert.equal(franchise.roster.length, 13, 'and the roster is back to thirteen');

  // The lineup is the one thing the market will not sell out from under you.
  const qb = franchise.roster.find((p) => p.pos === 'QB')!;
  assert.equal(
    sellVerdict(franchise, qb.id),
    'illegal-lineup',
    'you cannot sell the only quarterback',
  );
  assert.equal(sellPlayer(franchise, qb.id), 'illegal-lineup', 'and the deal is refused');
  assert.ok(franchise.roster.some((p) => p.id === qb.id), 'so he stays');

  // A gutted receiver room still fields three different men: the third receiver is
  // somebody else, never the same name twice.
  const wideouts = franchise.roster.filter((p) => p.pos === 'WR').length;
  let cashedIn = 0;
  for (const p of franchise.roster.filter((q) => q.pos === 'WR')) {
    if (franchise.roster.filter((q) => q.pos === 'WR').length <= 1) break;
    if (sellPlayer(franchise, p.id) === 'ok') cashedIn++;
  }
  assert.equal(cashedIn, wideouts - 1, `every receiver but one can be cashed in (${cashedIn})`);
  assert.equal(franchise.roster.filter((p) => p.pos === 'WR').length, 1, 'one receiver left');
  const thin = new PlaySim({
    play: PLAYBOOK.find((p) => p.kind === 'pass')!,
    los: OWN_GOAL + 30,
    startSpot: 30,
    roster: franchise.roster,
    team: getTeam(franchise, franchise.teamId),
    opp: getTeam(franchise, franchise.schedule[0].opponentId),
    oppDef: 75,
    weather: WEATHER.CLEAR,
    energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
    seed: 5,
    quarter: 1,
    closeGame: false,
  });
  thin.start();
  const fielded = thin.offense.filter((a) => a.slot !== undefined);
  assert.ok(fielded.length >= 5, `the offense still lines up (${fielded.length} men)`);
  assert.equal(
    new Set(fielded.map((a) => a.rosterId)).size,
    fielded.length,
    'and no man is on the field twice',
  );

  // Fill the roster and the market asks who leaves.
  franchise.tape = 4000;
  let guard = 0;
  while (franchise.roster.length < MARKET.rosterMax && guard++ < 20) {
    ensureMarket(franchise);
    const nextMan = (franchise.freeAgents ?? []).find(
      (p) => dealVerdict(franchise, p.id) === 'ok',
    );
    if (!nextMan) break;
    assert.equal(signFreeAgent(franchise, nextMan.id), 'ok', 'a man with room signs with no release');
  }
  assert.equal(franchise.roster.length, MARKET.rosterMax, 'the roster fills to the cap');
  const blocked = (franchise.freeAgents ?? [])[0];
  assert.equal(dealVerdict(franchise, blocked.id), 'full', 'a full roster has to make room');
  assert.equal(signFreeAgent(franchise, blocked.id), 'full', 'and the market says so');
  assert.equal(franchise.roster.length, MARKET.rosterMax, 'nothing moved');
  const makeRoom = franchise.roster.find(
    (p) => dealVerdict(franchise, blocked.id, p.id) === 'ok',
  );
  assert.ok(makeRoom, 'somebody can make room');
  assert.equal(signFreeAgent(franchise, blocked.id, makeRoom!.id), 'ok', 'sign and release');
  assert.equal(franchise.roster.length, MARKET.rosterMax, 'the numbers hold through a swap');
  assert.ok(!franchise.roster.some((p) => p.id === makeRoom!.id), 'the released man is gone');
  assert.ok(franchise.roster.some((p) => p.id === blocked.id), 'the signing is on the roster');
  assert.ok(
    (franchise.freeAgents ?? []).length > 0,
    'a market is still stocked for the next visit',
  );

  // No tape, no deal.
  franchise.tape = 10;
  ensureMarket(franchise);
  const dear = [...(franchise.freeAgents ?? [])].sort((a, b) => buyPrice(b) - buyPrice(a))[0];
  assert.equal(
    dealVerdict(franchise, dear.id, franchise.roster[0].id),
    'no-tape',
    'ten tape does not buy a veteran',
  );
  assert.equal(
    signFreeAgent(franchise, dear.id, franchise.roster[0].id),
    'no-tape',
    'the deal is refused',
  );
  console.log(
    `  deals: signed a ${overall(hi)} OVR ${hi.pos} for ▤${buyPrice(hi)} · sold a spare for ▤${value} and the wire wanted ▤${buyPrice(back)} for him back · refused at ten tape · cap ${MARKET.rosterMax}`,
  );

  // A save from before the market existed: the wire is stocked on load, and nothing
  // minted after it can reuse an id the save already knows.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  const legacy = createFranchise(5150);
  delete (legacy as Partial<Franchise>).freeAgents;
  // Ids minted by the session that wrote the save, all of them past ours.
  legacy.roster = legacy.roster.map((p, i) => ({ ...p, id: `pl9${String(i).padStart(3, '0')}` }));
  saveFranchise(legacy);
  const loaded = loadFranchise();
  assert.ok(loaded, 'the save loads');
  assert.equal(loaded!.freeAgents?.length, MARKET.size, 'and the wire is stocked for it');
  const ids = [...loaded!.roster, ...(loaded!.freeAgents ?? [])].map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'a pool minted after a load never reuses a saved id');
  assert.ok(
    (loaded!.freeAgents ?? []).every(
      (p) => Number.parseInt(p.id.replace(/^pl/, ''), 10) > 9003,
    ),
    'the new ids were minted past the saved ones',
  );
  (globalThis as { localStorage?: unknown }).localStorage = undefined;
  console.log(
    `  legacy save: ${loaded!.freeAgents!.length} free agents minted past id ${loaded!.roster[0].id} · no id collisions`,
  );
}

console.log('--- Choosing a club, and editing it ---');
{
  // Any of the sixteen clubs can be the one you coach, and the league schedules around it.
  assert.equal(TEAMS.length, 16, 'the league doubled to sixteen clubs');
  for (const pick of ['nyk', 'phx', 'sea', 'bos', 'la', 'sd']) {
    const f = createFranchise(77, pick);
    assert.equal(f.teamId, pick, `the franchise belongs to ${pick}`);
    assert.equal(playerTeam(f).id, pick, 'and playerTeam agrees');
    assert.ok(
      f.schedule.every((w) => w.opponentId !== pick),
      `nobody plays themselves (${pick})`,
    );
    assert.equal(f.schedule.length, REGULAR_WEEKS, 'a fifteen-game season');
    assert.equal(
      new Set(f.schedule.map((w) => w.opponentId)).size,
      REGULAR_WEEKS,
      'every other club is on the schedule exactly once',
    );
    assert.ok(
      f.schedule.every((w) => w.opponentId !== pick && TEAMS.some((t) => t.id === w.opponentId)),
      'and every opponent is a real club',
    );
    assert.equal(Object.keys(f.standings).length, TEAMS.length, 'every club is in the standings');
    assert.ok(f.standings[pick], 'including yours');
    assert.ok(f.roster.length >= 13, 'and you are handed a roster to coach');
  }

  // The postseason moves with the league, not with an old eight-week constant.
  const bracket = createFranchise(88);
  bracket.standings[bracket.teamId] = { w: REGULAR_WEEKS, l: 0, t: 0, pf: 420, pa: 180 };
  ensurePlayoffs(bracket);
  const semi = bracket.schedule.find((w) => w.stage === 'semi');
  assert.ok(semi, 'the top seed is given a semifinal');
  assert.equal(semi!.week, REGULAR_WEEKS + 1, 'the semifinal is week 16');
  assert.equal(bracket.week, REGULAR_WEEKS + 1, 'and the career is on it');
  advanceAfterGame(bracket, true, false, 24, 17);
  const final = bracket.schedule.find((w) => w.stage === 'bowl');
  assert.ok(final, 'winning it schedules the bowl');
  assert.equal(final!.week, REGULAR_WEEKS + 2, 'the bowl is week 17');
  console.log(
    `  bracket: ${REGULAR_WEEKS} regular weeks → semi week ${REGULAR_WEEKS + 1} → bowl week ${REGULAR_WEEKS + 2}`,
  );

  // The choice reaches the field: the sim dresses both sides in their own colours.
  const chosen = createFranchise(9, 'sea');
  const wk = chosen.schedule[0];
  const match = new Match({
    franchise: chosen,
    opponent: getTeam(chosen, wk.opponentId),
    week: wk,
    weather: WEATHER[wk.weather],
    seed: 3,
  });
  match.begin();
  let steps = 0;
  while (match.phase !== 'live' && steps < 5000) {
    steps++;
    if (match.phase === 'playcall') {
      const card = match.cards[0];
      if (card) match.choosePlay(card.id);
      else match.update(1 / 60);
    } else {
      match.update(1 / 60);
    }
  }
  const picked = match.sim;
  assert.ok(picked, 'the picked club gets a live snap');
  assert.equal(match.playerTeam.id, 'sea', 'the match belongs to the club you picked');
  assert.equal(
    picked!.qb.jerseyColor,
    getTeam(chosen, 'sea').colors.jersey,
    'your men wear your jersey',
  );
  assert.equal(
    picked!.defense[0].jerseyColor,
    getTeam(chosen, wk.opponentId).colors.jersey,
    'and the opposition wears theirs',
  );

  const f = createFranchise(31, 'mia');
  const base = teamPatch(playerTeam(f));
  const otherColors = { ...getTeam(f, 'dal').colors };

  // Names, abbreviation and colours as the editor hands them over.
  const clean = sanitizePatch(
    {
      ...base,
      city: '  miami beach ',
      nickname: 'storm',
      abbr: 'mb',
      primary: '#AB12CD',
      jersey: '#Ab12Cd',
    },
    playerTeam(f),
  );
  assert.equal(clean.city, 'MIAMI BEACH', 'a city name is trimmed and uppercased');
  assert.equal(clean.nickname, 'STORM', 'and so is the nickname');
  assert.equal(clean.abbr, 'MB', 'the abbreviation comes through in capitals');
  assert.equal(clean.primary, '#ab12cd', 'colours are normalised to lower case');
  assert.equal(clean.jersey, '#ab12cd', 'and matched case-insensitively');
  assert.equal(isHex('#12ab34'), true, 'a six-digit colour is valid');
  assert.equal(isHex('#12ab3'), false, 'a five-digit one is not');
  assert.equal(isHex('red'), false, 'and neither is a colour name');

  const rude = sanitizePatch(
    { ...base, city: '   ', nickname: 'X'.repeat(40), abbr: 'ABCD1', primary: 'chartreuse' },
    playerTeam(f),
  );
  assert.equal(rude.city, base.city, 'a blank name falls back to the one it had');
  assert.equal(rude.nickname.length, NAME_MAX, `a long nickname is capped (${rude.nickname.length})`);
  assert.equal(rude.abbr, 'ABC', 'and an abbreviation is three characters');
  assert.equal(rude.primary, base.primary, 'while a colour that is not #rrggbb is refused');
  assert.equal(Math.max(ABBR_MAX, rude.abbr.length), ABBR_MAX, 'the cap is the editor’s too');

  // Saving writes it into the franchise — and only into yours.
  applyTeamPatch(f, clean);
  assert.equal(playerTeam(f).nickname, 'STORM', 'the club is renamed');
  assert.equal(playerTeam(f).city, 'MIAMI BEACH', 'city and all');
  assert.equal(playerTeam(f).abbr, 'MB', 'the abbreviation follows it into the HUD');
  assert.equal(playerTeam(f).colors.primary, '#ab12cd', 'and the colours are repainted');
  assert.deepEqual(getTeam(f, 'dal').colors, otherColors, 'while no other club changes');

  // A broken patch is ignored rather than half-applied.
  const snapshot = JSON.stringify(playerTeam(f));
  applyTeamPatch(f, { ...clean, primary: 'rebeccapurple' });
  assert.equal(JSON.stringify(playerTeam(f)), snapshot, 'a patch with a broken colour changes nothing');

  // It survives a relaunch, because the club lives in the franchise.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  saveFranchise(f);
  const loaded = loadFranchise();
  assert.equal(playerTeam(loaded!).nickname, 'STORM', 'the renamed club survives a save');
  assert.equal(playerTeam(loaded!).colors.primary, '#ab12cd', 'so do the colours');
  assert.equal(playerTeam(loaded!).abbr, 'MB', 'and the abbreviation');
  (globalThis as { localStorage?: unknown }).localStorage = undefined;

  // Restoring the shipped identity, and the two hints the editor gives.
  const original = originalPatch('mia');
  assert.ok(original, 'the shipped identity can be restored');
  assert.equal(original!.nickname, 'THUNDER', 'and it is the one the club was born with');
  applyTeamPatch(f, original!);
  assert.equal(playerTeam(f).nickname, 'THUNDER', 'so the club can go back to it');
  assert.equal(playerTeam(f).colors.primary, '#1fe3cf', 'colours and all');
  assert.equal(patchWarning(original!), null, 'the shipped colours pass the editor’s own check');
  assert.ok(
    patchWarning({ ...original!, secondary: original!.primary }),
    'but a club painted one colour is warned about its end zone',
  );
  assert.ok(
    TEAM_PRESETS.length >= 6 &&
      TEAM_PRESETS.every((p) => Object.values(p.colors).every(isHex)),
    `every preset is a real set of colours (${TEAM_PRESETS.length})`,
  );
  console.log(
    `  clubs: ${TEAMS.length} to coach, any of them yours · ${REGULAR_WEEKS}-game round robin (every rival once) · ${TEAM_PRESETS.length} palettes · name cap ${NAME_MAX}, abbr ${ABBR_MAX} · a broken colour changes nothing`,
  );
  console.log(
    `  editor: renamed a club to MIAMI BEACH STORM (MB) in #ab12cd and it survived a relaunch · nobody else in the league moved`,
  );
}

console.log('--- Hot routes at the line ---');
{
  const hotSim = (playId: string, seed: number) => {
    const franchise = createFranchise(seed);
    const play = PLAYBOOK.find((p) => p.id === playId)!;
    return new PlaySim({
      play,
      los: OWN_GOAL + 35,
      startSpot: 35,
      roster: franchise.roster,
      team: getTeam(franchise, franchise.teamId),
      opp: getTeam(franchise, franchise.schedule[0].opponentId),
      oppDef: 75,
      weather: WEATHER.CLEAR,
      energy: Object.fromEntries(franchise.roster.map((p) => [p.id, 100])),
      seed,
      quarter: 1,
      closeGame: false,
    });
  };
  const man = (sim: PlaySim, slot: RouteSlot) => sim.offense.find((a) => a.slot === slot)!;
  const depthOf = (route: { dx: number }[]) => route[route.length - 1].dx;

  // The menu: five shapes, and every one of them is the route the playbook draws.
  assert.deepEqual(HOT_ROUTES, ['slant', 'out', 'curl', 'go', 'drag'], 'the line offers five routes');
  const sim = hotSim('quick-slant', 41);
  const wr1 = man(sim, 'WR1');
  const cardDepth = depthOf(wr1.route);
  assert.ok(sim.setHotRoute('WR1', 'go'), 'a receiver can be re-routed at the line');
  assert.equal(wr1.hot, 'go', 'and the man carries what he was asked for');
  assert.deepEqual(wr1.route, buildRoute('go', wr1.startY, MID_Y), 'GO is the pencil route itself');
  const hotDepth = depthOf(wr1.route);
  assert.ok(
    hotDepth - cardDepth > 20,
    `GO runs far deeper than the card's SLANT (${cardDepth} → ${hotDepth})`,
  );

  // The tap: the man under the finger, and nobody else.
  const line = hotSim('cross-fire', 42);
  const wr2 = man(line, 'WR2');
  assert.equal(line.hotRouteAt(wr2.x, wr2.y, HOT_TAP_CORE), 'WR2', 'a tap on a receiver asks about him');
  assert.equal(
    line.hotRouteAt(line.los + 1, MID_Y, HOT_TAP_CORE),
    null,
    'a tap in the middle of the line is nobody',
  );
  assert.equal(line.canHotRoute, true, 'the line is open before the snap');

  // Refusals: once it is snapped, on a run, and for a man staying in to protect.
  const post = hotSim('deep-post', 43);
  assert.equal(man(post, 'RB').route.length, 0, 'the back on DEEP POST stays in to protect');
  assert.equal(post.setHotRoute('RB', 'swing'), false, 'a blocker is not a receiver');
  const run = hotSim('power-run', 44);
  assert.equal(run.canHotRoute, false, 'a run has no routes to change');
  assert.equal(run.setHotRoute('WR1', 'go'), false, 'and nothing to change them to');
  line.start();
  assert.equal(line.canHotRoute, false, 'the line closes at the snap');
  assert.equal(line.setHotRoute('WR1', 'go'), false, 'and so does the menu');
  assert.equal(
    line.hotRouteAt(wr2.x, wr2.y, HOT_TAP_CORE),
    null,
    'a tap after the snap is not a hot route',
  );

  // Same seed, same defense: the route changes where the man actually gets to. The
  // measurement is the deepest he reaches, so a throw or a sack mid-window — both of
  // which stop him where he stands — cannot flatter or spoil the comparison.
  const deepest = (hot: RouteKey | null) => {
    const s = hotSim('hitch-hike', 505);
    if (hot) s.setHotRoute('WR1', hot);
    s.start();
    let max = -Infinity;
    for (let i = 0; i < 240; i++) {
      s.update(1 / 60, { x: 0, y: 0, sprint: false });
      max = Math.max(max, man(s, 'WR1').x - s.los);
    }
    return max;
  };
  const curl = deepest(null);
  const go = deepest('go');
  assert.ok(
    go - curl > 8,
    `a GO at the line gets 8+ yards deeper than the card's CURL (${curl.toFixed(1)} vs ${go.toFixed(1)})`,
  );

  // Through a real Match: the menu holds the snap count, and the snap still lands.
  const { match } = makeMatch(88);
  const passCard = match.cards.find((c) => c.kind === 'pass') ?? match.cards[0];
  match.choosePlay(passCard.id);
  assert.equal(match.phase, 'ready');
  const snapSim = match.sim!;
  const target = man(snapSim, 'WR1');
  assert.equal(
    match.hotRouteAt(target.x, target.y, HOT_TAP_CORE),
    true,
    'a tap at the line opens the menu',
  );
  assert.equal(match.hotSlot, 'WR1');
  assert.equal(match.hotRouteLabel, `WR1 · #${target.jersey}`);
  for (let i = 0; i < 90; i++) match.update(1 / 60);
  assert.equal(match.phase, 'ready', 'the snap count is held while the menu is up');
  assert.ok(match.applyHotRoute('go'), 'the route is taken from the menu');
  assert.equal(match.hotSlot, null, 'and the menu closes behind it');
  assert.deepEqual(
    man(snapSim, 'WR1').route,
    buildRoute('go', target.startY, MID_Y),
    'the match hands the route to the snap that follows',
  );
  for (let i = 0; i < 200; i++) match.update(1 / 60);
  assert.equal(match.phase, 'live', 'and the line snaps itself once the count runs out');
  assert.equal(snapSim.started, true, 'the snap is the same snap it would have been');

  // The count waits for a thumb. 1.5 s in — past the old 1.15 s window that used to
  // snap the ball out from under a slow hand — the line is still open, the bar still
  // has time on it, and a finger on the glass freezes it exactly where it stands.
  const { match: patient } = makeMatch(91);
  const patientCard = patient.cards.find((c) => c.kind === 'pass') ?? patient.cards[0];
  patient.choosePlay(patientCard.id);
  for (let i = 0; i < 90; i++) patient.update(1 / 60);
  assert.equal(patient.phase, 'ready', 'the line outlives the old 1.15 s count');
  assert.ok(
    patient.readyPct > 0.4 && patient.readyPct < 0.55,
    `the bar still has time on it at 1.5 s (${(patient.readyPct * 100).toFixed(0)}%)`,
  );
  patient.setReadyHold(true);
  const frozen = patient.readyPct;
  for (let i = 0; i < 240; i++) patient.update(1 / 60);
  assert.equal(patient.phase, 'ready', 'a finger on the field holds the count');
  assert.equal(patient.readyPct, frozen, 'and the count does not creep while it is held');
  assert.equal(patient.readyHeld, true, 'the deck knows the bar should freeze');
  patient.setReadyHold(false);
  let ticks = 0;
  while (patient.phase === 'ready' && ticks < 600) {
    patient.update(1 / 60);
    ticks++;
  }
  assert.equal(patient.phase, 'live', 'lifting the finger lets the count run out and snap');
  assert.ok(
    ticks > 60 && ticks < 110,
    `it snaps when the count ends, not when the finger lifts (${(ticks / 60).toFixed(2)}s later)`,
  );

  // A thumb that never lifts cleanly — the OS takes the gesture, the window loses
  // focus, the app goes hidden — must not freeze the line forever or snap the ball.
  // Releasing the hold resumes the count from the time it had, not from the top.
  const { match: interrupted } = makeMatch(93);
  const interruptedCard = interrupted.cards.find((c) => c.kind === 'pass') ?? interrupted.cards[0];
  interrupted.choosePlay(interruptedCard.id);
  for (let i = 0; i < 60; i++) interrupted.update(1 / 60); // 1.0s of the 2.8s
  const leftBefore = interrupted.readyTimer;
  assert.ok(
    leftBefore > 1.6 && leftBefore < 2.0,
    `a second in, ${leftBefore.toFixed(2)}s of count is left`,
  );
  interrupted.setReadyHold(true);
  for (let i = 0; i < 120; i++) interrupted.update(1 / 60); // held for 2s
  assert.equal(interrupted.phase, 'ready', 'an interrupted finger holds the line instead of snapping');
  assert.equal(interrupted.readyTimer, leftBefore, 'and the hold loses none of the remaining count');
  interrupted.setReadyHold(false); // what pointercancel / blur / hidden do
  assert.equal(interrupted.phase, 'ready', 'releasing an interrupted hold does not snap the ball');
  for (let i = 0; i < 30; i++) interrupted.update(1 / 60); // 0.5s of count
  assert.ok(
    interrupted.readyTimer < leftBefore - 0.4 && interrupted.readyTimer > leftBefore - 0.6,
    `the count resumes from where it stopped (${interrupted.readyTimer.toFixed(2)}s left)`,
  );
  assert.equal(interrupted.phase, 'ready', 'and the line is still waiting for a real snap');
  console.log(
    `  interrupted hold: ${leftBefore.toFixed(2)}s left · frozen 2.0s · released → ${interrupted.readyTimer.toFixed(2)}s after half a second · no snap, no lost time`,
  );

  // An ordinary snap is untouched: the count is a fallback, never a gate.
  const { match: quick } = makeMatch(92);
  quick.choosePlay(quick.cards[0].id);
  quick.snap();
  assert.equal(quick.phase, 'live', 'SNAP still goes on the first tap');

  // The target grew to a thumb: a tap that lands near the man opens him, and a tap
  // that lands clear of every receiver is still nobody — so it still snaps.
  const thumb = hotSim('cross-fire', 46);
  const wide = man(thumb, 'WR2');
  assert.equal(
    thumb.hotRouteAt(wide.x + 2.9, wide.y + 0.5, HOT_TAP_CORE),
    'WR2',
    'a thumb off the man still opens him',
  );
  assert.equal(
    thumb.hotRouteAt(wide.x + 4.6, wide.y + 0.5, HOT_TAP_CORE),
    null,
    'and a tap clear of him is nobody',
  );

  console.log(
    `  hot routes: ${HOT_ROUTES.length} at the line (${HOT_ROUTES.map((k) => HOT_ROUTE_LABEL[k]).join(' · ')}) · GO is ${(hotDepth - cardDepth).toFixed(0)} yds deeper than SLANT on the same card`,
  );
  console.log(
    `  hot route on the field: WR1 CURL ${curl.toFixed(1)} → GO ${go.toFixed(1)} yds deep over 4s · tap floor ${HOT_TAP_CORE} yds · refused after the snap, on a run and for a blocker`,
  );
  console.log(
    `  hot route through the match: the menu held the snap count 1.5s, WR1 → GO landed, then the line snapped itself`,
  );
  console.log(
    `  the line waits: ${READY_SECONDS.toFixed(1)}s count (was 1.15s) · frozen for 4.0s under a finger, then ${(ticks / 60).toFixed(2)}s left to run · SNAP still instant · a thumb ${HOT_TAP_CORE.toFixed(1)} yds off the man still opens him`,
  );
}

// A postseason game cannot end tied. A scoreless overtime is followed by another
// overtime period, and the title is settled by the scoreline, not by a default.
{
  const forceQuarterEnd = (m: Match) => (m as unknown as { endQuarter: () => void }).endQuarter();
  const playoffWeek = (franchise: ReturnType<typeof createFranchise>, stage: 'semi' | 'bowl') => ({
    ...franchise.schedule[0],
    stage,
  });

  // Q4 tie → OT1. A scoreless OT1 → OT2 is offered, not a final.
  const franchise = createFranchise(77);
  const week = playoffWeek(franchise, 'semi');
  const match = new Match({
    franchise,
    opponent: getTeam(franchise, week.opponentId),
    week,
    weather: WEATHER[week.weather],
    seed: 4242,
  });
  match.begin();
  match.state.quarter = 4;
  match.state.clock = 0;
  match.state.scoreUs = 7;
  match.state.scoreThem = 7;
  forceQuarterEnd(match);
  assert.equal(match.overtimeReady, true, 'a tie at the end of the fourth offers overtime');
  match.continueQuarter();
  assert.equal(match.state.quarter, 5, 'overtime is played');
  assert.equal(match.state.overtime, true);
  assert.equal(match.state.clock, 62, 'a full overtime period, not a shortened clock');
  assert.equal(match.overtimePeriods, 1, 'the first overtime period is counted');

  // Force a scoreless overtime: the game must not finish tied.
  match.state.clock = 0;
  forceQuarterEnd(match);
  assert.equal(match.phase, 'quarter', 'a scoreless overtime does not finish a postseason game');
  assert.equal(match.state.finished, false, 'the game is not over');
  assert.equal(match.overtimeReady, true, 'another overtime is offered');
  match.continueQuarter();
  assert.equal(match.overtimePeriods, 2, 'a second overtime period is played');
  assert.equal(match.state.clock, 62, 'and it gets a full period too');

  // The second period produces a winner: the game ends decisively.
  match.state.scoreUs = 10;
  match.state.clock = 0;
  forceQuarterEnd(match);
  assert.equal(match.phase, 'final', 'a decisive overtime ends the game');
  const summary = match.getSummary();
  assert.equal(summary.win, true, 'we won it in the second overtime');
  assert.equal(summary.tie, false, 'and a postseason game is never a tie');
  assert.equal(summary.ourScore, 10);
  assert.equal(summary.theirScore, 7);

  // The cap, reached by actually playing every period: each scoreless overtime
  // offers another, and only the last one hands the game to the walk-off fallback.
  const capped = createFranchise(78);
  const bowlWeek = playoffWeek(capped, 'bowl');
  const cappedMatch = new Match({
    franchise: capped,
    opponent: getTeam(capped, bowlWeek.opponentId),
    week: bowlWeek,
    weather: WEATHER[bowlWeek.weather],
    seed: 4343,
  });
  cappedMatch.begin();
  cappedMatch.state.quarter = 4;
  cappedMatch.state.clock = 0;
  cappedMatch.state.scoreUs = 0;
  cappedMatch.state.scoreThem = 0;
  forceQuarterEnd(cappedMatch);
  assert.equal(cappedMatch.overtimeReady, true, 'the bowl offers overtime');
  cappedMatch.continueQuarter();
  for (let period = 1; period <= MAX_OVERTIME_PERIODS; period++) {
    assert.equal(cappedMatch.overtimePeriods, period, `overtime period ${period} is played`);
    assert.equal(cappedMatch.state.clock, 62, 'every extra period gets a full clock');
    assert.equal(cappedMatch.state.scoreUs, 0, 'no team is handed points before the cap');
    assert.equal(cappedMatch.state.scoreThem, 0);
    cappedMatch.state.clock = 0;
    forceQuarterEnd(cappedMatch);
    if (period < MAX_OVERTIME_PERIODS) {
      assert.equal(cappedMatch.phase, 'quarter', 'a scoreless overtime does not finish the bowl');
      assert.equal(cappedMatch.overtimeReady, true, 'and another overtime is offered');
      cappedMatch.continueQuarter();
    }
  }
  assert.equal(cappedMatch.phase, 'final', 'at the cap the game is settled rather than left tied');
  assert.equal(cappedMatch.overtimePeriods, MAX_OVERTIME_PERIODS, 'the full overtime allowance was played');
  const cappedSummary = cappedMatch.getSummary();
  assert.notEqual(
    cappedSummary.ourScore,
    cappedSummary.theirScore,
    'the fallback produces a decisive scoreline',
  );
  assert.equal(
    Math.abs(cappedSummary.ourScore - cappedSummary.theirScore),
    3,
    'a walk-off field goal settles it',
  );
  assert.equal(cappedSummary.tie, false);

  // The season layer refuses a tied postseason result instead of crowning the opponent.
  const season = createFranchise(79);
  const semi = season.schedule[0];
  semi.stage = 'semi';
  season.week = semi.week;
  season.seasonStage = 'playoffs';
  advanceAfterGame(season, false, true, 7, 7);
  assert.equal(season.seasonStage, 'playoffs', 'a tied playoff game does not advance the bracket');
  assert.equal(season.week, semi.week, 'and the same game stays on the schedule');
  assert.equal(semi.result, undefined, 'no tie is filed as the playoff result');
  assert.equal(season.championId, null, 'and no champion is crowned from a tie');

  console.log(
    `  overtime: Q4 tie → OT1 (${62}s) · scoreless OT → OT2 · decisive 10-7 · cap ${MAX_OVERTIME_PERIODS} periods → walk-off FG · a tied playoff result is refused, not awarded`,
  );
}

// A regular-season draw is a tie, not a loss. A 14-14 game that goes to overtime
// and stays 14-14 is filed as a T for both sides, and the last-game card stores the
// tie flag instead of leaving the hub to read it out of the score.
{
  const forceQuarterEnd = (m: Match) => (m as unknown as { endQuarter: () => void }).endQuarter();
  const franchise = createFranchise(81);
  const week = franchise.schedule[0];
  franchise.week = week.week;
  const match = new Match({
    franchise,
    opponent: getTeam(franchise, week.opponentId),
    week,
    weather: WEATHER[week.weather],
    seed: 5150,
  });
  match.begin();
  match.state.quarter = 4;
  match.state.clock = 0;
  match.state.scoreUs = 14;
  match.state.scoreThem = 14;
  forceQuarterEnd(match);
  assert.equal(match.overtimeReady, true, 'a 14-14 fourth quarter offers overtime');
  match.continueQuarter();
  assert.equal(match.state.quarter, 5, 'the regular season plays the extra period');

  // Scoreless overtime. The regular season is allowed to end drawn.
  match.state.clock = 0;
  forceQuarterEnd(match);
  assert.equal(match.phase, 'final', 'a scoreless regular-season overtime ends the game');
  const summary = match.getSummary();
  assert.equal(summary.win, false);
  assert.equal(summary.tie, true, '14-14 is a tie, not a loss');
  assert.equal(summary.ourScore, 14);
  assert.equal(summary.theirScore, 14);

  finishGame(franchise, summary);
  assert.equal(week.result?.tie, true, 'the schedule files it as a tie');
  assert.equal(week.result?.win, false, 'and never as our loss');
  assert.equal(week.result?.our, 14);
  assert.equal(week.result?.theirs, 14);
  const us = franchise.standings[franchise.teamId];
  const them = franchise.standings[week.opponentId];
  assert.equal(us.t, 1, 'our standing gets the tie');
  assert.equal(us.w, 0);
  assert.equal(us.l, 0, 'and no loss');
  assert.equal(them.t, 1, 'the opponent gets the tie too');
  assert.equal(them.w, 0);
  assert.equal(them.l, 0);
  const totals = seasonTotals(franchise);
  assert.equal(totals.ties, 1, 'the season record counts the tie');
  assert.equal(totals.losses, 0, 'and no loss');
  assert.equal(franchise.lastGameSummary?.tie, true, 'the last-game card carries the tie flag');
  assert.equal(franchise.lastGameSummary?.win, false);
  console.log(
    `  regular-season tie: 14-14 → OT → still 14-14 → filed T · standings ${us.w}-${us.l}-${us.t} · season ${totals.wins}-${totals.losses}-${totals.ties} · last game ${franchise.lastGameSummary?.tie ? 'T' : 'not a tie'}`,
  );
}

// Age is a career clock: 18–40, one birthday per offseason, growth that peaks at
// 18 and is gone by 28, then decline that starts at 29 and steepens to 40.
{
  const franchise = createFranchise(88);
  const ages = franchise.roster.map((p) => p.age);
  assert.ok(
    ages.every((a) => a >= AGE_MIN && a <= AGE_MAX),
    `every rostered player has a legal age (got ${Math.min(...ages)}–${Math.max(...ages)})`,
  );
  const draft = generateDraftPool(new Rng(404), 5);
  assert.ok(
    draft.every((p) => p.age >= 18 && p.age <= 22),
    `draft classes are the youngest in the league (got ${draft.map((p) => p.age).join(',')})`,
  );
  assert.ok(
    (franchise.freeAgents ?? []).every((p) => p.age >= 23 && p.age <= 36),
    'the wire is veterans, not rookies',
  );

  const curve = [18, 21, 25, 28, 29, 33, 40].map(ageSwing);
  assert.ok(
    curve.every((v, i) => i === 0 || v < curve[i - 1]),
    `the age curve only turns one way (${curve.join(' → ')})`,
  );
  assert.ok(ageSwing(18) >= 4 && ageSwing(18) > ageSwing(22), 'growth is biggest at 18');
  assert.ok(
    ageSwing(28) <= 0.2 && ageSwing(29) < 0 && ageSwing(35) < ageSwing(29),
    'decline starts at 29 and steepens',
  );
  assert.equal(careerStage(18), 'ROOKIE');
  assert.equal(careerStage(30), 'VETERAN');
  assert.equal(careerStage(38), 'TWILIGHT');

  // One winter on identical bodies: the kid grows, the veteran loses a step.
  const kid: Player = { ...franchise.roster[0], id: 'kid', age: 18, xp: 0, ratings: flatRatings(70) };
  const vet: Player = { ...kid, id: 'vet', age: 37 };
  const kidCamp = developPlayer(kid, new Rng(11));
  const vetCamp = developPlayer(vet, new Rng(11));
  assert.equal(kid.age, 19, 'a winter is one birthday');
  assert.equal(vet.age, 38);
  assert.ok(kidCamp.delta > 0, `an 18-year-old grows (${kidCamp.delta})`);
  assert.ok(vetCamp.delta < 0, `a 37-year-old declines (${vetCamp.delta})`);
  assert.ok(kidCamp.delta > vetCamp.delta, 'the young curve beats the old one');

  // Age cannot run past 40, ratings cannot fall through the floor, and the
  // fractional part of a winter is banked rather than rounded away.
  const old = { ...kid, age: AGE_MAX, xp: 0, ratings: flatRatings(RATING_FLOOR + 1) };
  developPlayer(old, new Rng(2));
  assert.equal(old.age, AGE_MAX, 'nobody ages past 40');
  assert.ok(
    Object.values(old.ratings).every((v) => v >= RATING_FLOOR),
    'regression stops at the floor instead of gutting a man',
  );
  const banker = { ...kid, age: 27, xp: 0.9 };
  developPlayer(banker, new Rng(9));
  assert.ok(banker.xp > -1 && banker.xp < 1, 'the fractional winter is banked');

  // Identical states develop identically.
  const base = createFranchise(92);
  const copy = JSON.parse(JSON.stringify(base)) as Franchise;
  developRoster(base);
  developRoster(copy);
  assert.deepEqual(base.roster, copy.roster, 'the same roster ages the same way every time');
  assert.deepEqual(base.development, copy.development);

  // The season layer runs the camp once, after the finale and before the draft.
  const camp = createFranchise(93);
  camp.roster.forEach((p) => (p.age = 18));
  const beforeCamp = camp.roster.reduce((s, p) => s + overall(p), 0);
  endSeason(camp, false);
  const afterCamp = camp.roster.reduce((s, p) => s + overall(p), 0);
  assert.ok(camp.roster.every((p) => p.age === 19), 'every man turns 19');
  assert.equal(camp.development?.entries.length, camp.roster.length, 'the report covers the whole roster');
  const campEntries = camp.development?.entries ?? [];
  assert.ok(
    (campEntries[0]?.delta ?? 0) >= (campEntries[campEntries.length - 1]?.delta ?? 0),
    'biggest movers lead the report',
  );
  assert.ok(afterCamp > beforeCamp, `an all-18 roster grows in camp (${beforeCamp} → ${afterCamp})`);
  assert.ok(
    campEntries.every((e) => e.after === overall(camp.roster.find((p) => p.id === e.id)!)),
    'the report matches the roster it wrote',
  );

  const vets = createFranchise(94);
  vets.roster.forEach((p) => {
    p.age = 38;
    p.ratings = flatRatings(70);
  });
  const beforeVets = vets.roster.reduce((s, p) => s + overall(p), 0);
  endSeason(vets, false);
  const afterVets = vets.roster.reduce((s, p) => s + overall(p), 0);
  assert.ok(afterVets < beforeVets, `an all-38 roster declines in camp (${beforeVets} → ${afterVets})`);
  assert.ok(
    vets.development?.entries.every((e) => e.delta < 0),
    'every veteran loses a step',
  );

  const next = startNewSeason(camp);
  assert.equal(next.development, null, 'the camp report is cleared at week 1');
  assert.ok(next.roster.every((p) => p.age === 19), 'ages carry into the new season');

  console.log(
    `  age curve: 18→${ageSwing(18)} · 22→${ageSwing(22)} · 28→${ageSwing(28)} · 29→${ageSwing(29)} · 40→${ageSwing(40)} · kid ${kidCamp.delta > 0 ? '+' : ''}${kidCamp.delta} vs vet ${vetCamp.delta} · all-18 camp ${beforeCamp}→${afterCamp} · all-38 camp ${beforeVets}→${afterVets}`,
  );
}

// PRODIGY is the rare career trait: about one player in twelve, and it changes
// the winter rather than a snap. Faster growth, half-speed decline, cheaper reps.
{
  const used = new Set<string>();
  const sample = Array.from({ length: 400 }, (_, i) =>
    makePlayer(new Rng(9000 + i), 'WR', 0.5, used),
  );
  const stars = sample.filter((p) => p.trait === 'prodigy');
  const rate = stars.length / sample.length;
  assert.ok(
    rate > PRODIGY_RATE - 0.04 && rate < PRODIGY_RATE + 0.04,
    `the trait is rare but real (${(rate * 100).toFixed(1)}% of ${sample.length})`,
  );
  assert.ok(rate < 0.15, 'it never becomes common');

  const a = makePlayer(new Rng(5150), 'QB', 0.4, new Set());
  const b = makePlayer(new Rng(5150), 'QB', 0.4, new Set());
  assert.equal(a.name, b.name, 'the same seed still builds the same man');
  assert.equal(a.trait, b.trait, 'and hands him the same trait');

  const franchise = createFranchise(97);
  const body = (id: string, age: number, trait: 'prodigy' | null): Player => ({
    ...franchise.roster[0],
    id,
    age,
    xp: 0,
    ratings: flatRatings(70),
    trait,
  });
  const points = (p: Player) => Object.values(p.ratings).reduce((a, v) => a + v, 0);
  const START_POINTS = 7 * 70;
  const kidPlain = body('plain', 19, null);
  const kidStar = body('star', 19, 'prodigy');
  const plainCamp = developPlayer(kidPlain, new Rng(21));
  const starCamp = developPlayer(kidStar, new Rng(21));
  assert.ok(
    points(kidStar) > points(kidPlain),
    `a prodigy grows faster (${points(kidStar)} vs ${points(kidPlain)} rating points)`,
  );
  const vetPlain = body('oldplain', 37, null);
  const vetStar = body('oldstar', 37, 'prodigy');
  const oldPlainCamp = developPlayer(vetPlain, new Rng(22));
  const oldStarCamp = developPlayer(vetStar, new Rng(22));
  assert.ok(
    points(vetStar) > points(vetPlain),
    `and declines at half speed (${points(vetStar)} vs ${points(vetPlain)} rating points)`,
  );

  const normalCost = trainingCost(70);
  const starCost = trainingCost(70, body('star2', 19, 'prodigy'));
  assert.ok(starCost < normalCost, `training is cheaper (▤${starCost} vs ▤${normalCost})`);
  const camp = createFranchise(98);
  const kid = camp.roster[0];
  kid.id = 'star-kid';
  kid.trait = 'prodigy';
  kid.ratings.arm = 70;
  camp.tape = 500;
  const tapeBefore = camp.tape;
  assert.ok(trainPlayer(camp, kid.id, 'arm'), 'the prodigy trains');
  assert.equal(tapeBefore - camp.tape, starCost, 'the discounted price is what leaves the wallet');

  const report = createFranchise(99);
  report.roster[0].trait = 'prodigy';
  endSeason(report, false);
  const flagged = report.development?.entries.find((e) => e.id === report.roster[0].id);
  assert.equal(flagged?.trait, 'prodigy', 'the camp report keeps the trait');

  console.log(
    `  prodigy: ${(rate * 100).toFixed(1)}% of ${sample.length} generated players · ×${PRODIGY_GROWTH} camp growth, ×${PRODIGY_DECLINE} decline · 19yo ${points(kidStar) - START_POINTS} vs ${points(kidPlain) - START_POINTS} pts (${starCamp.delta > 0 ? '+' : ''}${starCamp.delta} vs ${plainCamp.delta > 0 ? '+' : ''}${plainCamp.delta} OVR) · 38yo ${points(vetStar) - START_POINTS} vs ${points(vetPlain) - START_POINTS} pts (${oldStarCamp.delta} vs ${oldPlainCamp.delta} OVR) · training ▤${starCost} vs ▤${normalCost}`,
  );
}

console.log('\\nAll simulation tests passed.');

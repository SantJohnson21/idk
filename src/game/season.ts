import type {
  DrivePlay,
  Franchise,
  OpponentDrive,
  Player,
  Pos,
  QuirkId,
  Ratings,
  SeasonHistory,
  StatLine,
  TeamInfo,
  WeekSchedule,
} from './types';
import { DIFFICULTY_BONUS, FIRST_NAMES, LAST_NAMES, PLAYER_TEAM_ID, REGULAR_WEEKS, TEAMS } from './data';
import { prefersReducedMotion } from './motion';
import { Rng, clamp } from './rng';
import { developRoster, devTraitFor, PRODIGY_TRAINING } from './development';
import { MARKET, TUNING } from './constants';

let idCounter = 1;
const nextId = () => `pl${idCounter++}`;

/**
 * A loaded save was written by another session, whose ids came out of that run's
 * counter. Move ours past every id in the save before anything new is minted: a
 * duplicate id would make `roster.find` hand back the wrong man, and a bought free
 * agent would inherit a signed player's stats.
 */
export function syncIdCounter(franchise: Franchise): void {
  const everyone = [
    ...franchise.roster,
    ...(franchise.draftPool ?? []),
    ...(franchise.freeAgents ?? []),
  ];
  for (const p of everyone) {
    const n = Number.parseInt(p.id.replace(/^pl/, ''), 10);
    if (Number.isFinite(n) && n >= idCounter) idCounter = n + 1;
  }
}

const emptyLine = (): StatLine => ({
  passAtt: 0,
  passComp: 0,
  passYds: 0,
  passTD: 0,
  ints: 0,
  rushAtt: 0,
  rushYds: 0,
  rushTD: 0,
  rec: 0,
  recYds: 0,
  recTD: 0,
  fgAtt: 0,
  fgMade: 0,
  brokenTackles: 0,
  games: 0,
});

export function getTeam(franchise: Franchise, id: string): TeamInfo {
  return franchise.teams.find((t) => t.id === id) ?? franchise.teams[0];
}

export function playerTeam(franchise: Franchise): TeamInfo {
  return getTeam(franchise, franchise.teamId);
}

export function activeWeek(franchise: Franchise): WeekSchedule | undefined {
  return franchise.schedule.find((w) => w.week === franchise.week);
}

export function opponentForWeek(franchise: Franchise): TeamInfo | undefined {
  const w = activeWeek(franchise);
  return w ? getTeam(franchise, w.opponentId) : undefined;
}

const POS_TEMPLATES: Record<
  Pos,
  { ratings: Record<keyof Ratings, [number, number]>; pool: QuirkId[]; min: number; max: number }
> = {
  QB: {
    ratings: { spd: [58, 72], arm: [72, 90], hands: [42, 50], blk: [25, 35], cov: [20, 30], tkl: [25, 35], pow: [40, 55] },
    pool: ['cannon', 'field_general', 'clutch', 'showtime', 'iron_man'],
    min: 1,
    max: 19,
  },
  RB: {
    ratings: { spd: [78, 91], arm: [30, 45], hands: [62, 82], blk: [42, 62], cov: [25, 35], tkl: [35, 45], pow: [72, 89] },
    pool: ['burner', 'bruiser', 'iron_man', 'clutch', 'showtime'],
    min: 20,
    max: 39,
  },
  WR: {
    ratings: { spd: [82, 95], arm: [25, 40], hands: [74, 94], blk: [30, 52], cov: [25, 35], tkl: [25, 40], pow: [40, 58] },
    pool: ['burner', 'sure_hands', 'magnet', 'clutch', 'showtime'],
    min: 80,
    max: 89,
  },
  TE: {
    ratings: { spd: [66, 80], arm: [25, 40], hands: [68, 88], blk: [60, 84], cov: [25, 35], tkl: [35, 50], pow: [68, 86] },
    pool: ['sure_hands', 'bruiser', 'iron_man', 'clutch'],
    min: 40,
    max: 49,
  },
  OL: {
    ratings: { spd: [48, 62], arm: [20, 30], hands: [30, 45], blk: [74, 93], cov: [15, 25], tkl: [30, 45], pow: [74, 92] },
    pool: ['iron_man', 'bruiser', 'clutch'],
    min: 60,
    max: 79,
  },
  DL: {
    ratings: { spd: [62, 78], arm: [20, 30], hands: [30, 45], blk: [35, 55], cov: [20, 30], tkl: [70, 89], pow: [74, 92] },
    pool: ['bruiser', 'iron_man', 'clutch'],
    min: 90,
    max: 99,
  },
  LB: {
    ratings: { spd: [70, 86], arm: [20, 30], hands: [40, 60], blk: [40, 55], cov: [65, 84], tkl: [75, 92], pow: [72, 89] },
    pool: ['bruiser', 'ballhawk', 'iron_man', 'clutch'],
    min: 50,
    max: 59,
  },
  CB: {
    ratings: { spd: [84, 96], arm: [20, 30], hands: [55, 75], blk: [25, 40], cov: [76, 94], tkl: [50, 70], pow: [40, 58] },
    pool: ['ballhawk', 'burner', 'clutch', 'magnet'],
    min: 20,
    max: 39,
  },
  S: {
    ratings: { spd: [78, 91], arm: [20, 30], hands: [50, 70], blk: [30, 50], cov: [70, 89], tkl: [68, 88], pow: [60, 78] },
    pool: ['ballhawk', 'bruiser', 'clutch', 'iron_man'],
    min: 20,
    max: 49,
  },
  SLOT: {
    ratings: { spd: [84, 95], arm: [20, 30], hands: [74, 92], blk: [28, 45], cov: [20, 30], tkl: [20, 30], pow: [35, 50] },
    pool: ['burner', 'sure_hands', 'magnet', 'showtime'],
    min: 10,
    max: 19,
  },
  K: {
    ratings: { spd: [40, 55], arm: [20, 30], hands: [25, 35], blk: [20, 30], cov: [15, 25], tkl: [20, 30], pow: [76, 94] },
    pool: ['sniper', 'clutch', 'iron_man'],
    min: 1,
    max: 9,
  },
};

function pickName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    const n = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${rng.int(2, 9)}`;
}

export function makePlayer(rng: Rng, pos: Pos, quality: number, usedNames: Set<string>): Player {
  const tpl = POS_TEMPLATES[pos];
  const ratings = {} as Ratings;
  for (const key of Object.keys(tpl.ratings) as (keyof Ratings)[]) {
    const range = tpl.ratings[key];
    const bonus = quality * 10;
    ratings[key] = clamp(Math.round(rng.range(range[0], range[1]) + bonus), 20, 99);
  }
  const quirk = rng.pick(tpl.pool);
  const id = nextId();
  // Draw the name and number in the same order as before so fixed seeds keep
  // their rosters; the trait is derived from them, not drawn from the stream.
  const name = pickName(rng, usedNames);
  const num = rng.int(tpl.min, tpl.max);
  return {
    id,
    name,
    pos,
    num,
    // Derived from the id, not the RNG: adding ages must not reshuffle every
    // roster a fixed seed produces.
    age: 21 + ((Number.parseInt(id.slice(2), 10) * 7) % 10),
    trait: devTraitFor(name, pos, num),
    ratings,
    quirk,
    morale: rng.int(62, 82),
    ego: rng.int(1, 3),
    level: 1,
    xp: 0,
  };
}

function rosterPositions(): Pos[] {
  return ['QB', 'RB', 'WR', 'WR', 'WR', 'TE', 'OL', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
}

function makeRoster(rng: Rng, qualityBase = 0): Player[] {
  const used = new Set<string>();
  return rosterPositions().map((pos) => makePlayer(rng, pos, rng.range(0.1, 0.8) + qualityBase, used));
}

const WEATHER_POOL: WeekSchedule['weather'][] = ['CLEAR', 'NIGHT', 'RAIN', 'WIND', 'SNOW', 'FOG'];

function weatherFor(rng: Rng, week: number): WeekSchedule['weather'] {
  const r = rng.next();
  if (week === 1) return 'NIGHT';
  if (r < 0.3) return 'CLEAR';
  if (r < 0.48) return 'NIGHT';
  if (r < 0.62) return 'RAIN';
  if (r < 0.76) return 'WIND';
  if (r < 0.9) return 'FOG';
  return 'SNOW';
}

export function makeSchedule(rng: Rng, teamId: string): WeekSchedule[] {
  const opponents = rng.shuffle(TEAMS.filter((t) => t.id !== teamId).map((t) => t.id));
  const weeks: WeekSchedule[] = [];
  for (let i = 0; i < REGULAR_WEEKS; i++) {
    const opp = opponents[i];
    weeks.push({
      week: i + 1,
      opponentId: opp,
      home: rng.chance(0.5),
      weather: weatherFor(rng, i + 1),
      stage: 'regular',
    });
  }
  return weeks;
}

export function createFranchise(seed = Date.now(), teamId = PLAYER_TEAM_ID): Franchise {
  const rng = new Rng(seed);
  const roster = makeRoster(rng);
  const standings: Franchise['standings'] = {};
  for (const t of TEAMS) standings[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  return {
    version: 1,
    teams: TEAMS.map((t) => ({ ...t, colors: { ...t.colors } })),
    teamId,
    roster,
    tape: 130,
    rewindLevel: 0,
    season: 1,
    week: 1,
    schedule: makeSchedule(rng, teamId),
    standings,
    seasonStats: {},
    history: [],
    draftPool: null,
    freeAgents: generateFreeAgents(rng, MARKET.size),
    seasonStage: 'regular',
    playoffSeeds: null,
    bowlOpponentId: null,
    championId: null,
    difficulty: 'pro',
    settings: {
      sound: true,
      music: true,
      crt: true,
      haptics: true,
      reducedMotion: prefersReducedMotion(),
      slowmo: 'full',
    },
    lastGameSummary: null,
  };
}

export function teamOffenseRating(franchise: Franchise): number {
  const roster = franchise.roster;
  const qb = roster.find((p) => p.pos === 'QB');
  const rbs = roster.filter((p) => p.pos === 'RB');
  const wrs = roster.filter((p) => p.pos === 'WR');
  const te = roster.find((p) => p.pos === 'TE');
  const ols = roster.filter((p) => p.pos === 'OL');
  const vals: number[] = [];
  if (qb) vals.push(qb.ratings.arm, qb.ratings.spd);
  for (const p of wrs) vals.push(p.ratings.spd, p.ratings.hands);
  for (const p of rbs) vals.push(p.ratings.spd, p.ratings.pow);
  if (te) vals.push(te.ratings.hands, te.ratings.blk);
  for (const p of ols) vals.push(p.ratings.blk);
  return avg(vals);
}

export function teamDefenseRating(franchise: Franchise): number {
  const vals: number[] = [];
  for (const p of franchise.roster) {
    if (p.pos === 'DL') vals.push(p.ratings.pow, p.ratings.tkl);
    if (p.pos === 'LB') vals.push(p.ratings.cov, p.ratings.tkl);
    if (p.pos === 'CB' || p.pos === 'S') vals.push(p.ratings.cov, p.ratings.spd);
  }
  return avg(vals);
}

export function teamKickRating(franchise: Franchise): number {
  const k = franchise.roster.find((p) => p.pos === 'K');
  return k ? Math.round(k.ratings.pow) : 70;
}

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 70);

export function difficultyMod(franchise: Franchise): number {
  return DIFFICULTY_BONUS[franchise.difficulty];
}

export function opponentStrength(franchise: Franchise, team: TeamInfo): { off: number; def: number; kick: number } {
  const mod = difficultyMod(franchise);
  return {
    off: clamp(team.off + mod, 45, 99),
    def: clamp(team.def + mod, 45, 99),
    kick: clamp(team.kick + mod, 45, 99),
  };
}

// ---------------------------------------------------------------------------
// Playoff seeding and league simulation
// ---------------------------------------------------------------------------

export function sortedStandings(franchise: Franchise): { team: TeamInfo; w: number; l: number; t: number; pf: number; pa: number }[] {
  return franchise.teams
    .map((team) => ({ team, ...franchise.standings[team.id] }))
    .sort((a, b) => {
      // A tie is half a win, the way the league counts it. Reading only wins and
      // losses would seed a 0-0-1 team below a 0-1 team.
      const gamesA = a.w + a.l + a.t;
      const gamesB = b.w + b.l + b.t;
      const pctA = gamesA === 0 ? 0 : (a.w + a.t * 0.5) / gamesA;
      const pctB = gamesB === 0 ? 0 : (b.w + b.t * 0.5) / gamesB;
      if (pctB !== pctA) return pctB - pctA;
      return b.pf - b.pa - (a.pf - a.pa);
    });
}

function addStanding(franchise: Franchise, id: string, win: boolean, tie: boolean, pf: number, pa: number) {
  const s = franchise.standings[id] ?? { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  if (tie) s.t += 1;
  else if (win) s.w += 1;
  else s.l += 1;
  s.pf += pf;
  s.pa += pa;
  franchise.standings[id] = s;
}

function simNeutralWin(rng: Rng, a: TeamInfo, b: TeamInfo): boolean {
  const scoreA = a.off * 0.6 + a.def * 0.4 + 3;
  const scoreB = b.off * 0.6 + b.def * 0.4;
  return rng.chance(clamp(0.5 + (scoreA - scoreB) / 80, 0.25, 0.75));
}

export function simOtherLeagueGames(franchise: Franchise, rng: Rng, ourOpponentId: string) {
  const pool = franchise.teams.filter((t) => t.id !== franchise.teamId && t.id !== ourOpponentId);
  const shuffled = rng.shuffle(pool);
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    const aWin = simNeutralWin(rng, a, b);
    const sa = Math.round(rng.range(14, 34));
    const sb = Math.round(rng.range(14, 34));
    const [af, bf] = aWin ? [Math.max(sa, sb + 2), sb] : [sa, Math.max(sb, sa + 2)];
    addStanding(franchise, a.id, aWin, false, af, bf);
    addStanding(franchise, b.id, !aWin, false, bf, af);
  }
}

export function ensurePlayoffs(franchise: Franchise): void {
  const rng = new Rng(Date.now() % 100000 + franchise.season * 97);
  const seeds = sortedStandings(franchise).slice(0, 4).map((s) => s.team.id);
  franchise.playoffSeeds = seeds;
  const ourIndex = seeds.indexOf(franchise.teamId);
  if (ourIndex === -1) {
    // Missed the dance. Simulate the rest for the record books.
    const a = getTeam(franchise, seeds[0]);
    const b = getTeam(franchise, seeds[1]);
    franchise.championId = simNeutralWin(rng, a, b) ? a.id : b.id;
    franchise.seasonStage = 'offseason';
    endSeason(franchise, false);
    return;
  }
  const opponentIndex = ourIndex === 0 ? 3 : ourIndex === 1 ? 2 : ourIndex === 2 ? 1 : 0;
  const opponentId = seeds[opponentIndex];
  const remaining = seeds.filter((id) => id !== franchise.teamId && id !== opponentId);
  const bowlA = getTeam(franchise, remaining[0]);
  const bowlB = getTeam(franchise, remaining[1]);
  franchise.bowlOpponentId = simNeutralWin(rng, bowlA, bowlB) ? bowlA.id : bowlB.id;
  franchise.seasonStage = 'playoffs';
  const semiWeek = franchise.schedule.length + 1;
  franchise.week = semiWeek;
  franchise.schedule = franchise.schedule.filter((w) => w.week < semiWeek);
  franchise.schedule.push({
    week: semiWeek,
    opponentId,
    home: true,
    weather: 'NIGHT',
    stage: 'semi',
  });
}

export function advanceAfterGame(franchise: Franchise, win: boolean, tie: boolean, ourScore: number, theirScore: number): void {
  const week = franchise.schedule.find((w) => w.week === franchise.week);
  if (!week) return;
  // The match plays a postseason game until it is decided. If a tied playoff result
  // ever reaches this layer, refuse to file it rather than handing the bracket — or
  // the title — to the opponent by default.
  if (week.stage !== 'regular' && (tie || ourScore === theirScore)) return;
  week.result = { our: ourScore, theirs: theirScore, win, tie };
  const oppId = week.opponentId;
  // The standings are the regular-season table. A playoff result belongs to the
  // bracket: counting it here padded a club's row by every postseason game, so a
  // 10-5 team read 13-5 after a run and the table could reshuffle after the field
  // was already set.
  if (week.stage === 'regular') {
    addStanding(franchise, franchise.teamId, win, tie, ourScore, theirScore);
    addStanding(franchise, oppId, !win && !tie, tie, theirScore, ourScore);
  }

  const rng = new Rng(Date.now() % 65535 + franchise.week * 131 + franchise.season * 17);
  if (week.stage === 'regular') {
    simOtherLeagueGames(franchise, rng, oppId);
    if (franchise.week < franchise.schedule.length) franchise.week += 1;
    else ensurePlayoffs(franchise);
  } else if (week.stage === 'semi') {
    // The bracket reads the scoreline, not the absence of a win flag.
    if (ourScore > theirScore) {
      const bowlWeek = week.week + 1;
      franchise.week = bowlWeek;
      franchise.schedule = franchise.schedule.filter((w) => w.week < bowlWeek);
      franchise.schedule.push({
        week: bowlWeek,
        opponentId: franchise.bowlOpponentId ?? franchise.teams.find((t) => t.id !== franchise.teamId)!.id,
        home: true,
        weather: 'NIGHT',
        stage: 'bowl',
      });
    } else {
      // Somebody else lifts the trophy.
      const other = getTeam(franchise, franchise.bowlOpponentId ?? oppId);
      const winner = getTeam(franchise, oppId);
      franchise.championId = simNeutralWin(rng, winner, other) ? winner.id : other.id;
      endSeason(franchise, false);
    }
  } else if (week.stage === 'bowl') {
    // The champion is the side that outscored the other. There is no tie default.
    const weWon = ourScore > theirScore;
    franchise.championId = weWon ? franchise.teamId : oppId;
    endSeason(franchise, weWon);
  }
}

export function seasonTotals(franchise: Franchise): { wins: number; losses: number; ties: number; pf: number; pa: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pf = 0;
  let pa = 0;
  for (const w of franchise.schedule) {
    if (!w.result) continue;
    if (w.stage && w.stage !== 'regular') continue;
    if (w.result.tie) ties++;
    else if (w.result.win) wins++;
    else losses++;
    pf += w.result.our;
    pa += w.result.theirs;
  }
  return { wins, losses, ties, pf, pa };
}

export function seasonMvp(franchise: Franchise): string {
  let best = '';
  let bestScore = -1;
  for (const p of franchise.roster) {
    const s = franchise.seasonStats[p.id];
    if (!s) continue;
    const score = s.passYds + s.rushYds * 1.1 + s.recYds * 1.2 + (s.passTD + s.rushTD + s.recTD) * 45 + s.brokenTackles * 3;
    if (score > bestScore) {
      bestScore = score;
      best = p.name;
    }
  }
  return best || 'The Offensive Line';
}

export function endSeason(franchise: Franchise, wonBowl: boolean): void {
  const totals = seasonTotals(franchise);
  const entry: SeasonHistory = {
    season: franchise.season,
    wins: totals.wins,
    losses: totals.losses,
    ties: totals.ties,
    pointsFor: totals.pf,
    pointsAgainst: totals.pa,
    madePlayoffs: Boolean(franchise.playoffSeeds?.includes(franchise.teamId)),
    wonBowl,
    mvpName: seasonMvp(franchise),
  };
  const bowl = franchise.schedule.find((w) => w.stage === 'bowl' && w.result);
  if (bowl?.result) entry.bowlScore = `${bowl.result.our}-${bowl.result.theirs}`;
  franchise.history = [...franchise.history, entry];
  franchise.seasonStage = 'offseason';
  if (wonBowl) franchise.tape += 250;
  franchise.roster = franchise.roster.map((p) => ({ ...p, morale: clamp(p.morale + 8, 25, 99) }));
  // Every man turns a year older and pays the age curve — before the draft class
  // is minted, so this winter's rookies arrive young instead of aged one year.
  franchise.development = developRoster(franchise);
  franchise.draftPool = generateDraftPool(new Rng(Date.now() % 99991 + franchise.season * 313), 5);
  franchise.week = franchise.schedule.length + 1;
}

export function generateDraftPool(rng: Rng, count = 5): Player[] {
  // Distinct positions per class so the scouting report always offers a real choice
  // (no more drafts where four of five prospects are cornerbacks).
  const positions: Pos[] = rng.shuffle(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'] as Pos[]);
  const used = new Set<string>();
  const pool: Player[] = [];
  for (let i = 0; i < count; i++) {
    const pos = positions[i % positions.length];
    const p = makePlayer(rng, pos, rng.range(0.45, 0.9), used);
    p.ego = rng.int(1, 2);
    // Draft classes are 18–22: the youngest players in the league.
    p.age = 18 + ((Number.parseInt(p.id.slice(2), 10) * 3) % 5);
    pool.push(p);
  }
  return pool;
}

export function startNewSeason(franchise: Franchise): Franchise {
  const rng = new Rng(Date.now() % 100003 + franchise.season * 271);
  const standings: Franchise['standings'] = {};
  for (const t of franchise.teams) standings[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  return {
    ...franchise,
    season: franchise.season + 1,
    week: 1,
    schedule: makeSchedule(rng, franchise.teamId),
    standings,
    seasonStats: {},
    draftPool: null,
    freeAgents: generateFreeAgents(rng, MARKET.size),
    seasonStage: 'regular',
    playoffSeeds: null,
    bowlOpponentId: null,
    championId: null,
    // A new year has no game tape yet: last season's bowl must not read as "last week".
    lastGameSummary: null,
    development: null,
    roster: franchise.roster.map((p) => ({ ...p, morale: clamp(p.morale + 6, 30, 99) })),
  };
}

// ---------------------------------------------------------------------------
// Training & economy
// ---------------------------------------------------------------------------

export function trainingCost(rating: number, player?: Player): number {
  const base = Math.round(35 + Math.max(0, rating - 55) * 3.2);
  // A prodigy absorbs coaching as quickly as he absorbs a winter.
  return player?.trait === 'prodigy' ? Math.max(20, Math.round(base * PRODIGY_TRAINING)) : base;
}

export function trainPlayer(franchise: Franchise, playerId: string, stat: keyof Ratings): boolean {
  const p = franchise.roster.find((x) => x.id === playerId);
  if (!p) return false;
  const cur = p.ratings[stat];
  const cost = trainingCost(cur, p);
  if (cur >= 99 || franchise.tape < cost) return false;
  franchise.tape -= cost;
  p.ratings[stat] = Math.min(99, cur + 1);
  return true;
}

export function restTeam(franchise: Franchise): boolean {
  if (franchise.tape < 50) return false;
  franchise.tape -= 50;
  franchise.roster.forEach((p) => (p.morale = clamp(p.morale + 14, 25, 99)));
  return true;
}

export function upgradeRewinds(franchise: Franchise): boolean {
  const cost = 180 + franchise.rewindLevel * 140;
  if (franchise.rewindLevel >= 2 || franchise.tape < cost) return false;
  franchise.tape -= cost;
  franchise.rewindLevel += 1;
  return true;
}

export function rewindCost(franchise: Franchise): number {
  return 180 + franchise.rewindLevel * 140;
}

/**
 * The wire: veterans between jobs, one marquee name and a handful of depth. A slot
 * receiver is the third wideout on the roster, so there is no SLOT man to sign.
 */
export function generateFreeAgents(rng: Rng, count = MARKET.size): Player[] {
  const positions = rng.shuffle([
    'QB',
    'RB',
    'WR',
    'TE',
    'OL',
    'DL',
    'LB',
    'CB',
    'S',
    'K',
  ] as Pos[]);
  const used = new Set<string>();
  const pool: Player[] = [];
  for (let i = 0; i < count; i++) {
    const pos = positions[i % positions.length];
    // One name at the top of the market is a real upgrade; the rest are jobs.
    // The depth bodies are genuinely cheap — a career's worth of tape for the star, a
    // week's for the rest — so the wire is a decision rather than a shopping list. The
    // position templates carry high rating ranges, so "cheap" means well below them.
    const p = makePlayer(rng, pos, i === 0 ? rng.range(0.72, 0.94) : rng.range(-1.2, 0.1), used);
    p.level = rng.int(2, 4);
    p.morale = rng.int(55, 78);
    p.ego = rng.int(1, 3);
    // The wire is veterans: past their rookie deal, short of the retirement watch.
    p.age = 23 + ((Number.parseInt(p.id.slice(2), 10) * 5) % 14);
    pool.push(p);
  }
  return pool;
}

export function signRookie(franchise: Franchise, rookieId: string, releaseId: string): boolean {
  const rookie = franchise.draftPool?.find((p) => p.id === rookieId);
  if (!rookie) return false;
  const idx = franchise.roster.findIndex((p) => p.id === releaseId);
  if (idx === -1) return false;
  const roster = franchise.roster.slice();
  roster[idx] = { ...rookie, morale: 75 };
  franchise.roster = roster;
  // One pick per offseason; the rest of the class goes elsewhere.
  franchise.draftPool = null;
  return true;
}

export function moraleMod(morale: number): number {
  return clamp((morale - 70) / 12, -4, 4);
}

// ---------------------------------------------------------------------------
// Simulated opponent drives (our defense is coaching, not button-mashing)
// ---------------------------------------------------------------------------

/** The spots a BALLHAWK can actually play. A receiver with the trait does nothing. */
const DEFENSIVE_POS: Pos[] = ['DL', 'LB', 'CB', 'S'];
/**
 * What one BALLHAWK defender adds to the chance an opponent drive dies on a
 * takeaway: 2.5 points on a 4% base, capped at three defenders (+7.5). One hawk
 * is a real upgrade (4% → 6.5% per drive), a secondary full of them is a unit.
 */
export const BALLHAWK_TAKEAWAY = 0.025;
export const BALLHAWK_TAKEAWAY_CAP = 0.075;

export function ballhawkTakeawayBonus(roster: Player[]): number {
  const hawks = roster.filter(
    (p) => p.quirk === 'ballhawk' && DEFENSIVE_POS.includes(p.pos),
  ).length;
  return Math.min(BALLHAWK_TAKEAWAY_CAP, hawks * BALLHAWK_TAKEAWAY);
}

export interface OppDriveOptions {
  rng: Rng;
  startSpot: number; // their own field position, 0..100
  theirOff: number;
  ourDef: number;
  kick: number;
  clock: number;
  /** Extra per-play takeaway chance from BALLHAWK defenders, 0..0.075. */
  takeawayBonus?: number;
}

export function simulateOpponentDrive(opts: OppDriveOptions): OpponentDrive {
  const { rng } = opts;
  // Their own 1 through our 1: a punt can pin them as deep as we can be pinned.
  let spot = clamp(Math.round(opts.startSpot), 1, 99);
  let down = 1;
  let toGo = Math.min(10, 100 - spot);
  const plays: DrivePlay[] = [];
  let points = 0;
  /** What our defense scored on this drive, if anything. */
  let ourScore: 'safety' | 'def_td' | null = null;
  let timeUsed = 0;
  let turnover = false;
  let touchdown = false;
  const edge = clamp((opts.theirOff - opts.ourDef) / 9, -3.2, 3.2);
  const takeawayBonus = clamp(opts.takeawayBonus ?? 0, 0, BALLHAWK_TAKEAWAY_CAP);

  const log = (kind: DrivePlay['kind'], text: string, yards: number) => {
    plays.push({ down, toGo, spot, text, yards, kind });
  };

  for (let i = 0; i < 14; i++) {
    if (down === 4) {
      const distanceToGoal = 100 - spot;
      const fgDist = distanceToGoal + 17;
      if (fgDist <= 55 && fgDist >= 24) {
        const makeChance = clamp(0.97 - Math.max(0, fgDist - 22) * 0.012 - (opts.ourDef - 70) * 0.002, 0.35, 0.97);
        const t = rng.range(5, 9);
        timeUsed += t;
        if (rng.chance(makeChance)) {
          points += 3;
          log('fg', `${fgDist} YD FIELD GOAL`, 0);
          plays[plays.length - 1].text = `${fgDist} YD FG IS GOOD`;
          plays[plays.length - 1].kind = 'fg';
        } else {
          log('miss', `${fgDist} YD FG MISSED`, 0);
          plays[plays.length - 1].kind = 'miss';
        }
        break;
      }
      if (distanceToGoal <= 52 && toGo <= 4) {
        // Go for it — fall through to a normal play.
      } else {
        const punt = rng.range(36, 54);
        // A punt is spotted where it stopped. One that carries over our goal line is
        // a touchback, not a phantom pin on our own 1.
        const touchback = spot + punt >= 100;
        log('punt', `PUNT ${Math.round(punt)} YDS${touchback ? ' — TOUCHBACK' : ''}`, 0);
        spot = touchback ? 80 : clamp(spot + punt, 1, 99);
        timeUsed += rng.range(4, 8);
        plays[plays.length - 1].spot = spot;
        break;
      }
    }

    // BALLHAWK: a defender jumps the route before the play is run. This is an
    // extra, independent roll, so a roster with no hawk plays exactly as before.
    if (takeawayBonus > 0 && rng.chance(takeawayBonus)) {
      turnover = true;
      log('turnover', rng.chance(0.55) ? 'INTERCEPTED' : 'STRIPPED', 0);
      timeUsed += 1;
      break;
    }

    const playTime = rng.range(4.2, 7.8);
    timeUsed += playTime;
    const roll = rng.next();
    let yards = 0;
    let kind: DrivePlay['kind'] = 'run';
    // Backed up on their own 1-4, real offenses stop taking risks: max protection
    // and the ball out quick instead of a deep dropback, and a stuffed run is a
    // one-yard loss rather than a jailbreak. Sacks stay the main way two points
    // happen — 54 of the 151 safeties in the NFL's 2016-2025 regular seasons —
    // just shallower and rarer than on a normal down.
    const backedUp = spot <= 4;
    const sackBand = backedUp ? 0.05 : 0.08;
    const stuffBand = backedUp ? 0.035 : 0.04;
    if (roll < 0.04) {
      // Backed up on their own doorstep, a takeaway can go the other way for six.
      // The ball is never literally in their end zone at the snap in this model,
      // so the return is what scores it — and the closer their own goal line, the
      // likelier it is to go the distance.
      const returnChance = clamp((14 - spot) * 0.05, 0, 0.6);
      if (returnChance > 0 && rng.chance(returnChance)) {
        ourScore = 'def_td';
        log('def_td', rng.chance(0.55) ? 'PICK SIX' : 'SCOOP AND SCORE', 0);
        timeUsed += 1.5;
        break;
      }
      turnover = true;
      log('turnover', rng.chance(0.55) ? 'INTERCEPTED' : 'FUMBLE RECOVERED', 0);
      timeUsed += 1;
      break;
    }
    if (roll < 0.04 + sackBand) {
      yards = -Math.round(backedUp ? rng.range(3, 6) : rng.range(4, 9));
      kind = 'pass';
      log('pass', `SACKED ${yards} YDS`, yards);
    } else if (roll < 0.3) {
      yards = Math.round(rng.range(2, 6) + edge * 0.7);
      log('run', `RUSH +${Math.max(0, yards)}`, yards);
    } else if (roll < 0.44) {
      yards = Math.round(rng.range(5, 13) + edge);
      log('pass', `PASS +${Math.max(0, yards)}`, yards);
    } else if (roll < 0.55) {
      yards = 0;
      kind = 'pass';
      log('pass', 'INCOMPLETE', 0);
      timeUsed -= 2.8;
    } else if (roll < 0.68) {
      yards = Math.round(rng.range(1, 6));
      log('run', `RUSH +${yards}`, yards);
    } else if (roll < 0.84) {
      yards = Math.round(rng.range(6, 18) + edge * 1.2);
      kind = 'pass';
      log('pass', `PASS +${Math.max(0, yards)}`, yards);
    } else if (roll < 1 - stuffBand) {
      yards = Math.round(rng.range(18, 36) + edge * 2.2);
      kind = 'pass';
      log('pass', `BIG PASS +${yards}`, yards);
    } else {
      yards = -Math.round(backedUp ? rng.range(1, 3) : rng.range(1, 6));
      log('run', `STUFFED ${yards} YDS`, yards);
    }

    if (spot + yards >= 100) {
      touchdown = true;
      points += 7;
      plays.push({ down, toGo, spot: 100, text: 'TOUCHDOWN', yards: 100 - spot, kind: 'td' });
      break;
    }
    // Downed behind their own goal line: the same rule our offense lives under,
    // except this one pays us two points and a free kick.
    if (spot + yards < 0) {
      ourScore = 'safety';
      log(
        'safety',
        kind === 'pass' ? 'SACKED IN THE END ZONE — SAFETY' : 'TACKLED IN THE END ZONE — SAFETY',
        yards,
      );
      break;
    }
    spot = clamp(spot + yards, 1, 99);
    if (yards >= toGo) {
      down = 1;
      toGo = Math.min(10, 100 - spot);
    } else {
      down += 1;
      toGo -= yards;
      if (toGo <= 0) {
        down = 1;
        toGo = Math.min(10, 100 - spot);
      }
    }
  }

  if (plays.length === 0) {
    plays.push({ down: 1, toGo, spot, text: 'PUNT', yards: 0, kind: 'punt' });
  }

  const punt = plays.find((p) => p.kind === 'punt');
  let nextSpot: number;
  // Our defense scored: they kick off, or free-kick after the safety, and we take
  // over on our own 25 or 40.
  if (ourScore === 'def_td') nextSpot = 25;
  else if (ourScore === 'safety') nextSpot = 40;
  else if (touchdown || points === 3) nextSpot = 25;
  else {
    // Every other takeover is one rule: we start where their ball died, on the
    // field of play. A punt is spotted where it stopped, anything else where the
    // series ended — our own 1-4 included, the way they can be pinned at theirs.
    const deadSpot = clamp(punt ? punt.spot : spot, 1, 99);
    nextSpot = clamp(100 - deadSpot, 1, 99);
  }

  const summary =
    ourScore === 'def_td'
      ? 'DEFENSIVE TOUCHDOWN'
      : ourScore === 'safety'
        ? 'SAFETY'
        : touchdown
          ? `TOUCHDOWN ${''}`
          : points === 3
            ? 'FIELD GOAL'
            : turnover
              ? 'TURNOVER'
              : plays.some((p) => p.kind === 'miss')
                ? 'MISSED FG'
                : 'PUNT';

  return {
    plays,
    points,
    ourPoints: ourScore === 'def_td' ? 7 : ourScore === 'safety' ? 2 : 0,
    nextSpot,
    timeUsed: Math.round(clamp(timeUsed, 8, 65)),
    summary,
    turnover,
    touchdown,
  };
}

// ---------------------------------------------------------------------------
// Post-game bookkeeping
// ---------------------------------------------------------------------------

export interface GameSummary {
  ourScore: number;
  theirScore: number;
  win: boolean;
  tie: boolean;
  opponentId: string;
  stats: Record<string, StatLine>;
  tapeEarned: number;
  highlights: string[];
  mvpName: string;
  mvpPlayerId: string;
  totalYards: number;
  touchdowns: number;
}

export function mergeStats(franchise: Franchise, stats: Record<string, StatLine>) {
  const seen = new Set<string>();
  for (const [id, line] of Object.entries(stats)) {
    seen.add(id);
    const cur = franchise.seasonStats[id] ?? emptyLine();
    const next: StatLine = { ...cur };
    next.passAtt += line.passAtt;
    next.passComp += line.passComp;
    next.passYds += line.passYds;
    next.passTD += line.passTD;
    next.ints += line.ints;
    next.rushAtt += line.rushAtt;
    next.rushYds += line.rushYds;
    next.rushTD += line.rushTD;
    next.rec += line.rec;
    next.recYds += line.recYds;
    next.recTD += line.recTD;
    next.fgAtt += line.fgAtt;
    next.fgMade += line.fgMade;
    next.brokenTackles += line.brokenTackles;
    next.games = cur.games + 1;
    franchise.seasonStats[id] = next;
  }
  // Everyone on the roster played, even if the box score never found them.
  for (const p of franchise.roster) {
    if (seen.has(p.id)) continue;
    const cur = franchise.seasonStats[p.id] ?? emptyLine();
    franchise.seasonStats[p.id] = { ...cur, games: cur.games + 1 };
  }
}

export function applyMorale(franchise: Franchise, summary: GameSummary) {
  for (const p of franchise.roster) {
    const s = summary.stats[p.id];
    const touches = s ? s.rec + s.rushAtt + (p.pos === 'QB' ? s.passAtt : 0) : 0;
    let delta = summary.win ? 2 : summary.tie ? 0 : -2;
    if (p.ego >= 2) {
      if (touches < 3) delta -= 9;
      else if (touches >= 5) delta += 5;
    }
    p.morale = clamp(p.morale + delta, 25, 99);
  }
}

export function finishGame(franchise: Franchise, summary: GameSummary): void {
  const week = activeWeek(franchise);
  // A postseason game cannot be filed on a tie: the match plays overtime until it is
  // decided. Refusing it leaves the same game on the schedule, never a title for the
  // side that did not outscore the other.
  if (week && week.stage !== 'regular' && summary.ourScore === summary.theirScore) return;
  mergeStats(franchise, summary.stats);
  applyMorale(franchise, summary);
  franchise.tape += summary.tapeEarned;
  franchise.lastGameSummary = {
    week: franchise.week,
    opponentId: summary.opponentId,
    our: summary.ourScore,
    theirs: summary.theirScore,
    win: summary.win,
    tie: summary.tie,
    tapeEarned: summary.tapeEarned,
    highlights: summary.highlights,
    mvp: summary.mvpName,
  };
  advanceAfterGame(franchise, summary.win, summary.tie, summary.ourScore, summary.theirScore);
}

export function totalYards(franchise: Franchise, stats: Record<string, StatLine>): number {
  let y = 0;
  for (const line of Object.values(stats)) y += line.passYds + line.rushYds;
  return y;
}

export function emptyStatLine(): StatLine {
  return emptyLine();
}

export function rewindStart(franchise: Franchise): number {
  return TUNING.rewindStart + franchise.rewindLevel;
}

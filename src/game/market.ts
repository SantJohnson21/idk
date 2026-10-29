import type { Franchise, Player, Pos, Ratings } from './types';
import { MARKET } from './constants';
import { Rng } from './rng';
import { generateFreeAgents } from './season';

// Grade a player the way the market does: a cornerback is not paid for his arm.
const OVR_KEYS: Record<Pos, (keyof Ratings)[]> = {
  QB: ['arm', 'hands', 'spd', 'pow'],
  RB: ['spd', 'pow', 'hands', 'blk'],
  WR: ['spd', 'hands', 'pow'],
  SLOT: ['spd', 'hands', 'pow'],
  TE: ['hands', 'blk', 'pow', 'spd'],
  OL: ['blk', 'pow'],
  DL: ['pow', 'tkl', 'spd'],
  LB: ['tkl', 'cov', 'spd', 'pow'],
  CB: ['cov', 'spd', 'tkl'],
  S: ['cov', 'tkl', 'spd'],
  K: ['arm', 'pow'],
};

/** The one number the whole market is written in. */
export function overall(p: Player): number {
  const keys = OVR_KEYS[p.pos] ?? OVR_KEYS.QB;
  return Math.round(keys.reduce((a, k) => a + p.ratings[k], 0) / keys.length);
}

/** The positions a legal lineup has to be able to field, one man each. */
export const REQUIRED_POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];

/** How many of a position the sim actually puts on the field. */
const ON_FIELD: Partial<Record<Pos, number>> = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 2, K: 1 };

/** Whether a roster can still line up — the rule that stops a sale gutting the team. */
export function canFieldLineup(roster: Player[]): boolean {
  return REQUIRED_POSITIONS.every((pos) => roster.some((p) => p.pos === pos));
}

/** Where a man sits on the depth chart, the way the sim picks his position group. */
export function depthTag(roster: Player[], player: Player): 'STARTS' | 'ROTATION' | 'BENCH' {
  const onField = ON_FIELD[player.pos];
  // The defense is coached as a unit, so every defender is in the rotation.
  if (!onField) return 'ROTATION';
  const group = roster.filter((p) => p.pos === player.pos);
  return group.indexOf(player) < onField ? 'STARTS' : 'BENCH';
}

const POS_PREMIUM: Partial<Record<Pos, number>> = { QB: 1.35, DL: 1.1, CB: 1.1, K: 0.5 };

const QUIRK_PREMIUM: Partial<Record<Player['quirk'], number>> = {
  cannon: 25,
  burner: 20,
  magnet: 20,
  field_general: 20,
  ballhawk: 15,
  sure_hands: 15,
  clutch: 12,
  showtime: 12,
  bruiser: 12,
  iron_man: 10,
  sniper: 10,
};

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** What the tape pays to sign him: grade first, then position and quirk. */
export function buyPrice(p: Player): number {
  const base = 30 + Math.max(0, overall(p) - 52) * 8;
  const quirk = QUIRK_PREMIUM[p.quirk] ?? 0;
  return round5((base + quirk + p.level * 4) * (POS_PREMIUM[p.pos] ?? 1));
}

/** What a sale pays back: a spread, so churning the market always costs tape. */
export function sellValue(p: Player): number {
  return round5(buyPrice(p) * MARKET.sellRatio);
}

export type Deal = 'ok' | 'no-tape' | 'full' | 'illegal-lineup' | 'not-found';

/**
 * Where a new man sits: ahead of the first player he out-grades, so a signing who
 * is better than the man in front of him actually takes the field — the sim reads
 * the roster order — and a lesser one rides the bench.
 */
export function placeInRoster(roster: Player[], player: Player): Player[] {
  const next = roster.slice();
  const ahead = next.findIndex((q) => q.pos === player.pos && overall(player) > overall(q));
  if (ahead >= 0) next.splice(ahead, 0, player);
  else next.push(player);
  return next;
}

/** Stock the wire if it is empty: a new market for an old save, or a cleaned-out one. */
export function ensureMarket(franchise: Franchise): void {
  if (franchise.freeAgents && franchise.freeAgents.length) return;
  // Seeded off the franchise itself, so a refill is reproducible for a given state.
  franchise.freeAgents = generateFreeAgents(
    new Rng(7001 + franchise.season * 577 + franchise.tape),
    MARKET.size,
  );
}

/** What would happen if you tried this deal — the arithmetic signFreeAgent runs. */
export function dealVerdict(
  franchise: Franchise,
  agentId: string,
  releaseId: string | null = null,
): Deal {
  const agent = (franchise.freeAgents ?? []).find((p) => p.id === agentId);
  if (!agent) return 'not-found';
  if (buyPrice(agent) > franchise.tape) return 'no-tape';
  let roster = franchise.roster;
  if (releaseId) {
    const gone = roster.find((p) => p.id === releaseId);
    if (!gone) return 'not-found';
    roster = roster.filter((p) => p.id !== gone.id);
  } else if (roster.length >= MARKET.rosterMax) {
    return 'full';
  }
  return canFieldLineup(placeInRoster(roster, agent)) ? 'ok' : 'illegal-lineup';
}

/**
 * Sign a free agent: pay the tape, take him off the wire, and put him where his grade
 * says he belongs. With the roster at its cap you have to name the man who leaves.
 */
export function signFreeAgent(
  franchise: Franchise,
  agentId: string,
  releaseId: string | null = null,
): Deal {
  const verdict = dealVerdict(franchise, agentId, releaseId);
  if (verdict !== 'ok') return verdict;
  const pool = franchise.freeAgents ?? [];
  const agent = pool.find((p) => p.id === agentId)!;
  const roster = releaseId ? franchise.roster.filter((p) => p.id !== releaseId) : franchise.roster;
  franchise.tape -= buyPrice(agent);
  franchise.roster = placeInRoster(roster, agent);
  franchise.freeAgents = pool.filter((p) => p.id !== agent.id);
  ensureMarket(franchise);
  return 'ok';
}

/** What you would get for him, or why the market will not take him. */
export function sellVerdict(franchise: Franchise, playerId: string): Deal {
  const player = franchise.roster.find((p) => p.id === playerId);
  if (!player) return 'not-found';
  const after = franchise.roster.filter((p) => p.id !== playerId);
  return canFieldLineup(after) ? 'ok' : 'illegal-lineup';
}

/**
 * Sell a player for tape. The one thing the market refuses is a sale that leaves the
 * roster unable to field a position — he is worth film, not your season.
 */
export function sellPlayer(franchise: Franchise, playerId: string): Deal {
  const verdict = sellVerdict(franchise, playerId);
  if (verdict !== 'ok') return verdict;
  const player = franchise.roster.find((p) => p.id === playerId)!;
  franchise.tape += sellValue(player);
  franchise.roster = franchise.roster.filter((p) => p.id !== playerId);
  // He goes back on the wire: somebody will pay more for him than you got.
  franchise.freeAgents = [...(franchise.freeAgents ?? []), player];
  return 'ok';
}

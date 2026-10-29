import type { DevTrait, DevelopmentEntry, DevelopmentReport, Franchise, Player, Ratings } from './types';
import { Rng, clamp } from './rng';
import { POS_OVR_KEYS, overall } from './player';

/** No player is ever younger or older than this. */
export const AGE_MIN = 18;
export const AGE_MAX = 40;

/**
 * What age does to a rating in one year. Nobody erodes into nothing: a 40-year-old
 * is slow, not unplayable, so the decline stops at this floor.
 */
export const RATING_FLOOR = 30;

/**
 * PRODIGY is the rare career trait: roughly one player in twelve. It is not a
 * quirk — it does not touch a snap — it changes what a winter does to a man.
 */
export const PRODIGY_RATE = 0.08;
/** A prodigy turns coaching into rating points faster than the curve allows. */
export const PRODIGY_GROWTH = 1.6;
/** And he holds his level longer: decline is paid at a little over half. */
export const PRODIGY_DECLINE = 0.55;
/** Training costs this share of the normal tape price. */
export const PRODIGY_TRAINING = 0.75;

/**
 * Derived from the player, not drawn from the generation RNG: the trait follows
 * a name/position/number, so a fixed seed reproduces the same career and adding
 * traits does not reshuffle every roster.
 */
function traitHash(name: string, pos: string, num: number): number {
  let h = 2166136261;
  for (const ch of `${name}|${pos}|${num}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function devTraitFor(name: string, pos: Player['pos'], num: number): DevTrait | null {
  return traitHash(name, pos, num) % 1000 < Math.round(PRODIGY_RATE * 1000) ? 'prodigy' : null;
}

export function isProdigy(p: Player): boolean {
  return p.trait === 'prodigy';
}

export type CareerStage = 'ROOKIE' | 'RISING' | 'PRIME' | 'VETERAN' | 'TWILIGHT';

/** The label the locker room and the camp report use for a man's career arc. */
export function careerStage(age: number): CareerStage {
  if (age <= 21) return 'ROOKIE';
  if (age <= 25) return 'RISING';
  if (age <= 28) return 'PRIME';
  if (age <= 33) return 'VETERAN';
  return 'TWILIGHT';
}

/**
 * Average rating points a player gains (+) or loses (−) in one offseason.
 * This curve is the design: growth is biggest at 18 and fades every year until
 * it is gone by 27, the prime holds roughly level through 28, and decline
 * starts at 29 and steepens all the way to 40.
 */
export function ageSwing(age: number): number {
  const table: Record<number, number> = {
    18: 6.0,
    19: 5.4,
    20: 4.8,
    21: 4.2,
    22: 3.6,
    23: 3.0,
    24: 2.4,
    25: 1.8,
    26: 1.2,
    27: 0.6,
    28: 0.1,
    29: -0.6,
    30: -1.1,
    31: -1.6,
    32: -2.2,
    33: -2.8,
    34: -3.5,
    35: -4.2,
    36: -4.9,
    37: -5.6,
    38: -6.3,
    39: -7.0,
    40: -7.7,
  };
  return table[clamp(Math.round(age), AGE_MIN, AGE_MAX)] ?? 0;
}

/**
 * On the way down, the legs go first: speed and tackling erode before arm and
 * hands. Growth has no such order — the points are spread over the grade.
 */
const DECLINE_ORDER: Record<keyof Ratings, number> = {
  spd: 0,
  tkl: 1,
  pow: 1,
  cov: 2,
  blk: 2,
  hands: 3,
  arm: 3,
};

function spendPoints(p: Player, points: number, rng: Rng): void {
  const keys = POS_OVR_KEYS[p.pos] ?? POS_OVR_KEYS.QB;
  const order =
    points > 0
      ? rng.shuffle(keys.slice())
      : keys.slice().sort((a, b) => DECLINE_ORDER[a] - DECLINE_ORDER[b]);
  const dir = points > 0 ? 1 : -1;
  let left = Math.abs(points);
  // One point per rating per pass, so a +4 winter touches the whole grade rather
  // than stacking every point on one number.
  for (let pass = 0; pass < 8 && left > 0; pass++) {
    for (const key of order) {
      if (left === 0) break;
      const next = clamp(p.ratings[key] + dir, RATING_FLOOR, 99);
      if (next !== p.ratings[key]) {
        p.ratings[key] = next;
        left -= 1;
      }
    }
  }
}

export interface CampResult {
  /** The age he played the new season at, after the birthday. */
  age: number;
  before: number;
  after: number;
  delta: number;
}

/**
 * Turn one year older and pay the curve. Whole rating points are spent now; the
 * fraction is banked in `xp` so a +0.6 winter is not silently lost, and a
 * −0.4 winter is remembered instead of rounding to a free pass.
 */
export function developPlayer(p: Player, rng: Rng): CampResult {
  const before = overall(p);
  p.age = clamp(Math.round(p.age) + 1, AGE_MIN, AGE_MAX);
  const mean = ageSwing(p.age);
  const spread = p.age <= 28 ? 1 : 1.3;
  const banked = Number.isFinite(p.xp) ? p.xp : 0;
  const swing = mean + rng.range(-spread, spread);
  // The trait scales the curve, not the banked fraction: a prodigy earns more
  // each winter without losing what he already carried over.
  const multiplier = isProdigy(p) ? (swing >= 0 ? PRODIGY_GROWTH : PRODIGY_DECLINE) : 1;
  const raw = swing * multiplier + banked;
  const points = Math.trunc(raw);
  p.xp = clamp(Number((raw - points).toFixed(3)), -0.95, 0.95);
  spendPoints(p, points, rng);
  const after = overall(p);
  return { age: p.age, before, after, delta: after - before };
}

/**
 * Run training camp over the whole roster. Called once, when the season ends,
 * before the draft class is generated, so a rookie is not aged in the same
 * winter he is signed.
 */
export function developRoster(franchise: Franchise, seed = franchise.season * 7919 + 101): DevelopmentReport {
  const rng = new Rng(seed);
  const entries: DevelopmentEntry[] = [];
  for (const p of franchise.roster) {
    const result = developPlayer(p, rng);
    entries.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      age: result.age,
      trait: p.trait ?? null,
      before: result.before,
      after: result.after,
      delta: result.delta,
    });
  }
  // Biggest movers first; the name breaks ties so the report is stable.
  entries.sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
  const report: DevelopmentReport = { season: franchise.season, entries };
  franchise.development = report;
  return report;
}

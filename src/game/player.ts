import type { Player, Pos, Ratings } from './types';

/**
 * Which ratings make up a player's grade. A cornerback is not paid for his arm,
 * so the same list has to feed the market price and the aging curve.
 */
export const POS_OVR_KEYS: Record<Pos, (keyof Ratings)[]> = {
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

/** The one number the whole game is written in. */
export function overall(p: Player): number {
  const keys = POS_OVR_KEYS[p.pos] ?? POS_OVR_KEYS.QB;
  return Math.round(keys.reduce((a, k) => a + p.ratings[k], 0) / keys.length);
}

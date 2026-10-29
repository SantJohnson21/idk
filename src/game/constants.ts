export const FIELD_LEN = 120;
export const FIELD_W = 53.333;
export const MID_Y = FIELD_W / 2;
export const ENDZONE = 10;
export const OWN_GOAL = 10; // field-x of the offense's own goal line
export const OPP_GOAL = 110; // field-x of the opponent's goal line
/** Where the ball goes over after a touchback, from the receiver's own goal line. */
export const TOUCHBACK_YARD = 20;
export const QUARTER_SECONDS = 78;
export const MAX_QUARTERS = 4;

/**
 * How long the line waits before it snaps for you, in seconds. It is a hurry, not a
 * deadline: `SNAP ▶` and a tap on the field both snap at once, and the count stops
 * while a finger is on the glass or a route menu is open. Long enough for a thumb to
 * find a receiver on a phone, which the old 1.15 s was not.
 */
export const READY_SECONDS = 2.8;

/** The tape market: what a roster can hold, and how the wire is priced. */
export const MARKET = {
  /** Veterans on the wire at once; a cleaned-out wire refills. */
  size: 6,
  /** Roster ceiling: the ten position minimums plus five bodies of depth. */
  rosterMax: 15,
  /** What a sale pays back, as a share of what the man would cost to sign. */
  sellRatio: 0.55,
};

export const TUNING = {
  playerRadius: 0.62,
  tackleRadius: 0.98,
  qbSpeed: 0.92,
  ballSpeed: 34,
  passRushReach: 1.0,
  staminaDrain: 7.5,
  staminaRegen: 2.2,
  burstCost: 34,
  audibleCost: 22,
  /** A punt that never gets away: the rush gets home, or the foot shanks it short. */
  puntBlock: 0.02,
  puntShank: 0.06,
  rewindStart: 2,
  rewindMax: 4,
  hypeFirstDown: 16,
  hypeBreakTackle: 7,
  hypeBigPlay: 12,
  hypeTouchdown: 26,
};

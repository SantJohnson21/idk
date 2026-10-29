export type RouteKey =
  | 'go'
  | 'post'
  | 'corner'
  | 'slant'
  | 'drag'
  | 'hitch'
  | 'curl'
  | 'out'
  | 'in'
  | 'flat'
  | 'wheel'
  | 'screen'
  | 'seam'
  | 'swing'
  | 'leak'
  | 'block';

export type RouteSlot = 'WR1' | 'WR2' | 'SLOT' | 'TE' | 'RB';

export interface RoutePoint {
  dx: number;
  dy: number;
}

export interface PlayDef {
  id: string;
  name: string;
  kind: 'pass' | 'run';
  risk: 1 | 2 | 3;
  blurb: string;
  tip: string;
  formation?: Partial<Record<RouteSlot, number>>;
  routes: Partial<Record<RouteSlot, RouteKey>>;
  runGap?: 'left' | 'mid' | 'right';
  runCarrier?: 'RB' | 'QB';
  handoffDelay?: number;
  playAction?: number;
}

const ROUTES: Record<RouteKey, (inSign: number, outSign: number) => RoutePoint[]> = {
  go: (_i, out) => [
    { dx: 0, dy: 0 },
    { dx: 6, dy: out * 0.6 },
    { dx: 38, dy: out * 1.5 },
  ],
  post: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 14, dy: 0 },
    { dx: 31, dy: inside * 11 },
  ],
  corner: (_i, out) => [
    { dx: 0, dy: 0 },
    { dx: 13, dy: 0 },
    { dx: 27, dy: out * 9 },
  ],
  slant: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 3, dy: 0 },
    { dx: 13, dy: inside * 7 },
  ],
  drag: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 4, dy: 0 },
    { dx: 15, dy: inside * 12 },
    { dx: 27, dy: inside * 17 },
  ],
  hitch: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 10, dy: 0 },
    { dx: 8, dy: -inside * 1.2 },
  ],
  curl: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 13, dy: 0 },
    { dx: 10.5, dy: -inside * 2 },
  ],
  out: (_i, out) => [
    { dx: 0, dy: 0 },
    { dx: 10, dy: 0 },
    { dx: 13, dy: out * 7 },
  ],
  in: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 11, dy: 0 },
    { dx: 14, dy: inside * 8 },
  ],
  flat: (_i, out) => [
    { dx: 0, dy: 0 },
    { dx: 2, dy: out * 2 },
    { dx: 6, dy: out * 7 },
    { dx: 14, dy: out * 8 },
  ],
  wheel: (_i, out) => [
    { dx: 0, dy: 0 },
    { dx: 5, dy: out * 3 },
    { dx: 24, dy: out * 3 },
  ],
  screen: (_i, out) => [
    { dx: -1.5, dy: 0 },
    { dx: -4.5, dy: out * 2 },
    { dx: -5, dy: out * 5 },
  ],
  seam: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 12, dy: 0 },
    { dx: 31, dy: inside * 3 },
  ],
  swing: (_i, out) => [
    { dx: -1, dy: 0 },
    { dx: 1, dy: out * 5 },
    { dx: 8, dy: out * 7 },
  ],
  leak: (inside) => [
    { dx: 0, dy: 0 },
    { dx: 5, dy: 0 },
    { dx: 18, dy: inside * 4 },
  ],
  block: () => [],
};

export function buildRoute(key: RouteKey, startY: number, midY: number): RoutePoint[] {
  const inside = startY < midY ? 1 : -1;
  return ROUTES[key](inside, -inside);
}

/**
 * The routes a receiver can be switched to at the line. Five shapes cover the whole
 * field — one to beat press, one to sit down in a soft zone, one to get outside the
 * numbers, one over the top, one across the middle — so the choice is about the
 * coverage you can see, not a menu of seventeen plays.
 */
export const HOT_ROUTES: RouteKey[] = ['slant', 'out', 'curl', 'go', 'drag'];

export const HOT_ROUTE_LABEL: Record<RouteKey, string> = {
  go: 'GO',
  post: 'POST',
  corner: 'CORNER',
  slant: 'SLANT',
  drag: 'DRAG',
  hitch: 'HITCH',
  curl: 'CURL',
  out: 'OUT',
  in: 'IN',
  flat: 'FLAT',
  wheel: 'WHEEL',
  screen: 'SCREEN',
  seam: 'SEAM',
  swing: 'SWING',
  leak: 'LEAK',
  block: 'BLOCK',
};

// Base alignment (sideline-to-sideline, 0..53.33). Top of screen = 0.
export const BASE_FORMATION: Record<RouteSlot, number> = {
  WR1: 6,
  WR2: 47.4,
  SLOT: 15.5,
  TE: 36.2,
  RB: 24.2,
};

export const PLAYBOOK: PlayDef[] = [
  {
    id: 'quick-slant',
    name: 'QUICK SLANT',
    kind: 'pass',
    risk: 1,
    blurb: 'Three-step drop. Ball out before the rush arrives.',
    tip: 'Beats the blitz. Tight window — hit it early.',
    routes: { WR1: 'slant', SLOT: 'drag', TE: 'flat', RB: 'swing', WR2: 'hitch' },
  },
  {
    id: 'hitch-hike',
    name: 'HITCH HIKE',
    kind: 'pass',
    risk: 1,
    blurb: 'Settle into the soft spot and take what they give you.',
    tip: 'Zone killer. Low risk, low reward.',
    routes: { WR1: 'hitch', WR2: 'hitch', SLOT: 'curl', TE: 'curl', RB: 'flat' },
  },
  {
    id: 'cross-fire',
    name: 'CROSS FIRE',
    kind: 'pass',
    risk: 2,
    blurb: 'Two crossers slice behind the linebackers.',
    tip: 'Great vs man. Wait for the traffic to clear.',
    routes: { WR1: 'drag', WR2: 'in', SLOT: 'post', TE: 'drag', RB: 'swing' },
  },
  {
    id: 'deep-post',
    name: 'DEEP POST',
    kind: 'pass',
    risk: 3,
    blurb: 'One shot. Everybody else stays in to protect.',
    tip: 'Max protection, max payoff. Don\'t be late.',
    routes: { WR1: 'post', WR2: 'go', SLOT: 'wheel', TE: 'seam', RB: 'block' },
  },
  {
    id: 'screen-door',
    name: 'SCREEN DOOR',
    kind: 'pass',
    risk: 1,
    blurb: 'Dump it wide and let the blockers go to work.',
    tip: 'Blitz buster. Get it out fast or lose yards.',
    formation: { WR1: 9, SLOT: 20, TE: 34 },
    routes: { WR1: 'screen', WR2: 'block', SLOT: 'block', TE: 'block', RB: 'block' },
  },
  {
    id: 'pa-bomb',
    name: 'PA BOMB',
    kind: 'pass',
    risk: 3,
    blurb: 'Sell the run, then launch it over the top.',
    tip: 'Slow to develop. Your line has to hold.',
    playAction: 0.8,
    routes: { WR1: 'corner', WR2: 'go', SLOT: 'wheel', TE: 'leak', RB: 'block' },
  },
  {
    id: 'dagger',
    name: 'DAGGER',
    kind: 'pass',
    risk: 2,
    blurb: 'Deep corner with a dig right underneath it.',
    tip: 'Two levels of stress. Find the open one.',
    routes: { WR1: 'corner', WR2: 'corner', SLOT: 'in', TE: 'drag', RB: 'flat' },
    formation: { SLOT: 19, TE: 33 },
  },
  {
    id: 'power-run',
    name: 'POWER RUN',
    kind: 'run',
    risk: 1,
    blurb: 'Downhill between the tackles. Old-school football.',
    tip: 'Safe yards. Follow your fullback\'s block.',
    runGap: 'mid',
    handoffDelay: 0.55,
    routes: { WR1: 'block', WR2: 'block', SLOT: 'block', TE: 'block', RB: 'block' },
  },
  {
    id: 'off-tackle',
    name: 'OFF TACKLE',
    kind: 'run',
    risk: 2,
    blurb: 'Stretch the edge and turn on the jets.',
    tip: 'Get outside the hash and hit the burst.',
    runGap: 'right',
    handoffDelay: 0.6,
    routes: { WR1: 'block', WR2: 'block', SLOT: 'block', TE: 'block', RB: 'block' },
  },
  {
    id: 'qb-keeper',
    name: 'QB KEEPER',
    kind: 'run',
    risk: 2,
    blurb: 'Nobody covers the quarterback. Make them pay.',
    tip: 'The defense bites on the back. Take off.',
    runGap: 'left',
    runCarrier: 'QB',
    handoffDelay: 0.7,
    routes: { WR1: 'block', WR2: 'block', SLOT: 'block', TE: 'block', RB: 'block' },
  },
  {
    id: 'toss-sweep',
    name: 'TOSS SWEEP',
    kind: 'run',
    risk: 3,
    blurb: 'Pitch it wide and race the corner to the pylon.',
    tip: 'Boom or bust. One cut and go.',
    runGap: 'right',
    handoffDelay: 0.45,
    routes: { WR1: 'block', WR2: 'block', SLOT: 'block', TE: 'block', RB: 'block' },
    formation: { RB: 21.5 },
  },
];

export const PLAY_BY_ID: Record<string, PlayDef> = Object.fromEntries(
  PLAYBOOK.map((p) => [p.id, p]),
);

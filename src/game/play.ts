import type { Player, PlayOutcome, TeamInfo, WeatherInfo } from './types';
import { FIELD_W, MID_Y, OPP_GOAL, OWN_GOAL, TOUCHBACK_YARD, TUNING } from './constants';
import { BASE_FORMATION, buildRoute, type PlayDef, type RouteKey, type RouteSlot } from './playbook';
import { Rng, clamp, dist } from './rng';

/**
 * The floor under the take-off tap zone, in field yards: the circle around the
 * quarterback that is his whatever the camera is doing. The UI widens it from here to
 * whatever a fingertip covers on screen (see `tapRadiusYards`), never narrows it.
 */
export const QB_TAP_CORE = 1.8;

/**
 * The floor under the hot-route tap, in field yards. A receiver is a smaller target
 * than the quarterback, so the menu opens on the man under the finger rather than on
 * the whole pocket — but the floor is the same idea: a fingertip's worth of field,
 * never a pinpoint.
 *
 * It is a thumb, not a pointer, because the line is looked at for a moment and then
 * hit while the count runs: at the camera's usual 11 px to the yard, 3.2 yards is a
 * ~35 px radius, so a tap that is merely *near* the man you meant opens him instead
 * of snapping the ball. Nearest man wins, so two receivers close together still
 * resolve the way the finger pointed.
 */
export const HOT_TAP_CORE = 3.2;

export interface SimInput {
  x: number;
  y: number;
  sprint: boolean;
}

export interface SimActor {
  id: number;
  side: 'off' | 'def';
  role: 'QB' | 'RB' | 'WR' | 'SLOT' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';
  slot?: RouteSlot;
  rosterId?: string;
  jersey: number;
  x: number;
  y: number;
  startY: number;
  vx: number;
  vy: number;
  speed: number;
  accel: number;
  arm: number;
  hands: number;
  blk: number;
  cov: number;
  tkl: number;
  pow: number;
  route: { dx: number; dy: number }[];
  routeIdx: number;
  routeDelay: number;
  routeDone: boolean;
  /** The route the player asked for at the line, if he changed this man's. */
  hot?: RouteKey;
  assignment: 'rush' | 'man' | 'zone' | 'deep' | 'block' | 'spy' | 'runfit';
  coverId: number | null;
  zone: { x: number; y: number } | null;
  hasBall: boolean;
  stunned: number;
  freeRush: number;
  swimTimer: number;
  blockTargetId: number | null;
  hitFlash: number;
  stamina: number;
  ironMan: boolean;
  magnet: boolean;
  fieldGeneral: boolean;
  broken: number;
  surge: number;
  facing: number;
  bob: number;
  jerseyColor: string;
  celebrate: number;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  state: 'held' | 'air' | 'dead';
  startX: number;
  startY: number;
  flight: number;
  time: number;
  targetId: number | null;
  throwerId: number | null;
}

export interface PassRead {
  actorId: number;
  slot: RouteSlot;
  projected: { x: number; y: number };
  percent: number;
  defenderDist: number;
  label: string;
}

export interface SimConfig {
  play: PlayDef;
  los: number; // field-x
  startSpot: number;
  roster: Player[];
  team: TeamInfo;
  opp: TeamInfo;
  oppDef: number;
  weather: WeatherInfo;
  energy: Record<string, number>;
  seed: number;
  quarter: number;
  closeGame: boolean;
}

const speedFrom = (rating: number) => 5.05 + clamp(rating, 30, 99) * 0.045;

function jersey(seed: number, offset: number) {
  return 1 + ((seed * 7 + offset * 13) % 88);
}

function nearest(actor: SimActor, list: SimActor[], filter?: (a: SimActor) => boolean) {
  let best: SimActor | null = null;
  let bd = Infinity;
  for (const a of list) {
    if (a === actor) continue;
    if (filter && !filter(a)) continue;
    const d = dist(actor.x, actor.y, a.x, a.y);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return { actor: best, d: bd };
}

export class PlaySim {
  readonly play: PlayDef;
  readonly los: number;
  readonly startSpot: number;
  readonly weather: WeatherInfo;
  /**
   * Footing, from the weather: 1 on a dry field, 0.98 rain/fog, 0.94 snow. It
   * slows the man carrying the ball — the cut that does not quite plant — rather
   * than the whole sim, which would only make the game run slower at the same
   * relative speed.
   */
  private readonly footing: number;
  readonly rng: Rng;
  readonly team: TeamInfo;
  readonly opp: TeamInfo;
  readonly config: SimConfig;

  actors: SimActor[] = [];
  offense: SimActor[] = [];
  defense: SimActor[] = [];
  /** Roster ids already sent out for this snap, so no man lines up in two places. */
  private fielded = new Set<string>();
  olActors: SimActor[] = [];
  dlActors: SimActor[] = [];
  byId = new Map<number, SimActor>();
  qb!: SimActor;
  carrier: SimActor | null = null;
  ball: BallState;
  phase: 'presnap' | 'dropback' | 'air' | 'carry' | 'dead' = 'presnap';
  result: PlayOutcome | null = null;
  started = false;
  elapsed = 0;
  totalElapsed = 0;
  deadTimer = 0;
  flash = 0;
  shake = 0;
  /**
   * Set by big moments (a broken tackle, a long score) and consumed by Match,
   * which plays the actual time dip. Impact decides the depth; 0 = nothing asked.
   */
  slowmoRequest = 0;
  freeText = '';
  freeTextTimer = 0;
  carryTime = 0;
  carryFromPass = false;
  /** True once the quarterback has pulled it down and taken off on a pass play. */
  scrambled = false;
  reads: PassRead[] = [];
  readsTimer = 0;
  events: string[] = [];
  energy: Record<string, number>;
  autoThrowAt = 5.9;
  throwerId: number | null = null;
  targetId: number | null = null;
  burstRequested = false;
  message = '';
  pointsLabel = '';

  constructor(cfg: SimConfig) {
    this.config = cfg;
    this.play = cfg.play;
    this.los = cfg.los;
    this.startSpot = cfg.startSpot;
    this.weather = cfg.weather;
    this.footing = clamp(1 + cfg.weather.speedMod, 0.9, 1);
    this.rng = new Rng(cfg.seed);
    this.team = cfg.team;
    this.opp = cfg.opp;
    this.energy = { ...cfg.energy };
    this.ball = {
      x: cfg.los,
      y: MID_Y,
      z: 0,
      state: 'dead',
      startX: cfg.los,
      startY: MID_Y,
      flight: 0,
      time: 0,
      targetId: null,
      throwerId: null,
    };
    this.build();
  }

  /**
   * The man who plays this spot. A healthy roster hands over its first man at the
   * position; a thin one — a receiver room the market sold down to a single wideout —
   * hands over somebody not already on the field, because one man cannot line up in
   * two places, and two actors sharing a roster id would split his stat line between
   * two jerseys.
   */
  private pickPlayer(pos: string, index: number): Player {
    const pool = this.config.roster.filter((p) => p.pos === pos);
    // The line is two names covering five spots on purpose: a second turn through them
    // is the design, not a shortage.
    if (pos === 'OL' && pool.length) {
      const pick = pool[index % pool.length];
      this.fielded.add(pick.id);
      return pick;
    }
    const natural = pool[index];
    if (natural && !this.fielded.has(natural.id)) {
      this.fielded.add(natural.id);
      return natural;
    }
    const spare =
      this.config.roster.find(
        (p) =>
          !this.fielded.has(p.id) &&
          (p.pos === 'WR' || p.pos === 'SLOT' || p.pos === 'TE' || p.pos === 'RB'),
      ) ??
      this.config.roster.find((p) => !this.fielded.has(p.id)) ??
      natural ??
      pool[0] ??
      this.config.roster[0];
    this.fielded.add(spare.id);
    return spare;
  }

  private build() {
    const cfg = this.config;
    const play = cfg.play;
    const formation = { ...BASE_FORMATION, ...(play.formation || {}) };
    const seed = cfg.seed % 9973;
    const runOffset = play.runGap === 'left' ? -5.2 : play.runGap === 'right' ? 5.2 : 0;
    const startY = play.kind === 'run' ? MID_Y + runOffset : formation.RB;

    const makeOff = (
      role: SimActor['role'],
      slot: RouteSlot | undefined,
      player: Player,
      x: number,
      y: number,
      routeKey?: PlayDef['routes'][RouteSlot],
      jerseyNum?: number,
    ): SimActor => {
      const q = player.quirk;
      const clutch = q === 'clutch' && cfg.quarter >= 4;
      const morale = clamp((player.morale - 70) / 12, -4, 4);
      const add = (v: number, bonus: number) => clamp(v + bonus + morale, 20, 99);
      let spd = add(player.ratings.spd, (q === 'burner' ? 6 : 0) + (clutch ? 7 : 0));
      let arm = add(player.ratings.arm, (q === 'cannon' ? 8 : 0) + (q === 'field_general' ? 6 : 0) + (clutch ? 7 : 0));
      let hands = add(player.ratings.hands, (q === 'sure_hands' ? 8 : 0) + (clutch ? 7 : 0));
      let blk = add(player.ratings.blk, clutch ? 7 : 0);
      let pow = add(player.ratings.pow, (q === 'bruiser' ? 6 : 0) + (clutch ? 7 : 0));
      const roleScale = role === 'QB' ? 0.97 : role === 'TE' ? 0.94 : role === 'RB' ? 1.0 : 0.99;
      const stamina = this.energy[player.id] ?? 100;
      const fatigue = 0.84 + (stamina / 100) * 0.16;
      const actor: SimActor = {
        id: this.actors.length + 1,
        side: 'off',
        role,
        slot,
        rosterId: player.id,
        jersey: jerseyNum ?? player.num,
        x,
        y,
        startY: y,
        vx: 0,
        vy: 0,
        speed: speedFrom(role === 'OL' ? Math.max(spd, blk) : spd) * roleScale * fatigue * (role === 'OL' ? 1.05 : 1),
        accel: role === 'OL' ? 45 : 30,
        arm,
        hands,
        blk,
        cov: 40,
        tkl: 40,
        pow,
        route: routeKey ? buildRoute(routeKey, y, MID_Y) : [],
        routeIdx: 0,
        routeDelay: play.playAction && (role === 'QB' || role === 'RB') ? play.playAction : 0,
        routeDone: false,
        assignment: routeKey === 'block' ? 'block' : 'man',
        coverId: null,
        zone: null,
        hasBall: false,
        stunned: 0,
        freeRush: 0,
        swimTimer: 1,
        blockTargetId: null,
        hitFlash: 0,
        stamina,
        ironMan: q === 'iron_man',
        magnet: q === 'magnet',
        fieldGeneral: q === 'field_general',
        broken: 0,
        surge: 0,
        facing: 0,
        bob: this.rng.range(0, 6.28),
        jerseyColor: cfg.team.colors.jersey,
        celebrate: 0,
      };
      this.actors.push(actor);
      this.offense.push(actor);
      this.byId.set(actor.id, actor);
      return actor;
    };

    const qbPlayer = this.pickPlayer('QB', 0);
    const rbPlayer = this.pickPlayer('RB', 0);
    const wrPlayers = [
      this.pickPlayer('WR', 0),
      this.pickPlayer('WR', 1),
      this.pickPlayer('WR', 2),
    ];
    const tePlayer = this.pickPlayer('TE', 0);
    const ol1 = this.pickPlayer('OL', 0);
    const ol2 = this.pickPlayer('OL', 1);

    // Offensive line
    const lineOffsets = [-3.15, -1.58, 0, 1.58, 3.15];
    lineOffsets.forEach((off, i) => {
      const lineman = i % 2 === 0 ? ol1 : ol2;
      makeOff('OL', undefined, lineman, this.los - 0.65, MID_Y + off, undefined, lineman.num + i);
    });

    // Quarterback
    // A designed keeper starts tighter to the line so the quarterback isn't
    // running four yards uphill into the defensive front.
    const qbDepth = this.play.kind === 'run' && this.play.runCarrier === 'QB' ? 3.2 : 4.4;
    this.qb = makeOff('QB', undefined, qbPlayer, this.los - qbDepth, MID_Y);

    // Skill positions
    makeOff('WR', 'WR1', wrPlayers[0], this.los, formation.WR1, play.routes.WR1, wrPlayers[0].num);
    makeOff('WR', 'WR2', wrPlayers[1], this.los, formation.WR2, play.routes.WR2, wrPlayers[1].num);
    makeOff('SLOT', 'SLOT', wrPlayers[2], this.los - 0.7, formation.SLOT, play.routes.SLOT, wrPlayers[2].num);
    makeOff('TE', 'TE', tePlayer, this.los - 0.7, formation.TE, play.routes.TE, tePlayer.num);
    makeOff('RB', 'RB', rbPlayer, this.los - 6.2, startY, play.routes.RB, rbPlayer.num);

    // Defense: 4-3 base, re-skinned for the opponent.
    const base = clamp(cfg.oppDef, 45, 96);
    const def = (role: SimActor['role'], x: number, y: number, attrs: Partial<SimActor>): SimActor => {
      const a: SimActor = {
        id: this.actors.length + 1,
        side: 'def',
        role,
        jersey: jersey(seed, this.defense.length + 1),
        x,
        y,
        startY: y,
        vx: 0,
        vy: 0,
        speed: 7.8,
        accel: 30,
        arm: 40,
        hands: 55,
        blk: 50,
        cov: base,
        tkl: base,
        pow: base,
        route: [],
        routeIdx: 0,
        routeDelay: this.rng.range(0, 0.25),
        routeDone: false,
        assignment: 'zone',
        coverId: null,
        zone: null,
        hasBall: false,
        stunned: 0,
        freeRush: 0,
        swimTimer: this.rng.range(0.8, 1.8),
        blockTargetId: null,
        hitFlash: 0,
        stamina: 100,
        ironMan: false,
        magnet: false,
        fieldGeneral: false,
        broken: 0,
        surge: 0,
        facing: Math.PI,
        bob: this.rng.range(0, 6.28),
        jerseyColor: cfg.opp.colors.jersey,
        celebrate: 0,
        ...attrs,
      };
      this.actors.push(a);
      this.defense.push(a);
      this.byId.set(a.id, a);
      return a;
    };

    const wr1Y = formation.WR1;
    const wr2Y = formation.WR2;
    const slotY = formation.SLOT;

    // Defensive line
    const dlYs = [-2.8, -0.95, 0.95, 2.8];
    dlYs.forEach((off, i) => {
      // Nose on the ball, not a yard into the backfield: the line has to earn
      // its penetration against the blockers instead of starting behind them.
      def('DL', this.los + 0.35 + this.rng.range(-0.08, 0.1), MID_Y + off, {
        speed: speedFrom(68 + this.rng.range(-4, 8)) * 1.01,
        pow: clamp(base + this.rng.range(-5, 9), 30, 99),
        tkl: clamp(base + this.rng.range(-8, 4), 30, 99),
        cov: 25,
        hands: 40,
        jersey: 70 + i * 4,
        assignment: 'rush',
      });
    });

    // Linebackers
    const lbYs = [MID_Y - 8.5, MID_Y, MID_Y + 8.5];
    lbYs.forEach((y, i) => {
      def('LB', this.los + 4.7 + i * 0.4, y, {
        speed: speedFrom(78 + this.rng.range(-2, 7)) * 0.98,
        cov: clamp(base + this.rng.range(-6, 7), 30, 99),
        tkl: clamp(base + this.rng.range(-2, 8), 30, 99),
        jersey: 50 + i * 2,
        assignment: 'runfit',
      });
    });

    // Cornerbacks
    def('CB', this.los + 4.6, wr1Y + 1.2, {
      speed: speedFrom(89 + this.rng.range(-4, 5)) * 1.02,
      cov: clamp(base + this.rng.range(0, 10), 30, 99),
      tkl: clamp(base - 14 + this.rng.range(-4, 4), 20, 99),
      jersey: 24,
      assignment: 'man',
    });
    def('CB', this.los + 4.6, wr2Y - 1.2, {
      speed: speedFrom(89 + this.rng.range(-4, 5)) * 1.02,
      cov: clamp(base + this.rng.range(0, 10), 30, 99),
      tkl: clamp(base - 14 + this.rng.range(-4, 4), 20, 99),
      jersey: 27,
      assignment: 'man',
    });

    // Safeties
    def('S', this.los + 14.5, MID_Y - 9.5, {
      speed: speedFrom(85 + this.rng.range(-3, 5)) * 1.0,
      cov: clamp(base + this.rng.range(-3, 8), 30, 99),
      tkl: clamp(base - 3 + this.rng.range(-3, 6), 20, 99),
      jersey: 31,
      assignment: 'deep',
    });
    def('S', this.los + 14.5, MID_Y + 9.5, {
      speed: speedFrom(85 + this.rng.range(-3, 5)) * 1.0,
      cov: clamp(base + this.rng.range(-3, 8), 30, 99),
      tkl: clamp(base - 3 + this.rng.range(-3, 6), 20, 99),
      jersey: 35,
      assignment: 'deep',
    });

    // A little flavor: elite defenses get a star in the secondary.
    if (base >= 82) {
      const cb = this.defense.find((a) => a.role === 'CB');
      if (cb) {
        cb.cov = clamp(cb.cov + 7, 30, 99);
        cb.speed *= 1.02;
        cb.jersey = 21;
      }
    }

    // Pass protection assignments: five linemen, four rushers — one doubles.
    this.olActors = this.offense.filter((a) => a.role === 'OL');
    this.dlActors = this.defense.filter((a) => a.role === 'DL');
    const taken = new Set<number>();
    for (const ol of this.olActors) {
      let best: SimActor | null = null;
      let bd = Infinity;
      for (const dl of this.dlActors) {
        if (taken.has(dl.id)) continue;
        const d = Math.abs(dl.y - ol.y);
        if (d < bd) {
          bd = d;
          best = dl;
        }
      }
      if (!best) {
        for (const dl of this.dlActors) {
          const d = Math.abs(dl.y - ol.y);
          if (d < bd) {
            bd = d;
            best = dl;
          }
        }
      }
      if (best) {
        ol.blockTargetId = best.id;
        taken.add(best.id);
      }
    }

    // Slot coverage: the strong safety handles the slot unless we're blitzing.
    this.assignCoverage();

    // Ball in the QB's hands for the snap.
    this.ball.x = this.qb.x - 0.35;
    this.ball.y = this.qb.y;
    this.ball.state = 'dead';
    this.carrier = null;
  }

  private get slotReceiver(): SimActor | undefined {
    return this.offense.find((a) => a.slot === 'SLOT');
  }

  private get eligible(): SimActor[] {
    return this.offense.filter((a) => a.slot !== undefined);
  }

  private assignCoverage() {
    const cbs = this.defense.filter((a) => a.role === 'CB');
    const safeties = this.defense.filter((a) => a.role === 'S');
    const lbs = this.defense.filter((a) => a.role === 'LB');
    const wr1 = this.offense.find((a) => a.slot === 'WR1');
    const wr2 = this.offense.find((a) => a.slot === 'WR2');
    const slot = this.offense.find((a) => a.slot === 'SLOT');
    const te = this.offense.find((a) => a.slot === 'TE');
    const rb = this.offense.find((a) => a.slot === 'RB');
    if (cbs[0] && wr1) {
      cbs[0].coverId = wr1.id;
      cbs[0].assignment = 'man';
    }
    if (cbs[1] && wr2) {
      cbs[1].coverId = wr2.id;
      cbs[1].assignment = 'man';
    }
    if (lbs[0] && te) {
      lbs[0].coverId = te.id;
      lbs[0].assignment = 'man';
    }
    if (lbs[1] && rb) {
      lbs[1].coverId = rb.id;
      lbs[1].assignment = 'man';
    }
    if (safeties[0] && slot) {
      safeties[0].coverId = slot.id;
      safeties[0].assignment = 'man';
    }
    if (safeties[1]) {
      safeties[1].assignment = 'deep';
      safeties[1].zone = { x: this.los + 22, y: MID_Y };
    }
    if (lbs[2]) {
      lbs[2].assignment = 'spy';
      lbs[2].zone = { x: this.los + 6, y: MID_Y };
    }
    for (const d of this.defense) {
      if (d.assignment === 'deep') {
        d.zone = { x: this.los + 24, y: d.y };
      }
    }
  }

  private assignProtection() {
    const rushers = this.defense.filter((d) => d.assignment === 'rush').sort((a, b) => a.x - b.x);
    const used = new Set<number>();
    for (const rusher of rushers) {
      let best: SimActor | null = null;
      let bd = Infinity;
      for (const ol of this.olActors) {
        if (used.has(ol.id)) continue;
        const d = Math.abs(ol.y - rusher.y);
        if (d < bd) {
          bd = d;
          best = ol;
        }
      }
      if (best) {
        best.blockTargetId = rusher.id;
        used.add(best.id);
      }
    }
    const free = this.olActors.find((o) => !used.has(o.id));
    if (free) {
      if (this.play.kind === 'run') {
        // On runs the spare lineman climbs to the second level instead of
        // doubling a tackle — otherwise the Mike sits unblocked in the hole
        // and every handoff dies at the line of scrimmage.
        const backers = this.defense.filter((d) => d.role === 'LB' || d.role === 'S');
        let climb: SimActor | null = null;
        let cd = Infinity;
        for (const b of backers) {
          const dd = Math.abs(b.y - free.y) + b.x * 0.05;
          if (dd < cd) {
            cd = dd;
            climb = b;
          }
        }
        if (climb) free.blockTargetId = climb.id;
      } else if (rushers[0]) {
        free.blockTargetId = rushers[0].id;
      }
    }
  }

  /** Called by the match when the defense call should change the coverage shell. */
  applyDefenseCall(call: 'man' | 'zone' | 'blitz' | 'runstuff' | 'prevent') {
    const dls = this.defense.filter((a) => a.role === 'DL');
    const lbs = this.defense.filter((a) => a.role === 'LB');
    const safeties = this.defense.filter((a) => a.role === 'S');
    const cbs = this.defense.filter((a) => a.role === 'CB');
    const slot = this.offense.find((a) => a.slot === 'SLOT');
    const te = this.offense.find((a) => a.slot === 'TE');
    const rb = this.offense.find((a) => a.slot === 'RB');

    for (const d of this.defense) {
      d.assignment = 'rush';
      d.coverId = null;
      d.zone = null;
    }

    if (call === 'man') {
      cbs[0].coverId = this.offense.find((a) => a.slot === 'WR1')?.id ?? null;
      cbs[1].coverId = this.offense.find((a) => a.slot === 'WR2')?.id ?? null;
      lbs[0].coverId = te?.id ?? null;
      lbs[1].coverId = rb?.id ?? null;
      lbs[2].coverId = slot?.id ?? null;
      for (const d of [...cbs, ...lbs]) d.assignment = 'man';
      safeties[0].assignment = 'deep';
      safeties[0].zone = { x: this.los + 23, y: MID_Y - 8 };
      safeties[1].assignment = 'deep';
      safeties[1].zone = { x: this.los + 23, y: MID_Y + 8 };
      dls.forEach((d) => (d.assignment = 'rush'));
    } else if (call === 'zone') {
      // Off-man matchups: every eligible receiver is accounted for, with a cushion.
      const wr1 = this.offense.find((a) => a.slot === 'WR1');
      const wr2 = this.offense.find((a) => a.slot === 'WR2');
      cbs[0].assignment = 'zone';
      cbs[0].coverId = wr1?.id ?? null;
      cbs[0].zone = { x: this.los + 4.5, y: 9 };
      cbs[1].assignment = 'zone';
      cbs[1].coverId = wr2?.id ?? null;
      cbs[1].zone = { x: this.los + 4.5, y: FIELD_W - 9 };
      lbs[0].assignment = 'zone';
      lbs[0].coverId = te?.id ?? null;
      lbs[0].zone = { x: this.los + 6, y: MID_Y - 11 };
      lbs[1].assignment = 'zone';
      lbs[1].coverId = rb?.id ?? null;
      lbs[1].zone = { x: this.los + 3.5, y: MID_Y + 13 };
      lbs[2].assignment = 'zone';
      lbs[2].coverId = null;
      lbs[2].zone = { x: this.los + 8, y: MID_Y };
      safeties[0].assignment = 'zone';
      safeties[0].coverId = slot?.id ?? null;
      safeties[0].zone = { x: this.los + 16, y: MID_Y - 11 };
      safeties[1].assignment = 'deep';
      safeties[1].zone = { x: this.los + 23, y: MID_Y + 6 };
      dls.forEach((d) => (d.assignment = 'rush'));
    } else if (call === 'blitz') {
      cbs[0].coverId = this.offense.find((a) => a.slot === 'WR1')?.id ?? null;
      cbs[1].coverId = this.offense.find((a) => a.slot === 'WR2')?.id ?? null;
      safeties[0].coverId = slot?.id ?? null;
      safeties[1].coverId = te?.id ?? null;
      for (const d of [...cbs, ...safeties]) d.assignment = 'man';
      lbs[0].assignment = 'zone';
      lbs[0].zone = { x: this.los + 7, y: MID_Y };
      lbs[1].assignment = 'man';
      lbs[1].coverId = rb?.id ?? null;
      lbs[2].assignment = 'rush';
      dls.forEach((d) => {
        d.assignment = 'rush';
        d.speed *= 1.04;
      });
    } else if (call === 'runstuff') {
      cbs[0].assignment = 'man';
      cbs[0].coverId = this.offense.find((a) => a.slot === 'WR1')?.id ?? null;
      cbs[1].assignment = 'man';
      cbs[1].coverId = this.offense.find((a) => a.slot === 'WR2')?.id ?? null;
      lbs[0].assignment = 'runfit';
      lbs[1].assignment = 'runfit';
      lbs[2].assignment = 'rush';
      safeties[0].assignment = 'runfit';
      safeties[1].assignment = 'deep';
      safeties[1].zone = { x: this.los + 21, y: MID_Y };
      dls.forEach((d) => (d.assignment = 'rush'));
    } else {
      // prevent: rush three, everybody else bails deep
      dls[0].assignment = 'rush';
      dls[1].assignment = 'rush';
      dls[2].assignment = 'rush';
      dls[3].assignment = 'zone';
      dls[3].zone = { x: this.los + 15, y: MID_Y };
      lbs.forEach((d, i) => {
        d.assignment = 'zone';
        d.zone = { x: this.los + 18, y: MID_Y + (i - 1) * 11 };
      });
      cbs.forEach((d, i) => {
        d.assignment = 'zone';
        d.zone = { x: this.los + 26, y: MID_Y + (i === 0 ? -14 : 14) };
      });
      safeties.forEach((d, i) => {
        d.assignment = 'deep';
        d.zone = { x: this.los + 32, y: MID_Y + (i === 0 ? -8 : 8) };
      });
    }

    // Man cover defenders start with their eyes on the receiver. A defender
    // matched to a backfield receiver (the running back) must keep his depth:
    // squeezing him up to the line turns every handoff into an instant tackle.
    for (const d of this.defense) {
      if (d.assignment === 'man' && d.coverId) {
        const rec = this.byId.get(d.coverId);
        if (!rec || rec.x < this.los - 0.5) continue;
        const minX = d.role === 'CB' ? this.los + 1.1 : d.role === 'LB' ? this.los + 3.2 : this.los + 5.5;
        d.x = Math.max(minX, Math.min(this.los + 9, rec.x + this.rng.range(1.4, 3.0)));
        d.y = rec.y + this.rng.range(-1.3, 1.3);
      }
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.phase = 'dropback';
    this.qb.hasBall = true;
    this.carrier = this.qb;
    if (this.play.kind === 'pass') this.throwerId = this.qb.id;
    this.events.push('snap');
    this.assignProtection();
    this.ball.state = 'held';
    this.ball.x = this.qb.x;
    this.ball.y = this.qb.y;
    this.flash = 0.2;
    if (this.play.kind === 'run') {
      this.message = this.play.runCarrier === 'QB' ? 'KEEP IT!' : 'HANDOFF';
    } else {
      this.message = 'BALL SNAPPED';
    }
    this.freeText = this.message;
    this.freeTextTimer = 1.1;
    this.readsTimer = 0;
  }

  /**
   * A throw that never happened is not a pass: once the quarterback takes off, the
   * snap goes on the sheet as a run in every branch that asks.
   */
  private get passPlay(): boolean {
    return this.play.kind === 'pass' && !this.scrambled;
  }

  get pressure(): number {
    if (this.phase !== 'dropback') return 0;
    const nearestRusher = nearest(this.qb, this.defense, (a) => a.assignment === 'rush');
    if (!nearestRusher.actor) return 0;
    return clamp(100 - (nearestRusher.d - 1.1) * 28, 0, 100);
  }

  get isPass(): boolean {
    return this.play.kind === 'pass';
  }

  activateBurst() {
    if (!this.carrier) return;
    this.carrier.surge = 0.9;
    this.carrier.stamina = Math.max(0, this.carrier.stamina - 4);
    this.flash = 0.3;
    this.burstRequested = true;
    this.freeText = 'HYPE BURST!';
    this.freeTextTimer = 0.9;
  }

  /**
   * Take off with the quarterback instead of throwing. Only from a live pocket on a
   * pass play, and only while he still has the ball — once it is out of his hand
   * there is nothing to scramble with.
   *
   * From then on the snap is a run in everything but the play card: the same carry,
   * the same pursuit, the same tackles, so a scramble that dies behind the line is
   * a loss on the ground rather than a sack on the passer, and never a pass attempt.
   */
  scramble(): boolean {
    if (this.scrambled || this.phase !== 'dropback') return false;
    if (this.play.kind !== 'pass' || !this.qb.hasBall) return false;
    const qb = this.qb;
    this.scrambled = true;
    this.carrier = qb;
    this.phase = 'carry';
    this.carryTime = 0;
    this.carryFromPass = false;
    // Nobody threw it, so nobody is the thrower any more: the stat sheet reads this
    // as the quarterback's own run.
    this.throwerId = null;
    // A take-off is not a handoff. He starts from a standstill in the pocket, so the
    // escape is real but the head start belongs to the backs.
    qb.vx = Math.max(qb.vx, 4.4);
    this.freeText = 'SCRAMBLE!';
    this.freeTextTimer = 0.9;
    this.flash = 0.12;
    this.events.push('scramble');
    return true;
  }

  /** Whether the line is still open for a route change on this snap. */
  get canHotRoute(): boolean {
    return !this.started && this.phase === 'presnap' && this.play.kind === 'pass';
  }

  /**
   * Change a receiver's route at the line — the Madden hot route, at home in a game
   * that already asks you to read the coverage before the snap. It is the same route
   * a play card would hand him, rebuilt off his own alignment, so it beats coverage
   * the same way; nothing else about the snap moves and the defender already matched
   * to him stays matched, which is what makes the read honest.
   *
   * Only before the snap, only on a pass play, and only for a man who is actually
   * running one: the back staying in to protect and the man taking the handoff are
   * not receivers on this snap and cannot be made into one.
   */
  setHotRoute(slot: RouteSlot, key: RouteKey): boolean {
    if (!this.canHotRoute) return false;
    const a = this.offense.find((x) => x.slot === slot);
    if (!a || !a.route.length) return false;
    a.route = buildRoute(key, a.startY, MID_Y);
    a.routeIdx = 0;
    a.routeDone = false;
    a.hot = key;
    return true;
  }

  /**
   * The receiver a tap at the line is asking about — the man under the finger, if he
   * is one whose route can be changed. Null is "nobody", and the match snaps the ball
   * instead, so the line keeps its old tap-to-snap feel everywhere except on a
   * receiver.
   */
  hotRouteAt(x: number, y: number, radius: number): RouteSlot | null {
    if (!this.canHotRoute) return null;
    let best: { slot: RouteSlot; d: number } | null = null;
    for (const a of this.offense) {
      if (!a.slot || !a.route.length) continue;
      const d = dist(a.x, a.y, x, y);
      if (d > Math.max(radius, HOT_TAP_CORE)) continue;
      if (!best || d < best.d) best = { slot: a.slot, d };
    }
    return best?.slot ?? null;
  }

  /**
   * Whose tap is this: the quarterback's (a take-off) or somebody else's (a throw)?
   *
   * `radius` is in field yards and comes from the caller sizing a fingertip against
   * the camera: on a phone the field runs at roughly 11 px to the yard, so the old
   * fixed 1.8 yards was barely 20 px of screen — half a touch target. The zone is
   * never smaller than {@link QB_TAP_CORE}, so every tap that used to be a take-off
   * still is.
   *
   * What keeps the wider zone from stealing throws is the receiver test: a receiver
   * standing nearer to the tap than the quarterback — the back swinging out beside
   * him, the checkdown in the flat — owns it, exactly as he did before the zone grew.
   * Ties go to the receiver, so the throw keeps every tap it used to win.
   */
  tapIntent(x: number, y: number, radius: number): 'qb' | 'throw' {
    if (this.phase !== 'dropback' || !this.qb.hasBall) return 'throw';
    const dQb = dist(x, y, this.qb.x, this.qb.y);
    if (dQb > Math.max(radius, QB_TAP_CORE)) return 'throw';
    for (const a of this.eligible) {
      // Nobody can be thrown to yet on a play fake, so nobody can claim the tap.
      if (a.slot === 'RB' && this.play.playAction && this.elapsed < this.play.playAction) continue;
      // The same lead `throwTo` aims at, so the two can never disagree about who is nearest.
      if (dist(a.x + a.vx * 0.55, a.y + a.vy * 0.55, x, y) <= dQb) return 'throw';
    }
    return 'qb';
  }

  throwTo(x: number, y: number) {
    if (this.phase !== 'dropback' || !this.qb.hasBall) return;
    const options = this.eligible;
    let best: { actor: SimActor; d: number } | null = null;
    for (const a of options) {
      if (a.slot === 'RB' && this.play.playAction && this.elapsed < this.play.playAction) continue;
      const px = a.x + a.vx * 0.55;
      const py = a.y + a.vy * 0.55;
      const d = dist(px, py, x, y);
      if (!best || d < best.d) best = { actor: a, d };
    }
    const primary = best && best.d < 11 ? best.actor : null;
    const tx = clamp(x, 3, 117);
    const ty = clamp(y, 1.2, FIELD_W - 1.2);
    const distance = dist(this.qb.x, this.qb.y, tx, ty);

    // Accuracy: arm rating, distance, pressure and weather all matter.
    const clutter = this.pressure / 100;
    const errBase = 0.5 + distance * 0.027 + this.weather.accuracyMod * 0.5 + clutter * 1.5;
    const errScale = clamp(1.35 - this.qb.arm * 0.008, 0.25, 0.75);
    const spread = errBase * errScale;
    const aimX = clamp(tx + this.rng.gauss(0, spread), 2, 118);
    const aimY = clamp(ty + this.rng.gauss(0, spread), 0.8, FIELD_W - 0.8);
    const flight = clamp(distance / 33 + 0.22, 0.35, 2.1);

    this.throwerId = this.qb.id;
    this.targetId = primary?.id ?? null;
    this.qb.hasBall = false;
    this.carrier = null;
    this.phase = 'air';
    this.elapsed = 0;
    this.ball = {
      x: this.qb.x,
      y: this.qb.y,
      z: 1.1,
      state: 'air',
      startX: this.qb.x,
      startY: this.qb.y,
      flight,
      time: 0,
      targetId: primary?.id ?? null,
      throwerId: this.qb.id,
    };
    this.ballTarget = { x: aimX, y: aimY };
    this.freeText = primary ? `BALL OUT` : 'THROWN AWAY';
    this.freeTextTimer = 0.7;
    this.events.push('throw');

    // Keep coverage assignments intact — only nearby defenders break on the ball.
    for (const a of options) {
      if (a !== primary) {
        a.assignment = 'block';
        a.routeDone = true;
      }
    }
    if (primary) {
      primary.assignment = 'man';
      primary.coverId = null;
    }
  }

  ballTarget: { x: number; y: number } = { x: 0, y: 0 };

  /** Projected read on each receiver, for the on-field catch % badges. */
  getReads(): PassRead[] {
    if (this.phase !== 'dropback') return this.reads;
    const out: PassRead[] = [];
    for (const a of this.eligible) {
      if (!a.slot) continue;
      const lead = 0.85;
      const px = a.x + a.vx * lead;
      const py = a.y + a.vy * lead;
      const { actor: nearDef, d } = nearest(a, this.defense);
      const open01 = clamp((d - 0.5) / 4, 0, 1);
      let pct = 0.7 + (a.hands - 70) * 0.005 - (1 - open01) * 0.24 + this.weather.catchMod;
      if (a.magnet) pct += 0.06;
      pct = clamp(pct, 0.08, 0.9);
      out.push({
        actorId: a.id,
        slot: a.slot,
        projected: { x: px, y: py },
        percent: Math.round(pct * 100),
        defenderDist: d,
        label: nearDef ? String(Math.round(pct * 100)) : 'OPEN',
      });
    }
    return out;
  }

  private moveActor(a: SimActor, tx: number, ty: number, speedFactor: number, dt: number, accel = a.accel) {
    const dx = tx - a.x;
    const dy = ty - a.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    let desired = 0;
    if (d > 0.18) {
      const sp = a.speed * speedFactor;
      const dvx = (dx / d) * sp;
      const dvy = (dy / d) * sp;
      a.vx += (dvx - a.vx) * Math.min(1, accel * dt);
      a.vy += (dvy - a.vy) * Math.min(1, accel * dt);
      desired = sp;
    } else {
      a.vx *= Math.max(0, 1 - 10 * dt);
      a.vy *= Math.max(0, 1 - 10 * dt);
    }
    const blockDrag = a.side === 'def' ? this.defenderDrag(a) : 1;
    const stun = a.stunned > 0 ? 0.12 : 1;
    a.x += a.vx * dt * blockDrag * stun;
    a.y += a.vy * dt * blockDrag * stun;
    a.facing = Math.atan2(a.vy, a.vx);
    if (Math.hypot(a.vx, a.vy) > 0.4) {
      a.bob += dt * (5 + Math.hypot(a.vx, a.vy));
    }
    if (desired === 0) {
      a.vx = 0;
      a.vy = 0;
    }
  }

  private defenderDrag(defender: SimActor): number {
    if (defender.freeRush > 0) return 1;
    let drag = 1;
    for (const blocker of this.offense) {
      if (blocker.stunned > 0 || blocker.hasBall) continue;
      if (blocker.role !== 'OL' && blocker.assignment !== 'block') continue;
      const d = dist(blocker.x, blocker.y, defender.x, defender.y);
      const reach = blocker.role === 'OL' ? 1.4 : 1.05;
      if (d < reach) {
        const proximity = clamp(1 - d / reach, 0, 1);
        const base = blocker.role === 'OL' ? 0.9 : 0.42;
        const strength = clamp(base + (blocker.blk - defender.pow) * 0.008, 0.2, 0.99);
        drag = Math.min(drag, clamp(1 - strength * proximity * 1.85, 0.06, 1));
      }
    }
    return drag;
  }

  private tickStamina(a: SimActor, dt: number) {
    if (a.side !== 'off' || !a.rosterId) return;
    const speed = Math.hypot(a.vx, a.vy);
    let drain = 0;
    if (a.hasBall) drain = 0.55 + speed * 0.09;
    else if (a.role === 'WR' || a.role === 'SLOT' || a.role === 'TE') drain = 0.16 + speed * 0.02;
    else if (a.role === 'OL') drain = 0.12;
    else if (a.role === 'QB') drain = 0.05;
    else drain = 0.08;
    if (a.surge > 0) drain += 0.9;
    if (a.ironMan) drain *= 0.65;
    a.stamina = clamp(a.stamina - drain * dt, 0, 100);
    this.energy[a.rosterId] = a.stamina;
  }

  update(dtRaw: number, input: SimInput) {
    if (!this.started) return;
    const dt = Math.min(dtRaw, 1 / 30);
    this.elapsed += dt;
    this.totalElapsed += dt;
    this.freeTextTimer = Math.max(0, this.freeTextTimer - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt * 1.9);
    this.readsTimer -= dt;

    if (this.phase === 'dead') {
      this.deadTimer += dt;
      for (const a of this.actors) a.hitFlash = Math.max(0, a.hitFlash - dt);
      return;
    }

    for (const a of this.actors) {
      a.stunned = Math.max(0, a.stunned - dt);
      a.surge = Math.max(0, a.surge - dt);
      a.freeRush = Math.max(0, a.freeRush - dt);
      a.hitFlash = Math.max(0, a.hitFlash - dt);
      this.tickStamina(a, dt);
    }

    if (this.phase === 'dropback') this.updateDropback(dt, input);
    else if (this.phase === 'air') this.updateAir(dt);
    else if (this.phase === 'carry') this.updateCarry(dt, input);

    if (this.readsTimer <= 0) {
      this.reads = this.getReads();
      this.readsTimer = 0.12;
    }

    // Ball placement follows the carrier.
    if (this.ball.state === 'held' && this.carrier) {
      this.ball.x = this.carrier.x + Math.cos(this.carrier.facing) * 0.35;
      this.ball.y = this.carrier.y + Math.sin(this.carrier.facing) * 0.35;
    }

    // Lose the ball if the carrier somehow leaves the field of play.
    if (this.carrier && this.carrier.hasBall) {
      this.checkCarryEnd(input);
    }

    // Hard safety net: never let a play run forever.
    if (this.totalElapsed > 26) {
      const endX = this.carrier?.x ?? this.qb.x;
      this.finish('run', endX, {
        description: 'The whistle blows. Play over.',
        headline: 'END OF PLAY',
        carrierId: this.carrier?.rosterId,
      });
    }
  }

  private updateDropback(dt: number, input: SimInput) {
    // Push the stick in the pocket and the quarterback takes off: a drag across the
    // field is the same gesture on a phone, and tapping him goes straight to
    // scramble(). Only a pass play offers the escape — keeping it on a run play is
    // the designed handoff, not a scramble — and only once the pocket has formed, so
    // a direction held from the snap is not an accidental take-off.
    if (this.qb.hasBall && this.elapsed > 0.6 && Math.hypot(input.x, input.y) > 0.55) {
      if (this.scramble()) return;
    }
    const qb = this.qb;
    const pass = this.play.kind === 'pass';
    const playAction = this.play.playAction ?? 0;

    // QB drop and pocket movement.
    if (pass) {
      const targetDepth = this.los - (this.elapsed < 0.5 ? 4.4 + this.elapsed * 5 : 6.6);
      let slideY = MID_Y + Math.sin(this.elapsed * 1.1) * 0.35;
      const rush = this.defense.filter((d) => d.assignment === 'rush');
      const closest = rush.reduce<{ a: SimActor | null; d: number }>((acc, d) => {
        const dd = dist(d.x, d.y, qb.x, qb.y);
        return dd < acc.d ? { a: d, d: dd } : acc;
      }, { a: null, d: Infinity });
      if (closest.a && closest.d < 3.4) {
        const away = qb.y - closest.a.y;
        slideY = MID_Y + Math.sign(away || 1) * 4.2;
      }
      this.moveActor(qb, this.los - 6.6, clamp(slideY, MID_Y - 6, MID_Y + 6), 0.82, dt, 26);
      const danger = nearest(qb, this.defense, (d) => d.assignment === 'rush');
      if (this.elapsed > 1.3 && danger.d < 1.25) {
        const reads = this.getReads();
        const best = reads.slice().sort((a, b) => b.percent - a.percent)[0];
        if (best) {
          const a = this.byId.get(best.actorId);
          if (a) this.throwTo(a.x + a.vx * 0.55, a.y + a.vy * 0.55);
        }
      }
      if (this.elapsed > this.autoThrowAt) {
        const reads = this.getReads();
        const best = reads.slice().sort((a, b) => b.percent - a.percent)[0];
        if (best) {
          const a = this.byId.get(best.actorId);
          if (a) this.throwTo(a.x + a.vx * 0.6, a.y + a.vy * 0.6);
        } else {
          this.finish('incomplete', this.los, {
            description: 'Nobody open. Thrown away.',
            headline: 'INCOMPLETE',
          });
        }
      }
    } else {
      // Runs: ride the fake, then hand off.
      const delay = this.play.handoffDelay ?? 0.6;
      this.moveActor(qb, this.los - 3.6, MID_Y + (this.play.runGap === 'left' ? 1.8 : this.play.runGap === 'right' ? -1.8 : 0), 0.9, dt);
      if (this.elapsed >= delay && qb.hasBall) {
        const carrier = this.play.runCarrier === 'QB' ? qb : this.offense.find((a) => a.slot === 'RB');
        if (carrier) {
          qb.hasBall = false;
          carrier.hasBall = true;
          this.carrier = carrier;
          this.carryTime = 0;
          this.carryFromPass = false;
          if (this.play.runCarrier !== 'QB') {
            carrier.vx = Math.max(carrier.vx, 7.4);
            carrier.vy += this.play.runGap === 'right' ? 2.2 : this.play.runGap === 'left' ? -2.2 : 0;
          } else {
            carrier.vx = Math.max(carrier.vx, 5.2);
          }
          this.phase = 'carry';
          this.freeText = premierCarrierText(carrier);
          this.freeTextTimer = 1;
          this.flash = 0.1;
        }
      }
    }

    this.updateBlockers(dt);
    this.updateRoutes(dt);
    this.updateDefense(dt, false);

    // Sack check — only rushers can get home, not a linebacker in coverage.
    if (qb.hasBall && this.phase === 'dropback') {
      const threat = nearest(qb, this.defense, (d) => d.assignment === 'rush');
      if (threat.actor && threat.d < 0.95) {
        const defender = threat.actor;
        qb.hitFlash = 0.4;
        this.addShake(
          clamp(0.14 + Math.hypot(qb.vx - defender.vx, qb.vy - defender.vy) * 0.02, 0.14, 0.34),
        );
        if (qb.x <= OWN_GOAL + 0.1) {
          this.finish('safety', qb.x, {
            description: `Sacked in the end zone. Two points for ${this.opp.abbr}.`,
            headline: 'SAFETY',
            scored: true,
            defenderId: defender.id,
          });
        } else if (this.rng.chance(0.025)) {
          this.finish('fumble', qb.x, {
            description: `SACKED AND STRIPPED! ${this.opp.abbr} recovers.`,
            headline: 'FUMBLE!',
            turnover: true,
            defenderId: defender.id,
          });
        } else {
          this.finish('sack', qb.x, {
            description: `Sacked by #${defender.jersey} for a loss of ${Math.max(1, Math.round(this.los - qb.x))}.`,
            headline: 'SACKED',
            defenderId: defender.id,
          });
        }
      }
    }
  }

  private updateBlockers(dt: number) {
    const runPlay = this.play.kind === 'run';
    // A scramble drill turns the receivers into blockers the way a called run does:
    // the quarterback is the ball carrier now, so they go find a body.
    const scramble = this.scrambled && this.phase !== 'dropback';
    for (const a of this.offense) {
      if (a.hasBall) continue;
      if (a.role === 'QB') continue;
      const isLineman = a.role === 'OL';
      // The back taking the handoff is not a blocker — if he blocks first he
      // arrives at the line in the pile and every run dies at the LOS.
      const isRunCarrier = runPlay && this.play.runCarrier !== 'QB' && a.slot === 'RB';
      if (isRunCarrier) continue;
      const shouldBlock = a.assignment === 'block' || isLineman || ((runPlay || scramble) && a.slot);
      if (!shouldBlock) continue;
      a.assignment = 'block';
      let target = a.blockTargetId ? this.byId.get(a.blockTargetId) : undefined;
      if (!target) {
        const myTarget = nearest(a, this.defense);
        target = myTarget.actor ?? undefined;
      }
      if (!target) continue;
      const qbOrCarrier = this.carrier && this.carrier.hasBall ? this.carrier : this.qb;
      const dx = qbOrCarrier.x - target.x;
      const dy = qbOrCarrier.y - target.y;
      const dl = Math.hypot(dx, dy) || 1;
      let gx = target.x + (dx / dl) * 0.55;
      let gy = target.y + (dy / dl) * 0.55;
      if (isLineman) {
        // Hold a pocket wall instead of retreating onto the quarterback.
        if (runPlay) {
          gx = target.x - 0.25;
          gy = target.y + Math.sin(this.elapsed * 2 + a.id) * 0.5;
        } else {
          gx = target.x + (dx / dl) * 0.65;
          // Hold the wall until the rusher gets a step, then chase him down.
          if (target.x >= this.los - 2.4) gx = Math.max(gx, this.los - 2.6);
          gx = Math.max(gx, this.los - 7.2);
          gy = target.y + (dy / dl) * 0.35;
        }
      } else if (a.slot === 'WR1' || a.slot === 'WR2' || a.slot === 'SLOT' || a.slot === 'TE') {
        // Wideouts block the nearest defender in front of the runner, not the pile.
        const runner = this.carrier ?? this.qb;
        const candidates = this.defense.filter((d) => d.x > a.x - 3 && d.x < runner.x + 10);
        let closest: SimActor | null = null;
        let closeD = Infinity;
        for (const d of candidates) {
          const dd = dist(d.x, d.y, a.x, a.y);
          if (dd < closeD) {
            closeD = dd;
            closest = d;
          }
        }
        if (closest) {
          gx = closest.x + 0.2;
          gy = closest.y;
        }
      }
      this.moveActor(a, gx, gy, runPlay ? 0.98 : 0.9, dt, 30);
    }
  }

  private updateRoutes(dt: number) {
    if (this.play.kind !== 'pass') {
      // On runs, receivers release to block.
      return;
    }
    if (this.phase === 'air') {
      const target = this.targetId ? this.byId.get(this.targetId) : null;
      if (target) {
        this.moveActor(target, this.ballTarget.x, this.ballTarget.y, 1.04, dt, 30);
      }
      for (const a of this.offense) {
        if (a === target || !a.slot) continue;
        if (a.assignment === 'block') {
          const nearDef = nearest(a, this.defense);
          if (nearDef.actor) this.moveActor(a, nearDef.actor.x, nearDef.actor.y, 0.75, dt);
        } else {
          const p = a.route[a.routeIdx];
          if (p) {
            this.moveActor(a, this.los + p.dx, a.y, 0.9, dt);
          }
        }
      }
      return;
    }
    for (const a of this.offense) {
      if (!a.slot || a.hasBall || a.role === 'QB' || a.role === 'OL') continue;
      if (this.play.playAction && this.elapsed < (this.play.playAction ?? 0) && a.slot === 'RB') {
        const block = nearest(a, this.defense);
        if (block.actor) this.moveActor(a, block.actor.x, block.actor.y, 0.8, dt);
        continue;
      }
      if (a.route.length === 0) continue;
      const p = a.route[a.routeIdx];
      if (!p) {
        a.routeDone = true;
        // Settle into open space.
        this.moveActor(a, a.x + Math.cos(a.facing) * 0.4, a.y + Math.sin(a.facing) * 0.4, 0.3, dt);
        continue;
      }
      const tx = this.los + p.dx;
      // Never let a receiver run out of the back of the end zone before the ball.
      const ty = clamp(a.y + p.dy - (a.routeIdx === 0 ? 0 : 0), 1.3, FIELD_W - 1.3);
      const waypointY = clamp(this.baseY(a) + p.dy, 1.3, FIELD_W - 1.3);
      this.moveActor(a, tx, waypointY, 0.98, dt, 28);
      if (dist(a.x, a.y, tx, waypointY) < 0.7) {
        a.routeIdx = Math.min(a.route.length - 1, a.routeIdx + 1);
        if (a.routeIdx === a.route.length - 1 && dist(a.x, a.y, this.los + a.route[a.routeIdx].dx, waypointY) < 0.8) {
          a.routeDone = true;
        }
      }
    }
  }

  private baseY(a: SimActor) {
    const formation = { ...BASE_FORMATION, ...(this.play.formation || {}) };
    if (a.slot) return formation[a.slot];
    return a.y;
  }

  private updateDefense(dt: number, ballInAir: boolean) {
    const threat = this.carrier ?? this.qb;
    const runPlay = (this.play.kind === 'run' || this.scrambled) && this.phase !== 'dropback';
    const rushDelay = this.play.playAction ?? 0;
    for (const d of this.defense) {
      if (d.stunned > 0) continue;
      if (d.role === 'DL') {
        if (this.phase === 'carry') {
          this.moveActor(d, threat.x, threat.y, 0.95, dt);
        } else if (ballInAir) {
          this.moveActor(d, this.ballTarget.x, this.ballTarget.y, 0.8, dt);
        } else {
          // Pass rush with a swim move.
          const engaged = this.offense.some(
            (o) => o.role === 'OL' && dist(o.x, o.y, d.x, d.y) < 1.5,
          );
          if (engaged && this.elapsed > 0.9) {
            d.swimTimer -= dt;
            if (d.swimTimer <= 0) {
              d.swimTimer = this.rng.range(1.5, 2.6);
              if (this.rng.chance(clamp(0.09 + (d.pow - 65) * 0.006, 0.05, 0.28))) {
                d.freeRush = 0.45;
              }
            }
          }
          // Wide rush lanes instead of a straight line through the center.
          const lane = Math.sin(this.elapsed * 1.4 + d.id) * 1.1;
          this.moveActor(
            d,
            this.qb.x + (this.qb.y > d.y ? 0.4 : -0.4),
            this.qb.y + (d.y < MID_Y ? -0.8 : 0.8) + lane * 0.35,
            0.94,
            dt,
          );
        }
        continue;
      }

      if (ballInAir) {
        const gap = dist(d.x, d.y, this.ballTarget.x, this.ballTarget.y);
        const deepBall = this.ballTarget.x > this.los + 11;
        const breaks = gap < 12.5 || (d.role === 'S' && deepBall);
        if (breaks) {
          this.moveActor(d, this.ballTarget.x, this.ballTarget.y, 1.02, dt);
          continue;
        }
        // Otherwise stay with the man / zone responsibility.
      }

      if (this.phase === 'carry') {
        const baseReact = this.carryFromPass ? 0.02 : 0.18;
        const react = baseReact + (d.role === 'LB' ? 0.04 : d.role === 'S' ? 0.12 : 0.18);
        if (this.carryTime > react) {
          const gap = dist(d.x, d.y, threat.x, threat.y);
          const lead = clamp(gap / 9.5, 0.12, 1.15);
          const hustle = this.carryFromPass ? 1.12 : d.role === 'LB' ? 0.94 : 0.99;
          this.moveActor(
            d,
            threat.x + threat.vx * lead,
            threat.y + threat.vy * lead,
            hustle,
            dt,
          );
        } else {
          this.moveActor(d, threat.x, threat.y, 0.8, dt);
        }
        continue;
      }

      if (d.assignment === 'rush') {
        this.moveActor(d, this.qb.x, this.qb.y, 0.94, dt);
      } else if (d.assignment === 'man' && d.coverId) {
        const rec = this.byId.get(d.coverId);
        if (rec) {
          const sep = clamp(1.4 - (d.cov - 60) * 0.012, 0.5, 1.6);
          // A defender matched to a backfield receiver scrapes to the hole instead
          // of chasing him into the backfield — otherwise he is a free blitzer
          // standing in the running lane before the handoff lands.
          const backfield = rec.x < this.los - 0.3 && !rec.hasBall;
          const targetX = backfield ? this.los + 2.6 : rec.x - 0.25;
          this.moveActor(
            d,
            targetX,
            rec.y + Math.sin(this.elapsed * 1.7 + d.id) * 0.35,
            backfield ? 0.82 : 0.98,
            dt,
            26,
          );
          if (!backfield && dist(rec.x, rec.y, d.x, d.y) > 5.5) {
            // Beaten badly: take a recovery angle.
            this.moveActor(d, rec.x + 0.3, rec.y, 1.06, dt, 26);
          }
          void sep;
        }
      } else if (d.assignment === 'deep') {
        const z = d.zone ?? { x: this.los + 24, y: d.y };
        // Cover the deepest threat on this half of the field.
        let deepest: SimActor | null = null;
        let maxX = -Infinity;
        for (const a of this.offense) {
          if (!a.slot) continue;
          const sameHalf = (a.y < MID_Y) === (z.y < MID_Y) || Math.abs(a.y - z.y) < 14;
          if (sameHalf && a.x > maxX) {
            maxX = a.x;
            deepest = a;
          }
        }
        if (deepest && deepest.x > this.los + 8) {
          this.moveActor(d, deepest.x - 1.8, deepest.y, 1.0, dt, 28);
        } else {
          this.moveActor(d, z.x, z.y, 0.8, dt);
        }
      } else if (d.assignment === 'zone') {
        const rec = d.coverId ? this.byId.get(d.coverId) : null;
        if (rec) {
          // Off coverage: give ground early, then squeeze the receiver as the route develops.
          const base = d.role === 'CB' ? 3.4 : d.role === 'S' ? 5.0 : 2.4;
          const squeeze = clamp((this.elapsed - 0.45) / 2.1, 0, 1);
          const cushion = 0.8 + base * (1 - squeeze * 0.82);
          const targetX = rec.x + cushion;
          this.moveActor(d, targetX, rec.y + Math.sin(this.elapsed * 1.5 + d.id) * 0.2, 1.0, dt, 32);
        } else if (d.zone) {
          this.moveActor(d, d.zone.x, d.zone.y, 0.82, dt);
        }
      } else if (d.assignment === 'runfit') {
        if (runPlay) {
          this.moveActor(d, threat.x, threat.y, 1.02, dt);
        } else {
          this.moveActor(d, this.los + 5, d.y + Math.sin(this.elapsed * 2 + d.id) * 0.5, 0.62, dt);
        }
      } else if (d.assignment === 'spy') {
        if (runPlay) this.moveActor(d, threat.x, threat.y, 1.0, dt);
        else this.moveActor(d, this.qb.x + 1.8, this.qb.y, 0.9, dt);
      }
      // Play-action keeps the rush honest for a beat.
      if (rushDelay > 0 && this.elapsed < rushDelay) {
        d.vx *= 0.97;
        d.vy *= 0.97;
      }
    }
  }

  private updateAir(dt: number) {
    const ball = this.ball;
    ball.time += dt;
    const t = clamp(ball.time / ball.flight, 0, 1);
    ball.x = ball.startX + (this.ballTarget.x - ball.startX) * t;
    ball.y = ball.startY + (this.ballTarget.y - ball.startY) * t;
    const arc = Math.sin(Math.PI * t);
    ball.z = 1 + arc * clamp(ball.flight * 4.5, 2, 8);
    this.updateRoutes(dt);
    this.updateDefense(dt, true);
    if (t >= 1) {
      this.resolveCatch();
    }
  }

  private resolveCatch() {
    const spot = this.ballTarget;
    this.ball.x = spot.x;
    this.ball.y = spot.y;
    this.ball.z = 0;
    this.ball.state = 'dead';
    const eligible = this.eligible;
    let receiver: SimActor | null = null;
    let rdist = Infinity;
    for (const a of eligible) {
      const d = dist(a.x, a.y, spot.x, spot.y);
      if (d < rdist) {
        rdist = d;
        receiver = a;
      }
    }
    let defender: SimActor | null = null;
    let ddist = Infinity;
    for (const d of this.defense) {
      const dd = dist(d.x, d.y, spot.x, spot.y);
      if (dd < ddist) {
        ddist = dd;
        defender = d;
      }
    }
    const catchable = receiver && rdist < 4.4 && spot.y > 0.4 && spot.y < FIELD_W - 0.4;

    if (!catchable || !receiver) {
      this.events.push('incomplete');
      this.finish('incomplete', spot.x, {
        description: 'The pass falls incomplete.',
        headline: 'INCOMPLETE',
        receiverId: receiver?.rosterId ?? undefined,
        airYards: Math.round(spot.x - this.los),
      });
      return;
    }

    // Defender gets a shot at the ball if he's closer than the receiver.
    const deflectChance = ddist < rdist - 0.25 ? clamp(0.22 + (ddist < 1.0 ? 0.2 : 0) - (receiver.hands - 70) * 0.004, 0.05, 0.55) : 0;
    if (defender && this.rng.chance(deflectChance)) {
      if (this.rng.chance(0.52)) {
        defender.hasBall = true;
        this.events.push('intercept');
        this.finish('interception', spot.x, {
          description: `#${defender.jersey} jumps the route. Turnover.`,
          headline: 'INTERCEPTED!',
          turnover: true,
          defenderId: defender.id,
          airYards: Math.round(spot.x - this.los),
        });
        return;
      }
      this.events.push('deflect');
      this.finish('incomplete', spot.x, {
        description: `#${defender.jersey} breaks it up at the last second.`,
        headline: 'BROKEN UP',
        defenderId: defender.id,
        airYards: Math.round(spot.x - this.los),
      });
      return;
    }

    const open = clamp((ddist - 0.5) / 4, 0, 1);
    let chance = 0.79 - rdist * 0.12 + (receiver.hands - 70) * 0.005;
    chance -= (1 - open) * 0.24;
    chance += this.weather.catchMod;
    if (receiver.magnet) chance += 0.06;
    chance = clamp(chance, 0.12, 0.94);
    if (!this.rng.chance(chance)) {
      this.events.push('drop');
      this.finish('incomplete', spot.x, {
        description: `${this.playerName(receiver)} can't hang on. Incomplete.`,
        headline: ddist < 1.8 ? 'BROKEN UP' : 'DROPPED',
        receiverId: receiver.rosterId,
        defenderId: defender?.id,
        airYards: Math.round(spot.x - this.los),
      });
      return;
    }

    // Catch!
    receiver.hasBall = true;
    receiver.assignment = 'man';
    receiver.routeDone = true;
    this.carrier = receiver;
    this.phase = 'carry';
    this.elapsed = 0;
    this.carryTime = 0;
    this.carryFromPass = true;
    this.flash = 0.16;
    this.freeText = ddist < 1.6 ? 'CONTESTED CATCH!' : 'CAUGHT!';
    this.freeTextTimer = 0.9;
    this.events.push('catch');
    this.ball.state = 'held';
    if (spot.x >= OPP_GOAL) {
      this.finish('touchdown', OPP_GOAL, {
        description: `${this.playerName(receiver)} secures it in the end zone!`,
        headline: 'TOUCHDOWN!',
        receiverId: receiver.rosterId,
        airYards: Math.round(spot.x - this.los),
        scored: true,
      });
      return;
    }
    // Defenders now have to chase.
    for (const d of this.defense) {
      d.assignment = d.role === 'DL' ? 'rush' : 'zone';
      d.coverId = null;
      d.zone = { x: receiver.x, y: receiver.y };
      d.stunned = Math.max(d.stunned, this.rng.range(0, 0.12));
    }
  }

  private updateCarry(dt: number, input: SimInput) {
    const carrier = this.carrier;
    if (!carrier || !carrier.hasBall) return;
    this.carryTime += dt;
    if (carrier.x >= OPP_GOAL - 0.05) {
      this.finish('touchdown', OPP_GOAL, {
        description: `${this.playerName(carrier)} crosses the goal line!`,
        headline: 'TOUCHDOWN!',
        carrierId: carrier.rosterId,
        receiverId: this.carryFromPass ? carrier.rosterId : undefined,
        scored: true,
      });
      return;
    }
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    // A handoff back hits the hole faster than a defender can scrape over the
    // top of a block; without this the whole defense converges before he
    // reaches the line of scrimmage.
    const staminaFactor = (0.8 + (carrier.stamina / 100) * 0.2) * (this.carryFromPass ? 0.96 : 1.02);
    const surge = carrier.surge > 0 ? 1.34 : 1;
    const sprint = input.sprint ? 1.08 : 1;
    let speed = carrier.speed * staminaFactor * surge * sprint * this.footing;
    let tx = carrier.x + 8;
    let ty = carrier.y;
    if (mag > 0.16) {
      const nx = input.x / (Math.hypot(input.x, input.y) || 1);
      const ny = input.y / (Math.hypot(input.x, input.y) || 1);
      tx = carrier.x + nx * 6;
      ty = carrier.y + ny * 6;
      speed *= 0.55 + 0.45 * mag;
    } else {
      // Keep the play alive if the player lifts their thumb.
      speed *= 0.8;
      const centerPull = (MID_Y - carrier.y) * 0.06;
      ty = carrier.y + centerPull;
    }
    this.moveActor(carrier, tx, ty, speed / carrier.speed, dt, 34);
    if (carrier.surge > 0) this.addShake(0.12);
    if (input.sprint) {
      carrier.stamina = clamp(carrier.stamina - 6 * dt, 0, 100);
      if (carrier.rosterId) this.energy[carrier.rosterId] = carrier.stamina;
    }

    // Downfield blockers.
    this.updateBlockers(dt);
    this.updateDefense(dt, false);

    // Track close defenders. A defender tied up with a blocker can't finish the tackle.
    let closest: SimActor | null = null;
    let closestD = Infinity;
    for (const d of this.defense) {
      if (d.stunned > 0) continue;
      const dd = dist(d.x, d.y, carrier.x, carrier.y);
      const engaged = this.offense.some(
        (b) =>
          b !== carrier &&
          (b.role === 'OL' || b.assignment === 'block') &&
          dist(b.x, b.y, d.x, d.y) < 1.1,
      );
      const reach = engaged ? 0.5 : TUNING.tackleRadius + 0.05;
      if (dd < reach && dd < closestD) {
        closestD = dd;
        closest = d;
      }
    }
    if (closest && this.carryTime > (this.carryFromPass ? 0.1 : 0.05)) {
      const impact = this.contactTrauma(carrier, closest);
      this.flash = 0.2;
      this.addShake(impact);
      closest.hitFlash = 0.35;
      const tackleRoll = this.rng.next();
      const breakChance =
        0.05 +
        clamp((carrier.pow - closest.tkl) * 0.0035, -0.025, 0.16) +
        (carrier.stamina / 100) * 0.03 +
        (carrier.surge > 0 ? 0.9 : 0);
      if (carrier.surge <= 0 && carrier.broken < 3 && tackleRoll < breakChance) {
        carrier.broken++;
        closest.stunned = 0.7;
        closest.vx = -closest.vx * 0.4;
        carrier.stamina = clamp(carrier.stamina - 3, 0, 100);
        if (carrier.rosterId) this.energy[carrier.rosterId] = carrier.stamina;
        this.freeText = 'BROKEN TACKLE!';
        this.freeTextTimer = 0.9;
        this.flash = 0.25;
        // A shrug-off is the moment worth stretching. The harder the collision,
        // the deeper the dip, so a shoestring miss barely registers.
        this.slowmoRequest = Math.max(this.slowmoRequest, 0.34 + impact * 0.85);
        this.events.push('break');
      } else {
        this.tackled(carrier, closest);
        return;
      }
    }

    // Jukes: sharp cuts freeze nearby pursuers.
    if (mag > 0.5 && Math.hypot(carrier.vx, carrier.vy) > 4.2) {
      const heading = Math.atan2(input.y, input.x);
      const diff = Math.abs(normalizeAngle(heading - carrier.facing));
      if (diff > 1.9) {
        for (const d of this.defense) {
          if (d.stunned > 0) continue;
          if (dist(d.x, d.y, carrier.x, carrier.y) < 2.3 && this.rng.chance(0.3)) {
            d.stunned = Math.max(d.stunned, 0.32);
          }
        }
      }
    }
  }

  /**
   * Camera trauma, 0..1. The renderer squares it, so a routine hit is a nudge
   * and only a genuinely big one moves the frame.
   */
  private addShake(trauma: number) {
    this.shake = Math.min(0.6, Math.max(this.shake, trauma));
  }

  /** Hits read by feel: closing speed plus the strength mismatch at contact. */
  private contactTrauma(carrier: SimActor, defender: SimActor): number {
    const closing = Math.hypot(carrier.vx - defender.vx, carrier.vy - defender.vy);
    const mismatch = clamp((defender.tkl - carrier.pow) / 45, -0.6, 0.6);
    return clamp(0.1 + closing * 0.013 + mismatch * 0.12, 0.1, 0.36);
  }

  private tackled(carrier: SimActor, defender: SimActor) {
    defender.hitFlash = 0.4;
    this.addShake(this.contactTrauma(carrier, defender) + 0.05);
    this.flash = 0.3;
    this.events.push('tackle');
    const goal = carrier.x <= OWN_GOAL;
    if (this.rng.chance(0.014)) {
      this.finish('fumble', carrier.x, {
        description: `${this.playerName(carrier)} fumbles! ${this.opp.abbr} falls on it.`,
        headline: 'FUMBLE!',
        turnover: true,
        defenderId: defender.id,
        carrierId: carrier.rosterId,
      });
      return;
    }
    if (goal) {
      this.finish('safety', carrier.x, {
        description: `Tackled in the end zone. Two points for ${this.opp.abbr}.`,
        headline: 'SAFETY',
        scored: true,
        defenderId: defender.id,
        carrierId: carrier.rosterId,
      });
      return;
    }
    const distToGoal = OPP_GOAL - carrier.x;
    const headline =
      distToGoal < 2.2 ? 'STUFFED AT THE 1' : carrier.broken > 0 ? 'BROKEN TACKLE' : 'TACKLED';
    this.finish(this.passPlay ? 'pass' : 'run', carrier.x, {
      description: `${this.playerName(carrier)} brought down by #${defender.jersey} after ${Math.max(
        0,
        Math.round(carrier.x - this.los),
      )} yards.`,
      headline,
      defenderId: defender.id,
      carrierId: carrier.rosterId,
    });
  }

  private checkCarryEnd(input: SimInput) {
    const carrier = this.carrier;
    if (!carrier) return;
    if (carrier.x >= OPP_GOAL) {
      this.finish('touchdown', OPP_GOAL, {
        description: `${this.playerName(carrier)} takes it to the house!`,
        headline: 'TOUCHDOWN!',
        carrierId: carrier.rosterId,
        scored: true,
      });
      return;
    }
    if (carrier.y < 0.55 || carrier.y > FIELD_W - 0.55) {
      // Do not end a play on the snap frame due to a route starting wide.
      this.finish(this.passPlay ? 'pass' : 'run', carrier.x, {
        description: `${this.playerName(carrier)} pushed out of bounds at the ${yardLabel(carrier.x)}.`,
        headline: 'OUT OF BOUNDS',
        carrierId: carrier.rosterId,
        outOfBounds: true,
      });
      return;
    }
    void input;
  }

  playerName(a: SimActor): string {
    if (!a.rosterId) return `#${a.jersey}`;
    const p = this.config.roster.find((x) => x.id === a.rosterId);
    return p ? p.name : `#${a.jersey}`;
  }

  private finish(
    kind: PlayOutcome['kind'],
    endX: number,
    opts: {
      description: string;
      headline: string;
      turnover?: boolean;
      scored?: boolean;
      outOfBounds?: boolean;
      receiverId?: string;
      carrierId?: string;
      defenderId?: number;
      airYards?: number;
    },
  ) {
    if (this.result) return;
    // The ground the ball actually covered, unclamped: a loss is a loss even
    // when the play dies in an end zone.
    const flightSpot = Math.round(endX - OWN_GOAL);
    const isPass = this.passPlay;
    const touchdown = kind === 'touchdown';
    const turnover = opts.turnover ?? (kind === 'interception' || kind === 'fumble');
    const incomplete = kind === 'incomplete';
    // A play that dies behind our own goal line is a safety, whatever ended it —
    // a sack, a tackle, a step out of bounds. The ball is dead in our end zone,
    // so the rule outranks the play kind that killed it.
    const safety = kind === 'safety' || (!touchdown && !incomplete && !turnover && endX < OWN_GOAL);
    // A takeaway killed at the far end of the field is a touchback: the ball goes
    // over at their 20 rather than being spotted where the defender was caught.
    const touchback = !safety && kind === 'interception' && flightSpot > 99;
    // A takeaway killed behind our own goal line is their touchdown: the defender
    // caught the ball in the end zone he attacks, so he never has to run it in.
    const defensiveScore = !safety && !touchback && turnover && flightSpot < 0;
    // Every other dead ball is spotted on the field of play. A pass that hits the
    // turf comes back to where it was snapped; the landing spot only ever tells
    // the player how far the ball was thrown.
    const endSpot = incomplete
      ? this.startSpot
      : touchdown
        ? 100
        : safety || defensiveScore
          ? 0
          : touchback
            ? 100 - TOUCHBACK_YARD
            : deadBallSpot(flightSpot);
    // A safety is charged the ground actually lost, not the distance to the line
    // it is spotted on.
    const yards = incomplete ? 0 : safety ? Math.min(0, flightSpot - this.startSpot) : endSpot - this.startSpot;
    const defender = opts.defenderId ? this.byId.get(opts.defenderId) : null;
    this.phase = 'dead';
    this.deadTimer = 0;
    this.result = {
      kind: safety ? 'safety' : kind,
      yards: touchdown ? Math.max(yards, 100 - this.startSpot) : yards,
      endSpot,
      scored: opts.scored ?? touchdown,
      touchdown,
      turnover: Boolean(turnover),
      defensiveScore,
      incomplete,
      outOfBounds: opts.outOfBounds ?? kind === 'incomplete',
      timeUsed: Math.max(2.5, this.totalElapsed + 2.2),
      description:
        safety && kind !== 'safety'
          ? `Down in our own end zone — ${this.opp.abbr} scores two.`
          : defensiveScore
            ? kind === 'interception'
              ? `#${defender?.jersey ?? '—'} takes it the other way into our end zone. ${this.opp.abbr} scores.`
              : `${this.opp.abbr} falls on it in our end zone. Touchdown.`
            : touchback
              ? 'Picked off in the end zone. Touchback: they take over on their 20.'
              : opts.description,
      headline:
        safety && kind !== 'safety'
          ? 'SAFETY!'
          : defensiveScore
            ? kind === 'interception'
              ? 'PICK SIX!'
              : 'SCOOP AND SCORE!'
            : touchback
              ? 'TOUCHBACK'
              : opts.headline,
      carrierId: opts.carrierId ?? (this.carrier ? this.carrier.rosterId : undefined),
      receiverId: opts.receiverId ?? (this.targetId ? this.byId.get(this.targetId)?.rosterId : undefined),
      throwerId: this.throwerId ? this.byId.get(this.throwerId)?.rosterId : undefined,
      defenderId: defender ? String(defender.jersey) : undefined,
      airYards: opts.airYards ?? (isPass ? Math.round(flightSpot - this.startSpot) : undefined),
      isPass,
      bigPlay: !defensiveScore && (Math.abs(yards) >= 20 || touchdown),
      brokenTackles: this.offense.reduce((sum, a) => sum + a.broken, 0),
      hypeGain: 0,
    };
    if (kind === 'sack') {
      // A sack is a swing of its own, and how far the pocket collapsed is the
      // measure of it: a stumble on his own doorstep barely reads, a twelve-yard
      // loss lands.
      this.slowmoRequest = Math.max(this.slowmoRequest, sackDip(Math.abs(yards)));
    } else if (kind === 'interception') {
      // A pick is as big as what it hands over: how close to our own goal line
      // the defender went down with it, plus how far the throw had to travel.
      this.slowmoRequest = Math.max(
        this.slowmoRequest,
        interceptionDip(endSpot, opts.airYards ?? 0),
      );
    }
    if (kind === 'touchdown') {
      // Only a score that came from distance earns the stretch; a plunge from
      // the 1 is a jolt, not a highlight.
      if (Math.abs(yards) >= 25) {
        this.slowmoRequest = Math.max(
          this.slowmoRequest,
          clamp(0.45 + (Math.abs(yards) - 25) * 0.006, 0.45, 0.78),
        );
      }
      this.events.push('td');
      this.freeText = 'TOUCHDOWN!';
      this.freeTextTimer = 2;
      this.flash = 0.6;
      // Longer the score, bigger the jolt: 0.42 from the goal line, 0.55 from deep.
      this.addShake(clamp(0.42 + Math.abs(yards) * 0.0035, 0.42, 0.55));
      const carrier = this.carrier;
      if (carrier) carrier.celebrate = 1;
    }
    if (this.ball.state === 'held') this.ball.state = 'dead';
    // Write energy back one last time.
    for (const a of this.offense) {
      if (a.rosterId) this.energy[a.rosterId] = a.stamina;
    }
  }
}

/**
 * How deep a sack stretches time. Depth of loss is the whole measure: the sim
 * still runs at a little over half speed on the worst of them, and a sack for
 * no gain is a nudge rather than a stop.
 */
/**
 * Where a dead ball is spotted. A ball is either in an end zone — a score or a
 * safety, both decided before this is asked — or on the field of play, so
 * nothing ever rounds onto a goal line: half a yard short is the 99, and half a
 * yard from our own line is the 1.
 */
export function deadBallSpot(flightSpot: number): number {
  return clamp(Math.round(flightSpot), 1, 99);
}

export function sackDip(yardsLost: number): number {
  return clamp(0.28 + Math.abs(yardsLost) * 0.022, 0.28, 0.56);
}

/**
 * How deep an interception stretches time. The size of a takeaway is the ground
 * it hands over, so a pick near our own goal line dips furthest and a pick in
 * the opponent's end zone barely reads; a deep throw to get there adds to it.
 */
export function interceptionDip(endSpot: number, airYards: number): number {
  const swing = clamp((60 - endSpot) / 60, 0, 1);
  const air = clamp(airYards / 35, 0, 1);
  return clamp(0.34 + swing * 0.3 + air * 0.14, 0.34, 0.78);
}

export function yardLabel(fieldX: number): string {
  const spot = clamp(fieldX - OWN_GOAL, 0, 100);
  if (spot <= 50) return `OWN ${Math.round(spot)}`;
  return `${Math.round(100 - spot)}`;
}

/**
 * A field position in the result deck's own words: a tackle on our 1 reads OWN 1
 * and one on their 1 reads OPP 1, so the spot is never just a bare yardage.
 */
export function spotLabel(spot: number): string {
  const s = clamp(Math.round(spot), 0, 100);
  if (s <= 50) return `OWN ${s}`;
  return `OPP ${100 - s}`;
}

/**
 * Where the next snap is spotted, for the result deck. A score is not spotted —
 * the ball goes to a kickoff — and a dead ball we lost belongs to them, so the
 * label comes from the spot the match hands them rather than from where we died.
 */
export function nextSpotLabel(outcome: PlayOutcome, theirStart?: number): string | null {
  if (outcome.scored || outcome.touchdown || outcome.defensiveScore || outcome.kind === 'safety') {
    return null;
  }
  if (outcome.turnover && typeof theirStart === 'number') return spotLabel(100 - theirStart);
  return spotLabel(outcome.endSpot);
}

function normalizeAngle(a: number) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function premierCarrierText(a: SimActor) {
  return a.role === 'QB' ? 'KEEP IT!' : 'HIT THE HOLE!';
}

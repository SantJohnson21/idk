import type {
  Franchise,
  GameState,
  GameStats,
  MatchPhase,
  OpponentDrive,
  PlayLogEntry,
  PlayOutcome,
  Player,
  StatLine,
  TeamInfo,
  WeekSchedule,
  WeatherInfo,
} from './types';
import { QUARTER_SECONDS, OWN_GOAL, READY_SECONDS, TUNING } from './constants';
import { PLAYBOOK, type PlayDef, type RouteKey, type RouteSlot } from './playbook';
import { PlaySim, type SimInput } from './play';
import { Rng, clamp } from './rng';
import {
  emptyStatLine,
  getTeam,
  opponentStrength,
  rewindStart,
  simulateOpponentDrive,
  type GameSummary,
} from './season';
import { QUIRKS, WEATHER } from './data';
import {
  FILM_HZ,
  FilmRecorder,
  KEEP_FILMS,
  REEL_DEPTH,
  REEL_HOLD,
  applyFilm,
  buildFilm,
  filmWindow,
  pickReel,
  type Film,
  type ReelState,
} from './film';

export type DefenseCall = 'man' | 'zone' | 'blitz' | 'runstuff' | 'prevent';

export const DEFENSE_HINT: Record<DefenseCall, { label: string; short: string; tone: string }> = {
  man: { label: 'MAN COVERAGE', short: 'MAN', tone: '#ffd166' },
  zone: { label: 'SOFT ZONE', short: 'ZONE', tone: '#7dd3fc' },
  blitz: { label: 'ALL-OUT BLITZ', short: 'BLITZ', tone: '#ff5d73' },
  runstuff: { label: 'LOADED BOX', short: 'BOX', tone: '#f9a8d4' },
  prevent: { label: 'DEEP SHELL', short: 'SHELL', tone: '#a7f3d0' },
};

/**
 * The slow-motion setting, as multipliers on a dip: how deep it goes and how
 * long it holds. Nothing else about a big moment changes — the camera shake,
 * the haptics and the crowd all behave the same whatever this is set to.
 */
const SLOWMO: Record<'off' | 'short' | 'full', { depth: number; time: number }> = {
  full: { depth: 1, time: 1 },
  short: { depth: 0.6, time: 0.6 },
  off: { depth: 0, time: 0 },
};

/**
 * How many overtime periods a postseason game may play before the walk-off
 * fallback settles it. Eight scoreless periods is already pathological; the cap
 * exists so a stuck simulation can never hang a season.
 */
export const MAX_OVERTIME_PERIODS = 8;

export interface KickState {
  pos: number;
  dir: number;
  speed: number;
  perfectHalf: number;
  goodHalf: number;
  distance: number;
  active: boolean;
  quality?: number;
}

interface Snapshot {
  state: GameState;
  stats: GameStats;
  energy: Record<string, number>;
  cards: PlayDef[];
  defenseCall: DefenseCall;
  opponentStartSpot: number;
  turnoverOnDowns: boolean;
  /** How much of the drive log existed when the snap was taken. */
  logLength: number;
}

export interface MatchConfig {
  franchise: Franchise;
  opponent: TeamInfo;
  week: WeekSchedule;
  weather: WeatherInfo;
  seed?: number;
  onEvent?: (name: string) => void;
}

/**
 * The loose-ball beat after a blocked punt. Everything is already decided when
 * this starts: it exists so a block lands as a scramble on the field, with the
 * deck reading out what it cost only after the kicking team falls on it.
 */
export interface BlockFx {
  /** Seconds into the beat. */
  t: number;
  /** How long the beat runs before the whistle. */
  hold: number;
  /** Our own yard line it was snapped from, and where the ball comes to rest. */
  fromYard: number;
  toYard: number;
}

export class Match {
  readonly franchise: Franchise;
  readonly opponent: TeamInfo;
  readonly week: WeekSchedule;
  readonly weather: WeatherInfo;
  readonly onEvent?: (name: string) => void;
  readonly rng: Rng;

  state: GameState;
  stats: GameStats = {};
  energy: Record<string, number> = {};
  phase: MatchPhase = 'kickoff';
  cards: PlayDef[] = [];
  defenseCall: DefenseCall = 'man';
  sim?: PlaySim;
  lastOutcome?: PlayOutcome;
  snapshot?: Snapshot;
  kick?: KickState;
  /** Set while a blocked punt is loose; the renderer draws the scramble. */
  blockFx?: BlockFx;
  drive?: OpponentDrive;
  driveRevealed = 0;
  driveApplied = false;
  driveTimer = 0;
  driveHold = 0;
  readyTimer = 0;
  /** The count this snap started with, so the deck's bar can drain in proportion. */
  readyTotal = READY_SECONDS;
  /** A finger on the field stops the count where it is. */
  readyHold = false;
  rewindFx = 0;
  /** Sim clock rate: 1 is real time, dipping below for a beat on a big moment. */
  timeScale = 1;
  /** How deep that dip currently is, 0..1. The renderer draws this. */
  slowmoK = 0;
  private slowmoLeft = 0;
  private slowmoTotal = 0;
  private slowmoDepth = 0;
  overtimeReady = false;
  /** Postseason overtime periods played. A match is one game, so it never resets. */
  overtimePeriods = 0;
  paused = false;
  version = 0;
  highlights: string[] = [];
  /** Our own snaps this drive, for the pause panel's drive log. */
  playLog: PlayLogEntry[] = [];
  /** Raw film of the snap in progress; kept only if the play becomes a moment. */
  private recorder?: FilmRecorder;
  /** The half's moments, trimmed to the best few as they arrive. */
  private films: Film[] = [];
  /** The halftime reel, if this half produced anything worth rewatching. */
  reel?: ReelState;
  totalYards = 0;
  touchdowns = 0;
  opponentStartSpot = 25;
  turnoverOnDowns = false;
  snapToGo = 10;
  snapSpot = 25;
  snapDown = 1;
  stick: SimInput = { x: 0, y: 0, sprint: false };
  stickScreen: { active: boolean; ox: number; oy: number; x: number; y: number } = {
    active: false,
    ox: 0,
    oy: 0,
    x: 0,
    y: 0,
  };
  private listeners = new Set<() => void>();
  private playCounter = 0;
  private finishedSummary?: GameSummary;
  /**
   * The receiver whose route menu is open at the line, if any. While it is set the
   * snap count is held, so choosing a route is a decision rather than a race — and
   * nothing else about the snap moves.
   */
  hotSlot: RouteSlot | null = null;

  constructor(cfg: MatchConfig) {
    this.franchise = cfg.franchise;
    this.opponent = cfg.opponent;
    this.week = cfg.week;
    this.weather = cfg.weather;
    this.onEvent = cfg.onEvent;
    this.rng = new Rng(cfg.seed ?? Date.now() % 1000000);
    const maxRewinds = TUNING.rewindStart + cfg.franchise.rewindLevel;
    this.state = {
      quarter: 1,
      clock: QUARTER_SECONDS,
      down: 1,
      toGo: 10,
      spot: 25,
      scoreUs: 0,
      scoreThem: 0,
      hype: 24,
      rewinds: rewindStart(cfg.franchise),
      rewindsMax: maxRewinds,
      possession: 'us',
      drivePlays: 0,
      driveYards: 0,
      quarterStartPossession: true,
      overtime: false,
      finished: false,
    };
    for (const p of cfg.franchise.roster) this.energy[p.id] = 100;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  private bump() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  private emit(name: string) {
    this.onEvent?.(name);
  }

  get playerTeam(): TeamInfo {
    return getTeam(this.franchise, this.franchise.teamId);
  }

  get maxRewinds(): number {
    return TUNING.rewindStart + this.franchise.rewindLevel;
  }

  /** Moments on the film shelf so far. The shelf is per half, not per quarter. */
  get filmCount(): number {
    return this.films.length;
  }

  private get slowmoScale() {
    return SLOWMO[this.franchise.settings.slowmo] ?? SLOWMO.full;
  }

  get defenseHint() {
    return DEFENSE_HINT[this.defenseCall];
  }

  private strength() {
    return opponentStrength(this.franchise, this.opponent);
  }

  begin() {
    if (this.phase !== 'kickoff') return;
    this.phase = 'playcall';
    this.playLog = [];
    this.deal();
    this.emit('kickoff');
    this.bump();
  }

  private deal() {
    const runs = PLAYBOOK.filter((p) => p.kind === 'run');
    const passes = PLAYBOOK.filter((p) => p.kind === 'pass');
    let picks: PlayDef[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      const pool = this.rng.shuffle(PLAYBOOK);
      picks = pool.slice(0, 4);
      if (picks.some((p) => p.kind === 'run') && picks.some((p) => p.kind === 'pass')) break;
    }
    if (picks.length === 0) picks = [runs[0], passes[0], passes[1], runs[1]];
    this.cards = picks;
    this.defenseCall = this.pickDefense();
    this.bump();
  }

  private pickDefense(): DefenseCall {
    const { down, toGo, spot } = this.state;
    const r = this.rng.next();
    const redZone = spot >= 82;
    if (redZone) {
      return r < 0.4 ? 'man' : r < 0.7 ? 'blitz' : r < 0.88 ? 'zone' : 'runstuff';
    }
    if (toGo <= 2) {
      return r < 0.42 ? 'runstuff' : r < 0.68 ? 'blitz' : r < 0.92 ? 'man' : 'zone';
    }
    if (toGo >= 9 || (down === 3 && toGo >= 7)) {
      return r < 0.4 ? 'zone' : r < 0.7 ? 'man' : r < 0.86 ? 'blitz' : 'prevent';
    }
    return r < 0.34 ? 'man' : r < 0.64 ? 'zone' : r < 0.86 ? 'blitz' : 'runstuff';
  }

  audible() {
    if (this.phase !== 'playcall') return false;
    if (this.state.hype < TUNING.audibleCost) return false;
    this.state.hype -= TUNING.audibleCost;
    const old = this.cards.map((c) => c.id);
    for (let i = 0; i < 12; i++) {
      this.deal();
      if (this.cards.filter((c) => old.includes(c.id)).length < 3) break;
    }
    this.emit('audible');
    this.bump();
    return true;
  }

  choosePlay(id: string, forced?: PlayDef) {
    if (this.phase !== 'playcall') return;
    const play = forced ?? this.cards.find((c) => c.id === id) ?? PLAYBOOK[0];
    this.snapshot = {
      state: clone(this.state),
      stats: clone(this.stats),
      energy: { ...this.energy },
      cards: this.cards.slice(),
      defenseCall: this.defenseCall,
      opponentStartSpot: this.opponentStartSpot,
      turnoverOnDowns: this.turnoverOnDowns,
      logLength: this.playLog.length,
    };
    const s = this.strength();
    const los = OWN_GOAL + this.state.spot;
    this.snapToGo = this.state.toGo;
    this.snapSpot = this.state.spot;
    this.snapDown = this.state.down;
    this.playCounter++;
    this.sim = new PlaySim({
      play,
      los,
      startSpot: this.state.spot,
      roster: this.franchise.roster,
      team: this.playerTeam,
      opp: this.opponent,
      oppDef: s.def,
      weather: this.weather,
      energy: { ...this.energy },
      seed: this.rng.int(1, 1_000_000),
      quarter: this.state.quarter,
      closeGame: Math.abs(this.state.scoreUs - this.state.scoreThem) <= 8,
    });
    this.sim.applyDefenseCall(this.defenseCall);
    this.recorder = new FilmRecorder(this.sim);
    this.hotSlot = null;
    this.phase = 'ready';
    this.readyTimer = READY_SECONDS;
    this.readyTotal = READY_SECONDS;
    this.readyHold = false;
    this.emit('ready');
    this.bump();
  }

  snap() {
    if (this.phase !== 'ready' || !this.sim) return;
    this.hotSlot = null;
    this.phase = 'live';
    this.sim.start();
    this.emit('snap');
    this.bump();
  }

  /**
   * A tap on a receiver at the line, before the ball is snapped. True means his route
   * menu is open — so the caller knows this tap was not meant to snap the ball — and
   * a tap anywhere else is simply not a hot route, leaving the caller to snap it the
   * way it always did.
   */
  hotRouteAt(x: number, y: number, radius: number): boolean {
    if (this.phase !== 'ready' || !this.sim) return false;
    const slot = this.sim.hotRouteAt(x, y, radius);
    if (!slot) return false;
    this.hotSlot = slot;
    this.emit('hotroute');
    this.bump();
    return true;
  }

  /** Take the chosen route and hand the line back to the snap count. */
  applyHotRoute(key: RouteKey): boolean {
    if (!this.hotSlot || !this.sim) return false;
    if (!this.sim.setHotRoute(this.hotSlot, key)) return false;
    this.hotSlot = null;
    this.emit('hotroute');
    this.bump();
    return true;
  }

  cancelHotRoute() {
    if (!this.hotSlot) return;
    this.hotSlot = null;
    this.bump();
  }

  /** A finger on the field holds the snap count; lifting lets it run again. */
  setReadyHold(on: boolean) {
    if (this.readyHold === on) return;
    this.readyHold = on;
    this.bump();
  }

  /** 1 at the start of the count, 0 at the snap — the deck draws this as a bar. */
  get readyPct(): number {
    if (this.phase !== 'ready' || this.readyTotal <= 0) return 0;
    return Math.max(0, Math.min(1, this.readyTimer / this.readyTotal));
  }

  /** Whether the count is stopped right now, so the bar can freeze with it. */
  get readyHeld(): boolean {
    return this.readyHold || Boolean(this.hotSlot);
  }

  /** The man the menu is open for, for the deck: `WR1 · #11`. */
  get hotRouteLabel(): string | null {
    if (!this.hotSlot || !this.sim) return null;
    const a = this.sim.offense.find((x) => x.slot === this.hotSlot);
    return a ? `${this.hotSlot} · #${a.jersey}` : this.hotSlot;
  }

  setStick(x: number, y: number, sprint = false) {
    this.stick = { x, y, sprint };
  }

  setStickScreen(active: boolean, ox = 0, oy = 0, x = 0, y = 0) {
    this.stickScreen = { active, ox, oy, x, y };
  }

  throwAt(fieldX: number, fieldY: number) {
    if (this.phase !== 'live' || !this.sim) return;
    if (this.sim.phase !== 'dropback' || !this.sim.isPass) return;
    this.sim.throwTo(fieldX, fieldY);
    this.emit('throw');
  }

  /**
   * Take off with the quarterback instead of throwing. The sim decides whether it
   * is on — a live pocket, the ball still in his hand, a pass play — and from there
   * the snap is a run in everything but the play card.
   */
  scramble() {
    if (this.phase !== 'live' || !this.sim) return;
    if (!this.sim.scramble()) return;
    this.emit('scramble');
    this.bump();
  }

  burst() {
    if (this.phase !== 'live' || !this.sim) return false;
    if (this.sim.phase !== 'carry' || !this.sim.carrier) return false;
    if (this.state.hype < TUNING.burstCost) return false;
    this.state.hype -= TUNING.burstCost;
    this.sim.activateBurst();
    this.emit('burst');
    this.bump();
    return true;
  }

  canRewind() {
    return Boolean(
      this.snapshot &&
        this.state.rewinds > 0 &&
        (this.phase === 'result' || this.phase === 'fourth'),
    );
  }

  rewind(): boolean {
    if (!this.canRewind() || !this.snapshot) return false;
    const snap = this.snapshot;
    this.state = clone(snap.state);
    this.stats = clone(snap.stats);
    this.energy = { ...snap.energy };
    this.cards = snap.cards.slice();
    this.defenseCall = snap.defenseCall;
    this.opponentStartSpot = snap.opponentStartSpot;
    this.turnoverOnDowns = snap.turnoverOnDowns;
    // The undone snap never happened, so its entry leaves the drive log with it.
    if (this.playLog.length > snap.logLength) this.playLog.length = snap.logLength;
    this.state.rewinds = Math.max(0, this.state.rewinds - 1);
    this.sim = undefined;
    this.lastOutcome = undefined;
    this.snapshot = undefined;
    this.kick = undefined;
    this.blockFx = undefined;
    this.hotSlot = null;
    this.phase = 'playcall';
    // The undone snap never happened, so its film goes in the bin with it.
    this.recorder = undefined;
    if (this.films.length) this.films = this.films.filter((f) => f.playCounter !== this.playCounter);
    this.rewindFx = 1.5;
    // The rewind effect owns this beat; a dip left over from the play being
    // undone would run under it.
    this.slowmoLeft = 0;
    this.slowmoTotal = 0;
    this.slowmoDepth = 0;
    this.slowmoK = 0;
    this.timeScale = 1;
    this.emit('rewind');
    this.bump();
    return true;
  }

  update(dtRaw: number) {
    if (this.paused) return;
    // Wall-clock dt drives every timer. The sim gets simDt, which thins out for
    // a beat after a broken tackle or a long score, so play calling, the ready
    // countdown and the broadcast overlays never slow down.
    const dt = Math.min(dtRaw, 1 / 20);
    this.stepSlowmo(dt);
    const simDt = dt * this.timeScale;
    this.rewindFx = Math.max(0, this.rewindFx - dt);
    switch (this.phase) {
      case 'ready':
        // The count waits for a thumb: a finger on the glass, or a route menu, stops
        // it where it stands. Picking a route is a decision to make, not a countdown
        // to beat — and a tap on SNAP, on the field or the space bar still snaps at
        // once, so none of this slows down a player who already knows what he wants.
        if (this.hotSlot || this.readyHold) break;
        this.readyTimer -= dt;
        if (this.readyTimer <= 0) this.snap();
        break;
      case 'live':
        if (!this.sim) break;
        this.sim.update(simDt, this.stick);
        this.recorder?.sample(simDt);
        this.drainSimEvents();
        if (this.sim.result && this.sim.deadTimer > 0.5) this.resolvePlay(this.sim.result);
        break;
      case 'result':
        if (this.sim) {
          this.sim.update(simDt, this.stick);
          this.drainSimEvents();
        }
        break;
      case 'defense':
        this.updateDefensePhase(dt);
        break;
      case 'kick':
        this.updateKick(dt);
        break;
      case 'block':
        this.updateBlock(dt);
        break;
      case 'halftime':
        this.stepReel(dt);
        break;
      default:
        break;
    }
  }

  private drainSimEvents() {
    const sim = this.sim;
    if (!sim) return;
    if (sim.events.length) {
      const events = sim.events.splice(0);
      for (const e of events) {
        this.emit(e);
        if (e === 'break') this.shakeHype(4);
      }
    }
    // The sim asks for the dip; the match owns the clock that plays it.
    if (sim.slowmoRequest > 0) {
      this.requestSlowmo(sim.slowmoRequest);
      sim.slowmoRequest = 0;
    }
  }

  /**
   * Ask for a time dip. A lesser moment never interrupts a deeper one already
   * playing; an equal or stronger one refreshes the beat instead of restarting it.
   */
  private requestSlowmo(depth: number) {
    if (this.franchise.settings.reducedMotion) return;
    // The player's own setting decides whether the tape stretches at all, and
    // how far. The camera shake is a separate switch and keeps working either way.
    const scale = this.slowmoScale;
    if (scale.depth <= 0) return;
    const d = clamp(depth * scale.depth, 0, 0.85);
    if (this.slowmoLeft > 0) {
      if (d < this.slowmoDepth * 0.7) return;
      if (d <= this.slowmoDepth) {
        this.slowmoLeft = Math.max(this.slowmoLeft, this.slowmoTotal * 0.5);
        return;
      }
    }
    this.slowmoDepth = d;
    this.slowmoTotal = (0.5 + d * 0.45) * scale.time;
    this.slowmoLeft = this.slowmoTotal;
  }

  /**
   * Advance the dip: fast in, slow out. `timeScale` is what the sim runs on and
   * `slowmoK` is the eased 0..1 the renderer draws.
   */
  private stepSlowmo(dt: number) {
    if (this.slowmoLeft <= 0) {
      if (this.slowmoK !== 0 || this.timeScale !== 1) {
        this.slowmoK = 0;
        this.timeScale = 1;
        this.slowmoDepth = 0;
      }
      return;
    }
    this.slowmoLeft = Math.max(0, this.slowmoLeft - dt);
    const t = clamp(1 - this.slowmoLeft / this.slowmoTotal, 0, 1);
    const k = t < 0.16 ? smooth(t / 0.16) : 1 - smooth((t - 0.16) / 0.84);
    this.slowmoK = this.slowmoLeft <= 0 ? 0 : k;
    this.timeScale = 1 - this.slowmoDepth * this.slowmoK;
    if (this.slowmoLeft <= 0) {
      this.timeScale = 1;
      this.slowmoDepth = 0;
    }
  }

  // ------------------------------------------------------- halftime reel ---

  /** Shelf the snap that just finished, if it is worth rewatching. */
  private finishFilm(outcome: PlayOutcome) {
    const rec = this.recorder;
    this.recorder = undefined;
    if (!rec) return;
    const film = buildFilm(rec, outcome, this.playCounter, this.state.quarter);
    if (!film) return;
    this.films.push(film);
    if (this.films.length > KEEP_FILMS) {
      this.films = this.films
        .slice()
        .sort((a, b) => b.moment.score - a.moment.score)
        .slice(0, KEEP_FILMS);
    }
  }

  /** Cut the first half into a reel. An ordinary half leaves no tape at all. */
  private startReel() {
    const moments = pickReel(this.films);
    this.films = [];
    this.recorder = undefined;
    if (!moments.length) {
      this.reel = undefined;
      return;
    }
    this.reel = { moments, index: 0, clock: 0, hold: 0, active: false };
    this.playMoment(0);
  }

  /** Put one moment on the field, with the recorded sim puppeted by its film. */
  private playMoment(i: number) {
    const reel = this.reel;
    const film = reel?.moments[i];
    if (!reel || !film) {
      this.endReel();
      return;
    }
    reel.index = i;
    reel.clock = 0;
    reel.hold = 0;
    reel.active = true;
    this.sim = film.sim;
    const sim = film.sim;
    // The replay is not a game: no events to drain, no whistle text, and the
    // outcome is only here so a replay of a score can throw its own confetti.
    sim.result = film.outcome;
    sim.events.length = 0;
    sim.freeText = '';
    sim.freeTextTimer = 0;
    sim.flash = 0;
    sim.shake = 0;
    applyFilm(film, filmWindow(film).start, sim);
  }

  /**
   * Advance the reel. `timeScale` and `slowmoK` are reused from the in-game
   * dip, so the renderer's time-thinning wash reads the same — except here the
   * dilation is held for the whole moment instead of easing out in half a
   * second. REDUCED MOTION and `SLOW MOTION: OFF` keep the tape at full speed.
   */
  private stepReel(dt: number) {
    const reel = this.reel;
    const sim = this.sim;
    if (!reel || !reel.active || !sim) return;
    const film = reel.moments[reel.index];
    if (!film) {
      this.endReel();
      return;
    }
    const win = filmWindow(film);
    const span = Math.max(1, (win.end - win.start) / FILM_HZ);
    const depth = this.franchise.settings.reducedMotion ? 0 : REEL_DEPTH * this.slowmoScale.depth;
    const t = clamp(reel.clock / span, 0, 1);
    const k =
      depth <= 0 ? 0 : t < 0.14 ? smooth(t / 0.14) : t > 0.84 ? 1 - smooth((t - 0.84) / 0.16) : 1;
    this.timeScale = 1 - depth * k;
    this.slowmoK = k;
    applyFilm(film, win.start + Math.min(win.end - win.start, Math.round(reel.clock * FILM_HZ)), sim);
    if (reel.clock >= span) {
      // Hold the last frame for a beat so the moment lands before the next one.
      reel.hold += dt;
      if (reel.hold >= REEL_HOLD) this.reelNext();
      return;
    }
    reel.clock += dt * this.timeScale;
  }

  /** Stop the reel and hand the field back to the halftime panel. */
  endReel() {
    const reel = this.reel;
    if (!reel || !reel.active) return;
    reel.active = false;
    reel.clock = 0;
    reel.hold = 0;
    this.sim = undefined;
    this.timeScale = 1;
    this.slowmoK = 0;
    this.bump();
  }

  /** Skip to the next moment, or roll the tape to its end after the last one. */
  reelNext() {
    const reel = this.reel;
    if (!reel) return;
    if (reel.index + 1 < reel.moments.length) this.playMoment(reel.index + 1);
    else this.endReel();
  }

  /** Run the tape again from the top. */
  replayReel() {
    const reel = this.reel;
    if (!reel || !reel.moments.length) return;
    this.playMoment(0);
  }

  private shakeHype(n: number) {
    this.state.hype = clamp(this.state.hype + n, 0, 100);
  }

  private line(id?: string): StatLine | null {
    if (!id) return null;
    if (!this.stats[id]) this.stats[id] = emptyStatLine();
    return this.stats[id];
  }

  private playerById(id?: string): Player | undefined {
    if (!id) return undefined;
    return this.franchise.roster.find((p) => p.id === id);
  }

  private quirkOf(id?: string): string | undefined {
    return this.playerById(id)?.quirk;
  }

  private resolvePlay(o: PlayOutcome) {
    if (this.phase !== 'live') return;
    this.phase = 'result';
    this.lastOutcome = { ...o };
    const sim = this.sim;
    if (sim) this.energy = { ...sim.energy };
    const oldSpot = this.state.spot;

    // ---- clock ----
    let runoff = o.timeUsed;
    if (o.incomplete) runoff = 2.4;
    else if (o.outOfBounds) runoff = 3.1;
    else if (o.touchdown) runoff = Math.max(4, Math.min(9, o.timeUsed));
    else if (o.kind === 'sack') runoff = o.timeUsed;
    this.state.clock = Math.max(0, this.state.clock - runoff);

    // ---- stats ----
    if (o.isPass) {
      const qbLine = this.line(o.throwerId);
      if (qbLine) {
        if (o.kind === 'interception') {
          qbLine.passAtt++;
          qbLine.ints++;
        } else if (o.kind === 'incomplete') {
          qbLine.passAtt++;
        } else if (o.kind === 'sack' || o.kind === 'safety' || o.kind === 'fumble') {
          // A safety or a strip is still a sack on the stat sheet: no attempt, no
          // completion, and the loss counts against the passer — unless the ball
          // was returned for a score, where there is no yardage to charge.
          qbLine.passYds += o.defensiveScore ? 0 : Math.min(0, o.yards);
        } else {
          qbLine.passAtt++;
          qbLine.passComp++;
          qbLine.passYds += o.yards;
          if (o.touchdown) qbLine.passTD++;
        }
      }
      const recLine = this.line(o.receiverId);
      if (
        recLine &&
        o.kind !== 'incomplete' &&
        o.kind !== 'sack' &&
        o.kind !== 'interception' &&
        o.kind !== 'safety'
      ) {
        recLine.rec++;
        recLine.recYds += o.yards;
        if (o.touchdown) recLine.recTD++;
      }
    } else {
      const carrierLine = this.line(o.carrierId);
      if (carrierLine && o.kind !== 'interception') {
        carrierLine.rushAtt++;
        carrierLine.rushYds += o.defensiveScore ? 0 : o.yards;
        if (o.touchdown) carrierLine.rushTD++;
      }
    }
    {
      const carrierLine = this.line(o.carrierId ?? o.receiverId);
      if (carrierLine && o.brokenTackles) carrierLine.brokenTackles += o.brokenTackles;
    }
    this.totalYards += o.incomplete ? 0 : Math.max(0, o.yards);

    // ---- scoring & field position ----
    let xpText = '';
    if (o.defensiveScore) {
      // Their defense scored. Six points and the extra point, the same way their
      // simulated drives score, and the free kick gives us the ball on our 25.
      this.state.scoreThem += 7;
      this.state.down = 1;
      this.state.toGo = 10;
      this.state.spot = 25;
      this.opponentStartSpot = 25;
      this.state.hype = clamp(this.state.hype - 10, 0, 100);
      this.lastOutcome = { ...this.lastOutcome, sub: 'DEFENSIVE TOUCHDOWN' };
    } else if (o.touchdown) {
      const kicker = this.franchise.roster.find((p) => p.pos === 'K');
      const kickPow = kicker?.ratings.pow ?? 72;
      const sniper = kicker?.quirk === 'sniper' ? 0.015 : 0;
      const xpChance = clamp(0.955 + (kickPow - 75) * 0.001 + sniper + this.weather.kickMod * 0.7, 0.85, 0.995);
      const good = this.rng.chance(xpChance);
      this.state.scoreUs += 6 + (good ? 1 : 0);
      xpText = good ? 'EXTRA POINT GOOD' : 'EXTRA POINT MISSED';
      const kline = this.line(kicker?.id);
      if (kline) {
        kline.fgAtt++;
        if (good) kline.fgMade++;
      }
      this.touchdowns++;
      this.state.hype = clamp(this.state.hype + TUNING.hypeTouchdown, 0, 100);
      this.state.rewinds = Math.min(this.state.rewindsMax, this.state.rewinds + 1);
      this.state.down = 1;
      this.state.toGo = 10;
      this.state.spot = 25;
      this.opponentStartSpot = 25;
      this.highlights.push(o.description);
      this.emit('score');
    } else if (o.kind === 'safety') {
      this.state.scoreThem += 2;
      this.state.down = 1;
      this.state.toGo = 10;
      this.state.spot = 25;
      this.opponentStartSpot = 40;
      this.emit('safety');
    } else if (o.turnover) {
      // A takeaway is spotted where it died: their own doorstep and our red zone
      // alike, so a pick on our 3 hands them the ball on our 3, not on our 8.
      this.opponentStartSpot = clamp(100 - o.endSpot, 1, 99);
      // The ball is never literally on a goal line after a takeaway: a pick
      // killed in the end zone is a touchback, spotted at their 20 by the sim.
      this.state.spot = clamp(o.endSpot, 1, 99);
      this.emit('turnover');
      this.state.hype = clamp(this.state.hype - 6, 0, 100);
    } else {
      // An incomplete pass comes back to the previous spot whatever ball spot
      // the sim resolved it at: no gain, same distance, one down gone.
      const newSpot = o.incomplete ? oldSpot : clamp(Math.round(o.endSpot), 1, 99);
      const gain = newSpot - oldSpot;
      this.state.driveYards += gain;
      const gotFirst = gain >= this.state.toGo;
      if (gotFirst && !o.incomplete) {
        this.state.down = 1;
        this.state.toGo = Math.min(10, 100 - newSpot);
        this.state.hype = clamp(this.state.hype + TUNING.hypeFirstDown, 0, 100);
        this.emit('first');
      } else if (o.incomplete) {
        this.state.down += 1;
      } else {
        this.state.down += 1;
        this.state.toGo -= gain;
      }
      this.state.spot = newSpot;
      if (o.bigPlay) this.state.hype = clamp(this.state.hype + TUNING.hypeBigPlay, 0, 100);
      if (o.brokenTackles > 0) {
        this.state.hype = clamp(this.state.hype + o.brokenTackles * TUNING.hypeBreakTackle, 0, 100);
      }
      if (this.state.down > 4) {
        this.turnoverOnDowns = true;
        // A fourth-down stand on our own doorstep hands them the ball right
        // there: the field of play is the only limit on their start.
        this.opponentStartSpot = clamp(100 - newSpot, 1, 99);
        this.lastOutcome = { ...this.lastOutcome, sub: 'TURNOVER ON DOWNS' };
        this.state.spot = newSpot;
      }
    }
    const showtime = [
      this.quirkOf(o.throwerId),
      this.quirkOf(o.receiverId),
      this.quirkOf(o.carrierId),
    ].includes('showtime');
    if (showtime) {
      this.state.hype = clamp(this.state.hype + 10, 0, 100);
    }
    // The drive log: what we ran, from where, and what it produced. A throw
    // that fell incomplete records how far it was thrown, so a deep miss reads
    // as a shot taken rather than a down wasted.
    this.playLog.push({
      down: this.snapDown,
      toGo: this.snapToGo,
      spot: this.snapSpot,
      text: o.description,
      yards: o.yards,
      kind: o.kind,
      incomplete: o.incomplete,
      airYards: o.airYards,
    });
    this.state.drivePlays++;
    this.state.hype = clamp(this.state.hype, 0, 100);
    if (o.bigPlay && !o.touchdown) this.highlights.push(o.description);
    if (xpText) {
      this.lastOutcome = { ...this.lastOutcome, sub: xpText };
    }
    if (this.state.rewinds > this.state.rewindsMax) this.state.rewinds = this.state.rewindsMax;
    if (this.lastOutcome) this.finishFilm(this.lastOutcome);
    this.emit(o.touchdown ? 'td' : o.turnover ? 'turnover' : o.incomplete ? 'incomplete' : 'whistle');
    this.bump();
  }

  /** Advance from the result screen. */
  advance() {
    if (this.phase === 'final') return;
    if (this.phase === 'kick') return;
    if (this.phase === 'result') {
      if (this.state.clock <= 0) {
        this.endQuarter();
        return;
      }
      const o = this.lastOutcome;
      if (!o) {
        this.startPlaycall();
        return;
      }
      if (o.defensiveScore) {
        // They scored, so they kick off: a fresh drive for us, not a defensive
        // series on the back of a takeaway.
        this.startDrive(25);
        return;
      }
      if (this.turnoverOnDowns) {
        this.turnoverOnDowns = false;
        this.startDefense(this.opponentStartSpot);
        return;
      }
      if (o.touchdown || o.turnover || o.kind === 'safety') {
        this.startDefense(this.opponentStartSpot);
        return;
      }
      if (o.kind === 'field_goal' || o.kind === 'field_goal_miss' || o.kind === 'punt') {
        this.startDefense(this.opponentStartSpot);
        return;
      }
      if (this.state.down > 4) {
        // Same rule as the play that just died: no ceiling short of their goal.
        this.opponentStartSpot = clamp(100 - this.state.spot, 1, 99);
        this.startDefense(this.opponentStartSpot);
        return;
      }
      if (this.state.down === 4) {
        this.phase = 'fourth';
        this.emit('fourth');
        this.bump();
        return;
      }
      this.startPlaycall();
      return;
    }
    if (this.phase === 'fourth') return;
    if (this.phase === 'defense') {
      this.finishDefense();
      return;
    }
    if (this.phase === 'quarter' || this.phase === 'halftime') {
      this.continueQuarter();
    }
  }

  startPlaycall() {
    this.phase = 'playcall';
    this.sim = undefined;
    this.kick = undefined;
    this.blockFx = undefined;
    this.lastOutcome = undefined;
    this.snapshot = undefined;
    this.turnoverOnDowns = false;
    // The drive counters belong to the drive, not the snap. Only a new drive
    // starts them over (startDrive / startQuarter), so the pause panel reads
    // back the whole series rather than the play just run.
    this.deal();
    this.bump();
  }

  get canGoForFieldGoal(): boolean {
    return 100 - this.state.spot + 17 <= 58;
  }

  get fieldGoalDistance(): number {
    return 100 - this.state.spot + 17;
  }

  chooseFourth(option: 'go' | 'punt' | 'fg') {
    if (this.phase !== 'fourth') return;
    if (option === 'go') {
      this.startPlaycall();
      return;
    }
    if (option === 'fg') {
      this.startFieldGoal();
      return;
    }
    this.punt();
  }

  private punt() {
    const ourSpot = this.state.spot;
    // A punt that never gets away. Rarely the rush gets home and drives the ball
    // back behind our own line, and sometimes the foot shanks it short of the usual
    // 35-55 yards. The kicking team falls on a block in this model, so a block is
    // never a free touchdown — it only costs us the ground it takes.
    // DEV ONLY: `?block=1` (see GameScreen) arms the next punt so the loose-ball
    // beat can be watched in seconds instead of waiting on a 2% roll. Guarding the
    // whole read with import.meta.env.DEV folds it away in a production build, so
    // no shipped bundle can force a block — `.qa/prod-block.mjs` checks a built
    // dist/ for exactly that.
    let forced = false;
    // `?.` because the simulation tests load this file under tsx, where `env` is
    // simply absent: Vite still folds `import.meta.env?.DEV` to `false` in a build.
    if (import.meta.env?.DEV) {
      const w = window as unknown as { __rwForceBlock?: boolean };
      forced = w.__rwForceBlock === true;
      w.__rwForceBlock = false;
    }
    const blocked = forced || this.rng.chance(TUNING.puntBlock);
    const shanked = !blocked && this.rng.chance(TUNING.puntShank);
    const net = blocked
      ? -Math.round(this.rng.range(1, 5))
      : Math.round(this.rng.range(shanked ? 8 : 35, shanked ? 22 : 55));
    // Where the ball is dead, on our scale: 0 is our goal line, 100 is theirs. A
    // ball that carries over their goal line is a touchback, and a block that dies
    // behind ours is a safety — decided here, once, so the takeover spot below is
    // never also paid for it.
    const landed = ourSpot + net;
    const touchback = landed >= 100;
    const safety = landed < 0;
    const deadSpot = clamp(landed, 1, 99);
    this.opponentStartSpot = safety ? 40 : touchback ? 20 : clamp(100 - deadSpot, 1, 99);
    const time = 5.6;
    this.state.clock = Math.max(0, this.state.clock - time);
    if (safety) {
      this.state.scoreThem += 2;
      this.state.spot = 25;
    }
    this.lastOutcome = {
      kind: safety ? 'safety' : 'punt',
      // How far the punt travelled, and where the ball died. On a punt the end spot
      // is the dead ball rather than the spot of the kick.
      yards: net,
      endSpot: safety ? 0 : touchback ? 100 : deadSpot,
      scored: safety,
      touchdown: false,
      turnover: !safety,
      incomplete: false,
      outOfBounds: false,
      timeUsed: time,
      description: safety
        ? `Punt blocked and downed in our end zone. Safety — ${this.opponent.abbr} scores two and takes the free kick.`
        : touchback
          ? `Punt travels ${net} yards into the end zone. Touchback, ${this.opponent.abbr} takes over on their 20.`
          : blocked
            ? `Rush gets home: the punt is blocked and downed ${-net} yards behind the line. ${this.opponent.abbr} takes over on our doorstep.`
            : shanked
              ? `Punt shanked, ${net} yards. ${this.opponent.abbr} takes over in good field position.`
              : `Punt travels ${net} yards. ${this.opponent.abbr} takes over deep.`,
      headline: safety ? 'SAFETY' : blocked ? 'PUNT BLOCKED' : shanked ? 'SHANKED' : 'PUNT',
      isPass: false,
      bigPlay: false,
      brokenTackles: 0,
      hypeGain: 0,
    };
    if (blocked) {
      // The block gets its own beat before the deck: the ball squirts backwards and
      // the kicking team has to fall on it. Nothing about the beat decides anything —
      // it only decides when we read it, and a safety's sting follows the thud.
      this.blockFx = { t: 0, hold: 1.35, fromYard: ourSpot, toYard: ourSpot + net };
      this.phase = 'block';
      this.emit('block');
    } else {
      this.phase = 'result';
      this.emit(safety ? 'safety' : 'punt');
    }
    this.bump();
  }

  startFieldGoal() {
    const distance = this.fieldGoalDistance;
    const kicker = this.franchise.roster.find((p) => p.pos === 'K');
    const sniper = kicker?.quirk === 'sniper';
    const perfectHalf = 0.045 + (kicker ? (kicker.ratings.pow - 70) * 0.0008 : 0) + (sniper ? 0.022 : 0);
    this.phase = 'kick';
    this.kick = {
      pos: this.rng.range(0.1, 0.9),
      dir: this.rng.chance(0.5) ? 1 : -1,
      speed: 1.15,
      perfectHalf,
      goodHalf: perfectHalf + 0.13,
      distance,
      active: true,
    };
    this.emit('kickready');
    this.bump();
  }

  private updateKick(dt: number) {
    if (!this.kick) return;
    this.kick.pos += this.kick.dir * this.kick.speed * dt;
    if (this.kick.pos > 1) {
      this.kick.pos = 1 - (this.kick.pos - 1);
      this.kick.dir = -1;
    } else if (this.kick.pos < 0) {
      this.kick.pos = -this.kick.pos;
      this.kick.dir = 1;
    }
  }

  private updateBlock(dt: number) {
    const fx = this.blockFx;
    if (!fx) {
      this.phase = 'result';
      return;
    }
    fx.t += dt;
    if (fx.t >= fx.hold) this.settleBlock();
  }

  /**
   * End the loose-ball beat. The match clock runs it out on its own; a tap on the
   * field, SPACE, or the deck button cuts it short. Either way the outcome that was
   * decided when the punt was blocked is what the deck reads.
   */
  settleBlock() {
    if (this.phase !== 'block') return;
    const safety = this.lastOutcome?.kind === 'safety';
    this.blockFx = undefined;
    this.phase = 'result';
    if (safety) this.emit('safety');
    this.emit('whistle');
    this.bump();
  }

  kickNow() {
    if (this.phase !== 'kick' || !this.kick || !this.kick.active) return;
    const k = this.kick;
    k.active = false;
    const kicker = this.franchise.roster.find((p) => p.pos === 'K');
    const pow = kicker?.ratings.pow ?? 72;
    const off = Math.abs(k.pos - 0.5);
    const quality = off <= k.perfectHalf ? 1 : off <= k.goodHalf ? 0.8 : 0.33;
    k.quality = quality;
    const makeChance = clamp(
      (0.985 - Math.max(0, k.distance - 22) * 0.0115 + this.weather.kickMod * 0.7 + (pow - 78) * 0.0025) *
        quality,
      0.03,
      0.99,
    );
    const made = this.rng.chance(makeChance);
    const time = 4.2;
    this.state.clock = Math.max(0, this.state.clock - time);
    const kline = this.line(kicker?.id);
    if (kline) {
      kline.fgAtt++;
      if (made) kline.fgMade++;
    }
    if (made) {
      this.state.scoreUs += 3;
      this.opponentStartSpot = 25;
      this.lastOutcome = {
        kind: 'field_goal',
        yards: 0,
        endSpot: this.state.spot,
        scored: true,
        touchdown: false,
        turnover: false,
        incomplete: false,
        outOfBounds: false,
        timeUsed: time,
        description: `${k.distance}-yard field goal is good.`,
        headline: 'FIELD GOAL GOOD',
        isPass: false,
        bigPlay: false,
        brokenTackles: 0,
        hypeGain: 0,
        sub: quality === 1 ? 'PERFECT STRIKE' : undefined,
      };
      this.state.hype = clamp(this.state.hype + 12, 0, 100);
      this.emit('fg');
    } else {
      this.opponentStartSpot = clamp(100 - this.state.spot, 20, 80);
      this.lastOutcome = {
        kind: 'field_goal_miss',
        yards: 0,
        endSpot: this.state.spot,
        scored: false,
        touchdown: false,
        turnover: true,
        incomplete: false,
        outOfBounds: false,
        timeUsed: time,
        description: `${k.distance}-yard attempt sails wide.`,
        headline: 'NO GOOD',
        isPass: false,
        bigPlay: false,
        brokenTackles: 0,
        hypeGain: 0,
      };
      this.emit('miss');
    }
    this.kick = undefined;
    this.phase = 'result';
    this.bump();
  }

  private startDefense(startSpot: number) {
    if (this.state.clock <= 0) {
      this.endQuarter();
      return;
    }
    const s = this.strength();
    this.drive = simulateOpponentDrive({
      rng: this.rng,
      startSpot,
      theirOff: s.off,
      ourDef: this.franchise.roster
        .filter((p) => ['DL', 'LB', 'CB', 'S'].includes(p.pos))
        .reduce((sum, p) => sum + (p.ratings.tkl + p.ratings.cov) / 2, 0) /
        Math.max(1, this.franchise.roster.filter((p) => ['DL', 'LB', 'CB', 'S'].includes(p.pos)).length),
      kick: s.kick,
      clock: this.state.clock,
    });
    this.driveRevealed = 0;
    this.driveApplied = false;
    this.driveTimer = 0;
    this.driveHold = 0;
    this.snapshot = undefined;
    this.sim = undefined;
    this.phase = 'defense';
    this.emit('defense');
    this.bump();
  }

  private updateDefensePhase(dt: number) {
    if (!this.drive) return;
    this.driveTimer += dt;
    const total = this.drive.plays.length;
    const shown = Math.min(total, Math.floor(this.driveTimer / 0.78));
    if (shown !== this.driveRevealed) {
      this.driveRevealed = shown;
      this.bump();
    }
    if (!this.driveApplied && this.driveTimer >= total * 0.78) {
      this.applyDrive();
    }
    if (this.driveApplied) {
      this.driveHold += dt;
      if (this.driveHold > 1.6) {
        this.finishDefense();
      }
    }
  }

  private applyDrive() {
    if (!this.drive || this.driveApplied) return;
    this.driveApplied = true;
    this.state.clock = Math.max(0, this.state.clock - this.drive.timeUsed);
    if (this.drive.points > 0) {
      this.state.scoreThem += this.drive.points;
      this.emit(this.drive.touchdown ? 'opptd' : 'oppfg');
    }
    if (this.drive.ourPoints > 0) {
      // Their drive died in their own end zone: a safety or a defensive
      // touchdown, and the kick that follows hands us the ball back.
      this.state.scoreUs += this.drive.ourPoints;
      this.state.hype = clamp(this.state.hype + 12, 0, 100);
      this.emit('score');
    }
    this.driveRevealed = this.drive.plays.length;
    this.bump();
  }

  skipDrive() {
    if (this.phase !== 'defense' || !this.drive) return;
    this.applyDrive();
    this.driveRevealed = this.drive.plays.length;
    this.driveHold = 1.5;
    this.finishDefense();
  }

  private finishDefense() {
    if (!this.drive) return;
    if (!this.driveApplied) this.applyDrive();
    const nextSpot = this.drive.nextSpot;
    this.drive = undefined;
    if (this.state.clock <= 0) {
      this.endQuarter();
      return;
    }
    this.startDrive(nextSpot);
  }

  private startDrive(spot: number) {
    this.playLog = [];
    this.state.spot = clamp(Math.round(spot), 1, 99);
    this.state.down = 1;
    this.state.toGo = Math.min(10, 100 - this.state.spot);
    this.state.possession = 'us';
    this.state.drivePlays = 0;
    this.state.driveYards = 0;
    this.state.hype = clamp(this.state.hype + 5, 0, 100);
    this.startPlaycall();
  }

  private endQuarter() {
    this.state.clock = 0;
    if (this.state.quarter === 2) {
      this.phase = 'halftime';
      this.startReel();
    } else if (this.state.quarter === 4) {
      if (this.state.scoreUs === this.state.scoreThem && !this.state.overtime) {
        this.overtimeReady = true;
        this.phase = 'quarter';
      } else {
        this.finishGame();
      }
    } else if (this.state.quarter >= 5) {
      if (this.isPostseason && this.state.scoreUs === this.state.scoreThem) {
        // A postseason game cannot end tied. Play another overtime period, up to a
        // sane bound; past it, the walk-off fallback settles the game.
        if (this.overtimePeriods < MAX_OVERTIME_PERIODS) {
          this.overtimeReady = true;
          this.phase = 'quarter';
        } else {
          this.resolveOvertimeTie();
        }
      } else {
        this.finishGame();
      }
    } else {
      this.phase = 'quarter';
    }
    this.emit('quarter');
    this.bump();
  }

  continueQuarter() {
    if (this.phase === 'halftime') {
      this.startQuarter(3);
      return;
    }
    if (this.phase !== 'quarter') return;
    if (this.overtimeReady) {
      this.overtimeReady = false;
      this.startQuarter(5, true);
      return;
    }
    const next = this.state.quarter + 1;
    if (next > 4) {
      this.finishGame();
      return;
    }
    this.startQuarter(next);
  }

  private startQuarter(q: number, overtime = false) {
    this.state.quarter = q;
    if (overtime) this.overtimePeriods += 1;
    this.state.clock = overtime ? 62 : QUARTER_SECONDS;
    this.state.overtime = overtime;
    this.state.down = 1;
    this.state.toGo = 10;
    this.state.spot = 25;
    this.state.possession = 'us';
    // Every quarter starts a fresh drive, so the log and the drive stats do too.
    this.playLog = [];
    this.state.drivePlays = 0;
    this.state.driveYards = 0;
    this.lastOutcome = undefined;
    this.snapshot = undefined;
    this.sim = undefined;
    this.kick = undefined;
    this.recorder = undefined;
    // The shelf belongs to the half: the first quarter's moments are still
    // needed at the break, so only a new half (or overtime) clears it.
    if (q !== 2) {
      this.films = [];
      this.reel = undefined;
    }
    for (const p of this.franchise.roster) {
      this.energy[p.id] = clamp((this.energy[p.id] ?? 100) + 12, 0, 100);
    }
    this.startPlaycall();
    this.emit(overtime ? 'overtime' : 'quarter');
  }

  private get isPostseason(): boolean {
    return this.week.stage === 'semi' || this.week.stage === 'bowl';
  }

  private finishGame() {
    if (this.phase === 'final') return;
    if (this.isPostseason && this.state.scoreUs === this.state.scoreThem) {
      // The overtime rule settles a postseason game; never file one as a tie.
      this.resolveOvertimeTie();
      return;
    }
    this.phase = 'final';
    this.state.finished = true;
    this.state.possession = 'us';
    this.emit(this.state.scoreUs > this.state.scoreThem ? 'win' : this.state.scoreUs < this.state.scoreThem ? 'lose' : 'tie');
    this.bump();
  }

  /**
   * The cap's fallback. A postseason game has to produce a winner, so after the
   * overtime limit it is settled the way a shootout settles it: one walk-off field
   * goal, awarded by the match's own seeded rng. It is deterministic for a seed, the
   * scoreline is decisive, and the title is never left undecided.
   */
  private resolveOvertimeTie() {
    if (this.state.scoreUs === this.state.scoreThem) {
      if (this.rng.chance(0.5)) this.state.scoreUs += 3;
      else this.state.scoreThem += 3;
      this.emit('fg');
    }
    this.finishGame();
  }

  getSummary(): GameSummary {
    if (this.finishedSummary) return this.finishedSummary;
    const win = this.state.scoreUs > this.state.scoreThem;
    const tie = this.state.scoreUs === this.state.scoreThem;
    let bestId = '';
    let bestScore = -1;
    let bestName = 'The Offensive Line';
    for (const p of this.franchise.roster) {
      const s = this.stats[p.id];
      if (!s) continue;
      const score =
        s.passYds + s.rushYds * 1.1 + s.recYds * 1.2 + (s.passTD + s.rushTD + s.recTD) * 45 + s.brokenTackles * 3;
      if (score > bestScore) {
        bestScore = score;
        bestId = p.id;
        bestName = p.name;
      }
    }
    const isBowl = this.week.stage === 'bowl';
    const isSemi = this.week.stage === 'semi';
    const tapeEarned = Math.round(
      32 + (win ? 58 : tie ? 24 : 10) + this.totalYards / 7.5 + this.touchdowns * 9 + (isBowl ? 120 : isSemi ? 60 : 0),
    );
    this.finishedSummary = {
      ourScore: this.state.scoreUs,
      theirScore: this.state.scoreThem,
      win,
      tie,
      opponentId: this.opponent.id,
      stats: this.stats,
      tapeEarned,
      highlights: this.highlights.slice(-5),
      mvpName: bestName,
      mvpPlayerId: bestId,
      totalYards: Math.round(this.totalYards),
      touchdowns: this.touchdowns,
    };
    return this.finishedSummary;
  }

  /** Helpers for the UI. */
  get kickerName(): string {
    return this.franchise.roster.find((p) => p.pos === 'K')?.name ?? 'The Kicker';
  }

  getPlayerName(id?: string): string {
    return this.playerById(id)?.name ?? '';
  }

  getQuirkName(id?: string): string {
    const q = this.quirkOf(id);
    return q ? QUIRKS[q as keyof typeof QUIRKS]?.name ?? '' : '';
  }

  getWeatherLabel(): string {
    return WEATHER[this.weather.id].name;
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function smooth(x: number): number {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
}

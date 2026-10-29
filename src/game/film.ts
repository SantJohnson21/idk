/**
 * The film room.
 *
 * Every snap is recorded as raw frames — actor poses, velocities, who is
 * carrying, the ball — so the halftime reel can replay the real snap instead of
 * describing it. A play's film is one flat Float32Array: a short header then
 * eight numbers per actor, written at FILM_HZ.
 *
 * Nothing in here knows about the clock, the score or the field. It stores
 * poses, scores them, and hands a frame back to whoever asks for it.
 */
import { OPP_GOAL } from './constants';
import type { PlayOutcome } from './types';
import type { BallState, PlaySim } from './play';

/** Frames per second of recorded film. Low enough to stay tiny, high enough to read. */
export const FILM_HZ = 12;
const MAX_SECONDS = 11;
const MAX_FRAMES = Math.ceil(FILM_HZ * MAX_SECONDS) + 2;
const HEADER = 12;
const PER_ACTOR = 8;

/** A moment has to clear this to make the reel. A routine eight-yard run does not. */
export const MOMENT_FLOOR = 45;
/** Moments in a halftime cut. A break is a highlight, not a season review. */
export const MAX_MOMENTS = 3;
/** Films kept on the shelf while the half runs; the reel keeps the best of them. */
export const KEEP_FILMS = 6;
/** How deep the replay dilates time: 0.6 means the tape runs at 40% at its centre. */
export const REEL_DEPTH = 0.6;
/** The beat the frozen last frame is held before the next moment. */
export const REEL_HOLD = 0.75;

const BALL_STATES: BallState['state'][] = ['held', 'air', 'dead'];
const SIM_PHASES: PlaySim['phase'][] = ['presnap', 'dropback', 'air', 'carry', 'dead'];

const clampIndex = (list: readonly unknown[], v: number) =>
  Math.max(0, Math.min(list.length - 1, Math.round(v)));

export interface FilmMoment {
  headline: string;
  description: string;
  /** Short tape label: "TOUCHDOWN · BROKE 2 · +47 YDS". */
  label: string;
  play: string;
  quarter: number;
  yards: number;
  touchdown: boolean;
  turnover: boolean;
  brokenTackles: number;
  score: number;
}

export interface Film {
  sim: PlaySim;
  outcome: PlayOutcome;
  moment: FilmMoment;
  data: Float32Array;
  stride: number;
  frames: number;
  /** The frame the replay is built around: the hit, the pick, or the goal line. */
  peak: number;
  playCounter: number;
}

export interface ReelState {
  moments: Film[];
  index: number;
  /** Film seconds consumed in the current moment. */
  clock: number;
  /** Wall-clock seconds the frozen last frame has been held for. */
  hold: number;
  active: boolean;
}

export class FilmRecorder {
  readonly sim: PlaySim;
  readonly stride: number;
  readonly data: Float32Array;
  frames = 0;
  /** Frame of the first broken tackle, and of the ball crossing the goal line. */
  breakPeak = -1;
  tdPeak = -1;
  private tick = 0;

  constructor(sim: PlaySim) {
    this.sim = sim;
    this.stride = HEADER + PER_ACTOR * sim.actors.length;
    this.data = new Float32Array(this.stride * MAX_FRAMES);
  }

  /**
   * Sample the sim when a frame is due. `dt` is sim seconds, so a snap that is
   * already running in slow motion is filmed at the same wall-clock rate.
   *
   * A big moment gets a frame even when the cadence is not due. The goal line
   * and the broken tackle must land on film exactly: at 12 Hz a sixty-yard score
   * otherwise opens on the mid-run tackle and cuts away before the touchdown.
   */
  sample(dt: number) {
    if (this.frames >= MAX_FRAMES) return;
    const sim = this.sim;
    this.tick += dt;
    const broke = this.breakPeak < 0 && sim.events.includes('break');
    const scored =
      this.tdPeak < 0 &&
      (sim.result?.touchdown === true || (sim.carrier !== null && sim.carrier.x >= OPP_GOAL));
    if (this.tick < 1 / FILM_HZ && !broke && !scored) return;
    this.tick = 0;
    if (this.frames >= MAX_FRAMES) return;
    this.capture();
    if (broke) this.breakPeak = this.frames - 1;
    if (scored) this.tdPeak = this.frames - 1;
  }

  private capture() {
    const sim = this.sim;
    const d = this.data;
    const b = this.frames * this.stride;
    const ball = sim.ball;
    d[b] = ball.x;
    d[b + 1] = ball.y;
    d[b + 2] = ball.z;
    d[b + 3] = BALL_STATES.indexOf(ball.state);
    d[b + 4] = ball.startX;
    d[b + 5] = ball.startY;
    d[b + 6] = sim.ballTarget.x;
    d[b + 7] = sim.ballTarget.y;
    d[b + 8] = sim.carrier ? sim.actors.indexOf(sim.carrier) : -1;
    d[b + 9] = sim.flash;
    d[b + 10] = sim.shake;
    d[b + 11] = SIM_PHASES.indexOf(sim.phase);
    for (let i = 0; i < sim.actors.length; i++) {
      const a = sim.actors[i];
      const o = b + HEADER + i * PER_ACTOR;
      d[o] = a.x;
      d[o + 1] = a.y;
      d[o + 2] = a.vx;
      d[o + 3] = a.vy;
      d[o + 4] = a.hasBall ? 1 : 0;
      d[o + 5] = a.hitFlash;
      d[o + 6] = a.stunned;
      d[o + 7] = a.bob;
    }
    this.frames++;
  }
}

/** How much of a moment a play is worth. Zero means it never reaches the reel. */
export function momentScore(o: PlayOutcome, quarter: number): number {
  // A pass that never arrived is not a highlight, whatever spot it died at.
  if (o.incomplete) return 0;
  const yards = Math.max(0, o.yards);
  let score = 0;
  if (o.touchdown) score = 100 + Math.min(60, yards);
  else if (o.turnover) score = 72 + (o.kind === 'interception' ? 12 : 0);
  else if (o.kind === 'sack') score = 46;
  else if (o.bigPlay) score = 62 + Math.min(30, yards);
  else if (o.brokenTackles > 0) score = 44 + Math.min(30, yards) + o.brokenTackles * 6;
  else if (yards >= 22) score = 30 + yards;
  // A moment late in the half is a bigger deal than the same one in the first drive.
  if (score > 0 && quarter >= 2) score += 4;
  return score;
}

/** Cut a finished snap into a reel candidate, or bin it. */
export function buildFilm(
  rec: FilmRecorder,
  outcome: PlayOutcome,
  playCounter: number,
  quarter: number,
): Film | null {
  if (rec.frames < 4) return null;
  const score = momentScore(outcome, quarter);
  if (score < MOMENT_FLOOR) return null;
  const bits: string[] = [];
  if (outcome.defensiveScore) bits.push(outcome.kind === 'interception' ? 'PICK SIX' : 'SCOOP & SCORE');
  else if (outcome.touchdown) bits.push('TOUCHDOWN');
  else if (outcome.turnover) bits.push(outcome.kind === 'interception' ? 'PICKED OFF' : 'TAKEAWAY');
  if (outcome.brokenTackles > 0) bits.push(`BROKE ${outcome.brokenTackles}`);
  // A defensive score has no gain to report: the ball went the other way.
  if (!outcome.defensiveScore) bits.push(outcome.yards >= 0 ? `+${outcome.yards} YDS` : `${outcome.yards} YDS`);
  return {
    sim: rec.sim,
    outcome,
    data: rec.data,
    stride: rec.stride,
    frames: rec.frames,
    peak: pickPeak(rec, outcome),
    playCounter,
    moment: {
      headline: outcome.headline,
      description: outcome.description,
      label: bits.join(' · '),
      play: rec.sim.play.name,
      quarter,
      yards: outcome.yards,
      touchdown: outcome.touchdown,
      turnover: outcome.turnover,
      brokenTackles: outcome.brokenTackles,
      score,
    },
  };
}

function pickPeak(rec: FilmRecorder, outcome: PlayOutcome): number {
  if (outcome.touchdown && rec.tdPeak >= 0) return rec.tdPeak;
  if (rec.breakPeak >= 0) return rec.breakPeak;
  return Math.max(0, rec.frames - 1);
}

/** The slice of film a moment replays: the hit or the score, plus a beat either side. */
export function filmWindow(film: Film): { start: number; end: number } {
  const pre = Math.round((film.moment.touchdown ? 1.5 : 1.2) * FILM_HZ);
  const post = Math.round(
    (film.moment.brokenTackles > 0 ? 1.5 : film.moment.touchdown ? 0.8 : 0.9) * FILM_HZ,
  );
  const start = Math.max(0, film.peak - pre);
  const end = Math.min(film.frames - 1, Math.max(start + 4, film.peak + post));
  return { start, end };
}

/** The best moments of the half, oldest first so the reel reads like a broadcast. */
export function pickReel(films: Film[]): Film[] {
  return films
    .slice()
    .sort((a, b) => b.moment.score - a.moment.score)
    .slice(0, MAX_MOMENTS)
    .sort((a, b) => a.playCounter - b.playCounter);
}

/** Hand the puppeted sim one frame of film. */
export function applyFilm(film: Film, frame: number, sim: PlaySim) {
  const d = film.data;
  const s = film.stride;
  const at = Math.min(film.frames - 1, Math.max(0, frame)) * s;
  const ball = sim.ball;
  ball.x = d[at];
  ball.y = d[at + 1];
  ball.z = d[at + 2];
  ball.state = BALL_STATES[clampIndex(BALL_STATES, d[at + 3])];
  ball.startX = d[at + 4];
  ball.startY = d[at + 5];
  sim.ballTarget.x = d[at + 6];
  sim.ballTarget.y = d[at + 7];
  sim.flash = d[at + 9];
  sim.shake = d[at + 10];
  sim.phase = SIM_PHASES[clampIndex(SIM_PHASES, d[at + 11])];
  const carrier = Math.round(d[at + 8]);
  sim.carrier = carrier >= 0 && carrier < sim.actors.length ? sim.actors[carrier] : null;
  for (let i = 0; i < sim.actors.length; i++) {
    const o = at + HEADER + i * PER_ACTOR;
    const a = sim.actors[i];
    a.x = d[o];
    a.y = d[o + 1];
    a.vx = d[o + 2];
    a.vy = d[o + 3];
    a.hasBall = d[o + 4] > 0.5;
    a.hitFlash = d[o + 5];
    a.stunned = d[o + 6];
    a.bob = d[o + 7];
  }
}

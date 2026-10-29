// Core shared types for Rewind Bowl.

export type Pos = 'QB' | 'RB' | 'WR' | 'SLOT' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'K';

export type QuirkId =
  | 'cannon'
  | 'burner'
  | 'sure_hands'
  | 'ballhawk'
  | 'bruiser'
  | 'iron_man'
  | 'clutch'
  | 'showtime'
  | 'sniper'
  | 'magnet'
  | 'field_general';

export interface QuirkDef {
  id: QuirkId;
  name: string;
  desc: string;
  icon: string;
}

export interface Ratings {
  spd: number;
  arm: number;
  hands: number;
  blk: number;
  cov: number;
  tkl: number;
  pow: number;
}

/**
 * A rare development trait, separate from a quirk: quirks are what a player does
 * on Sunday, traits decide what he becomes. One in about twelve has PRODIGY.
 */
export type DevTrait = 'prodigy';

export interface Player {
  id: string;
  name: string;
  pos: Pos;
  num: number;
  /** 18–40. One birthday per offseason, and the age decides how a player develops. */
  age: number;
  /** Absent on most players; a rare edge that changes the development curve. */
  trait?: DevTrait | null;
  ratings: Ratings;
  quirk: QuirkId;
  morale: number;
  ego: number;
  level: number;
  xp: number;
}

export interface TeamColors {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  jersey: string;
}

export interface TeamInfo {
  id: string;
  city: string;
  nickname: string;
  abbr: string;
  colors: TeamColors;
  off: number;
  def: number;
  kick: number;
}

export type Weather = 'CLEAR' | 'NIGHT' | 'RAIN' | 'WIND' | 'SNOW' | 'FOG';

export interface WeatherInfo {
  id: Weather;
  name: string;
  desc: string;
  icon: string;
  catchMod: number;
  accuracyMod: number;
  kickMod: number;
  speedMod: number;
}

export interface StatLine {
  passAtt: number;
  passComp: number;
  passYds: number;
  passTD: number;
  ints: number;
  rushAtt: number;
  rushYds: number;
  rushTD: number;
  rec: number;
  recYds: number;
  recTD: number;
  fgAtt: number;
  fgMade: number;
  brokenTackles: number;
  games: number;
}

export interface WeekSchedule {
  week: number;
  opponentId: string;
  home: boolean;
  weather: Weather;
  stage?: 'regular' | 'semi' | 'bowl';
  result?: {
    our: number;
    theirs: number;
    win: boolean;
    tie: boolean;
  };
}

export interface SeasonHistory {
  season: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  madePlayoffs: boolean;
  wonBowl: boolean;
  bowlScore?: string;
  mvpName?: string;
}

/**
 * How far a big moment stretches time. `off` never leaves real time, `short`
 * dips less and recovers quicker. Camera shake is a separate switch.
 */
export type SlowmoSetting = 'off' | 'short' | 'full';

export interface Franchise {
  version: number;
  teams: TeamInfo[];
  teamId: string;
  roster: Player[];
  tape: number;
  rewindLevel: number;
  season: number;
  week: number;
  schedule: WeekSchedule[];
  standings: Record<string, { w: number; l: number; t: number; pf: number; pa: number }>;
  seasonStats: Record<string, StatLine>;
  history: SeasonHistory[];
  draftPool: Player[] | null;
  /** Veterans on the wire: buy them with tape, and sell your own back onto it. */
  freeAgents: Player[] | null;
  seasonStage: 'regular' | 'playoffs' | 'offseason';
  playoffSeeds: string[] | null;
  bowlOpponentId: string | null;
  championId: string | null;
  difficulty: 'rookie' | 'pro' | 'legend';
  settings: {
    sound: boolean;
    music: boolean;
    crt: boolean;
    haptics: boolean;
    /** Holds the camera still on hits and scores. Defaults to the OS preference. */
    reducedMotion: boolean;
    /** How far the slow-motion dip on a big moment goes. Independent of shake. */
    slowmo: SlowmoSetting;
  };
  /** The winter's aging report: kept for the offseason screen, cleared at week 1. */
  development?: DevelopmentReport | null;
  lastGameSummary?: {
    week: number;
    opponentId: string;
    our: number;
    theirs: number;
    win: boolean;
    /** Stored, not inferred: a 14-14 draw has to read as a T on every screen. */
    tie: boolean;
    tapeEarned: number;
    highlights: string[];
    mvp: string;
  } | null;
  soundOn?: boolean;
}

export interface DevelopmentEntry {
  id: string;
  name: string;
  pos: Pos;
  age: number;
  trait?: DevTrait | null;
  before: number;
  after: number;
  delta: number;
}

/** Every roster's aging pass, written once when a season ends. */
export interface DevelopmentReport {
  season: number;
  entries: DevelopmentEntry[];
}

export interface GameState {
  quarter: number;
  clock: number; // game seconds remaining in quarter
  down: number;
  toGo: number;
  spot: number; // 0 = own goal line, 100 = opponent goal line
  scoreUs: number;
  scoreThem: number;
  hype: number; // 0..100
  rewinds: number;
  rewindsMax: number;
  possession: 'us' | 'them';
  drivePlays: number;
  driveYards: number;
  quarterStartPossession: boolean;
  overtime: boolean;
  finished: boolean;
}

export interface GameStats {
  [playerId: string]: StatLine;
}

export interface PlayOutcome {
  kind:
    | 'pass'
    | 'run'
    | 'sack'
    | 'incomplete'
    | 'interception'
    | 'fumble'
    | 'safety'
    | 'touchdown'
    | 'field_goal'
    | 'field_goal_miss'
    | 'punt'
    | 'kneel';
  yards: number;
  endSpot: number;
  scored: boolean;
  touchdown: boolean;
  turnover: boolean;
  /** A takeaway returned for a score by the defense: their touchdown, not ours. */
  defensiveScore?: boolean;
  incomplete: boolean;
  outOfBounds: boolean;
  timeUsed: number;
  description: string;
  headline: string;
  sub?: string;
  carrierId?: string;
  receiverId?: string;
  throwerId?: string;
  defenderId?: string;
  airYards?: number;
  isPass: boolean;
  bigPlay: boolean;
  brokenTackles: number;
  hypeGain: number;
}

export type MatchPhase =
  | 'kickoff'
  | 'playcall'
  | 'ready'
  | 'live'
  | 'result'
  | 'fourth'
  | 'kick'
  | 'block'
  | 'defense'
  | 'quarter'
  | 'halftime'
  | 'final'
  | 'paused';

export interface DrivePlay {
  down: number;
  toGo: number;
  spot: number;
  text: string;
  yards: number;
  kind: 'run' | 'pass' | 'punt' | 'fg' | 'turnover' | 'td' | 'miss' | 'safety' | 'def_td';
}

/**
 * One of our own snaps, as it reads back in the drive log. Enough to show the
 * down it was run on and what it produced — and, for a throw that never
 * arrived, how far the ball actually travelled.
 */
export interface PlayLogEntry {
  down: number;
  toGo: number;
  spot: number;
  text: string;
  yards: number;
  kind: PlayOutcome['kind'];
  incomplete: boolean;
  /** Air distance of the throw. On an incomplete, this is the whole story. */
  airYards?: number;
}

export interface OpponentDrive {
  plays: DrivePlay[];
  /** What the opponent scored on the drive. */
  points: number;
  /** What our defense scored on it: a safety or a defensive touchdown. */
  ourPoints: number;
  nextSpot: number;
  timeUsed: number;
  summary: string;
  turnover: boolean;
  touchdown: boolean;
}

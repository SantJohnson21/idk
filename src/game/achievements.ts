import type { SeasonHistory } from './types';

/** Saved on the franchise. Everything here is derived from games the career already filed. */
export interface AchievementState {
  /** Achievement id -> the season it was earned in. Unlocks are never revoked. */
  unlocked: Record<string, number>;
  /** Career touchdowns across every game filed. */
  touchdowns: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: 'FIRST WIN', desc: 'Win a game' },
  { id: 'hat_trick', name: 'HAT TRICK', desc: 'Score 3 touchdowns in one game' },
  { id: 'shutout', name: 'SHUTOUT', desc: 'Win while holding them scoreless' },
  { id: 'shootout', name: 'SHOOTOUT', desc: 'Score 40 points in one game' },
  { id: 'big_yards', name: 'BIG YARDS', desc: 'Gain 400 total yards in one game' },
  { id: 'playoff_bound', name: 'PLAYOFF BOUND', desc: 'Make the playoffs' },
  { id: 'unbeaten', name: 'UNBEATEN', desc: 'Finish a regular season with no losses or ties' },
  { id: 'bowl_champion', name: 'BOWL CHAMPION', desc: 'Win the bowl' },
  { id: 'dynasty', name: 'DYNASTY', desc: 'Win 3 bowls' },
  { id: 'fifty_wins', name: 'FIFTY WINS', desc: 'Win 50 career games' },
  { id: 'touchdown_club', name: 'TOUCHDOWN CLUB', desc: 'Score 100 career touchdowns' },
];

export function achievementName(id: string): string {
  return ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id;
}

export interface GameFacts {
  ourScore: number;
  theirScore: number;
  win: boolean;
  touchdowns: number;
  totalYards: number;
}

export interface AchievementContext {
  /** The game that just finished, or null when only season-level milestones are checked. */
  game: GameFacts | null;
  /** Career wins, including the season in progress. */
  careerWins: number;
  /** Titles across every season on file. */
  titles: number;
  /** Set only on the call that ends a season, so its record is judged once. */
  endedSeason: SeasonHistory | null;
}

/**
 * Applies a finished game (and, when a season just ended, its record) to the saved
 * achievement state. Returns the ids unlocked by this call, in catalogue order.
 */
export function recordAchievements(
  state: AchievementState,
  season: number,
  ctx: AchievementContext,
): string[] {
  const earned: string[] = [];
  const grant = (id: string, earnedNow: boolean) => {
    if (!earnedNow || id in state.unlocked) return;
    state.unlocked[id] = season;
    earned.push(id);
  };

  const g = ctx.game;
  if (g) {
    state.touchdowns += g.touchdowns;
    grant('first_win', g.win);
    grant('hat_trick', g.touchdowns >= 3);
    grant('shutout', g.win && g.theirScore === 0);
    grant('shootout', g.ourScore >= 40);
    grant('big_yards', g.totalYards >= 400);
  }
  grant('touchdown_club', state.touchdowns >= 100);
  grant('fifty_wins', ctx.careerWins >= 50);
  grant('dynasty', ctx.titles >= 3);

  const s = ctx.endedSeason;
  if (s) {
    grant('playoff_bound', s.madePlayoffs);
    grant('unbeaten', s.wins > 0 && s.losses === 0 && s.ties === 0);
    grant('bowl_champion', s.wonBowl);
  }

  return ACHIEVEMENTS.map((a) => a.id).filter((id) => earned.includes(id));
}

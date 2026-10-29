import type { Franchise } from './types';
import { TEAMS } from './data';
import { prefersReducedMotion } from './motion';
import { syncIdCounter } from './season';
import { ensureMarket } from './market';

const KEY = 'rewind-bowl-save-v1';

export function loadFranchise(): Franchise | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Franchise>;
    if (!parsed || parsed.version !== 1 || !parsed.roster || !parsed.schedule) return null;
    const f = parsed as Franchise;
    // Defensive hydration for saves from earlier builds.
    f.teams = f.teams?.length ? f.teams : TEAMS.map((t) => ({ ...t }));
    f.standings = f.standings ?? {};
    for (const t of f.teams) {
      if (!f.standings[t.id]) f.standings[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    }
    f.seasonStats = f.seasonStats ?? {};
    f.history = f.history ?? [];
    f.seasonStage = f.seasonStage ?? 'regular';
    f.playoffSeeds = f.playoffSeeds ?? null;
    f.bowlOpponentId = f.bowlOpponentId ?? null;
    f.championId = f.championId ?? null;
    f.draftPool = f.draftPool ?? null;
    f.freeAgents = f.freeAgents?.length ? f.freeAgents : null;
    f.lastGameSummary = f.lastGameSummary ?? null;
    f.tape = Number.isFinite(f.tape) ? f.tape : 100;
    f.rewindLevel = Number.isFinite(f.rewindLevel) ? f.rewindLevel : 0;
    f.difficulty = f.difficulty ?? 'pro';
    // Older saves predate some switches; fill gaps without clobbering choices.
    const saved = (f.settings ?? {}) as Partial<Franchise['settings']>;
    f.settings = {
      sound: saved.sound ?? true,
      music: saved.music ?? true,
      crt: saved.crt ?? true,
      haptics: saved.haptics ?? true,
      reducedMotion: saved.reducedMotion ?? prefersReducedMotion(),
      // A save from before this switch existed plays the dips as it always has.
      slowmo: saved.slowmo === 'off' || saved.slowmo === 'short' ? saved.slowmo : 'full',
    };
    f.roster = f.roster.map((p) => ({
      ...p,
      morale: Number.isFinite(p.morale) ? p.morale : 70,
      ego: Number.isFinite(p.ego) ? p.ego : 1,
    }));
    // Mint nothing until our id counter is past every id in the save, then stock the
    // wire for a save written before the market existed.
    syncIdCounter(f);
    ensureMarket(f);
    return f;
  } catch {
    return null;
  }
}

export function saveFranchise(f: Franchise) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // Storage can be full or blocked; the game keeps running in memory.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

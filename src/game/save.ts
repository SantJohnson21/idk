import type { Franchise, TeamInfo } from './types';
import { TEAMS } from './data';
import { prefersReducedMotion } from './motion';
import { syncIdCounter } from './season';
import { ensureMarket } from './market';
import { devTraitFor } from './development';

/** Four tapes, four careers. The slot is part of the key, not a field in the save. */
export const SAVE_SLOTS = 4;

const LEGACY_KEY = 'rewind-bowl-save-v1';
const SLOT_PREFIX = 'rewind-bowl-save-v1-slot-';
const ACTIVE_KEY = 'rewind-bowl-active-slot';

/** What the title card needs to draw a slot without hydrating a whole franchise. */
export interface SaveSummary {
  slot: number;
  teamId: string;
  team: TeamInfo;
  season: number;
  week: number;
  stage: Franchise['seasonStage'];
  tape: number;
  record: { wins: number; losses: number; ties: number };
  titles: number;
}

function clampSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  return Math.min(SAVE_SLOTS - 1, Math.max(0, Math.trunc(slot)));
}

function slotKey(slot: number): string {
  return `${SLOT_PREFIX}${clampSlot(slot)}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The first build had one key. Move it into slot 1 exactly once, so an existing
 * career opens on the title card instead of disappearing behind the slot picker.
 */
function migrateLegacy(store: Storage) {
  try {
    if (store.getItem(slotKey(0)) === null) {
      const legacy = store.getItem(LEGACY_KEY);
      if (legacy !== null) store.setItem(slotKey(0), legacy);
    }
    if (store.getItem(slotKey(0)) !== null) store.removeItem(LEGACY_KEY);
  } catch {
    // A blocked or full store leaves the legacy key for the next launch.
  }
}

function readRaw(slot: number): string | null {
  const store = storage();
  if (!store) return null;
  migrateLegacy(store);
  try {
    return store.getItem(slotKey(slot));
  } catch {
    return null;
  }
}

export function activeSlot(): number {
  const store = storage();
  if (!store) return 0;
  try {
    const saved = Number.parseInt(store.getItem(ACTIVE_KEY) ?? '0', 10);
    return Number.isFinite(saved) ? clampSlot(saved) : 0;
  } catch {
    return 0;
  }
}

export function setActiveSlot(slot: number) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(ACTIVE_KEY, String(clampSlot(slot)));
  } catch {
    // The choice still lives in memory for this session.
  }
}

export function loadFranchise(slot = activeSlot()): Franchise | null {
  const raw = readRaw(slot);
  if (!raw) return null;
  try {
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
    f.achievements = {
      unlocked: f.achievements?.unlocked ?? {},
      touchdowns: Number.isFinite(f.achievements?.touchdowns) ? f.achievements!.touchdowns : 0,
    };
    f.seasonStage = f.seasonStage ?? 'regular';
    f.playoffSeeds = f.playoffSeeds ?? null;
    f.bowlOpponentId = f.bowlOpponentId ?? null;
    f.championId = f.championId ?? null;
    f.draftPool = f.draftPool ?? null;
    f.freeAgents = f.freeAgents?.length ? f.freeAgents : null;
    f.lastGameSummary = f.lastGameSummary ?? null;
    // Saves from before the tie flag existed carry only the score; fill it in.
    if (f.lastGameSummary && typeof f.lastGameSummary.tie !== 'boolean') {
      f.lastGameSummary.tie = f.lastGameSummary.our === f.lastGameSummary.theirs;
    }
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
      // Saves from before players had an age get a late-twenties veteran, so a
      // loading roster is not all 18-year-olds on the first winter.
      age: Number.isFinite(p.age)
        ? Math.min(40, Math.max(18, Math.round(p.age)))
        : 22 + ((Number.parseInt(p.id.replace(/^pl/, ''), 10) * 5) % 12),
      // A save from before traits existed gets the trait his own name would earn,
      // so an old franchise still has prodigies on the roster.
      trait: p.trait ?? devTraitFor(p.name, p.pos, p.num),
    }));
    // Development arrived after the first saves; a missing report is simply no camp news.
    f.development = f.development ?? null;
    if (f.development) {
      f.development.entries = f.development.entries ?? [];
    }
    // Mint nothing until our id counter is past every id in the save, then stock the
    // wire for a save written before the market existed.
    syncIdCounter(f);
    ensureMarket(f);
    return f;
  } catch {
    return null;
  }
}

export function saveFranchise(f: Franchise, slot = activeSlot()) {
  const store = storage();
  if (!store) return;
  try {
    migrateLegacy(store);
    store.setItem(slotKey(slot), JSON.stringify(f));
  } catch {
    // Storage can be full or blocked; the game keeps running in memory.
  }
}

export function clearSave(slot = activeSlot()) {
  const store = storage();
  if (!store) return;
  try {
    migrateLegacy(store);
    store.removeItem(slotKey(slot));
  } catch {
    // ignore
  }
}

/**
 * Read all four tapes for the title card. This parses the saved JSON but does not
 * hydrate it or stock its market, so looking at a slot cannot change another one.
 */
export function listSaveSlots(): Array<SaveSummary | null> {
  return Array.from({ length: SAVE_SLOTS }, (_, slot) => summarize(slot, readRaw(slot)));
}

function summarize(slot: number, raw: string | null): SaveSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Franchise>;
    if (!parsed || parsed.version !== 1 || !parsed.roster || !parsed.schedule) return null;
    const f = parsed as Franchise;
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const week of f.schedule) {
      if (!week.result) continue;
      if (week.stage && week.stage !== 'regular') continue;
      if (week.result.tie) ties++;
      else if (week.result.win) wins++;
      else losses++;
    }
    const team =
      f.teams?.find((t) => t.id === f.teamId) ??
      TEAMS.find((t) => t.id === f.teamId) ??
      TEAMS[0];
    if (!team) return null;
    return {
      slot: clampSlot(slot),
      teamId: f.teamId,
      team,
      season: Number.isFinite(f.season) ? f.season : 1,
      week: Math.min(
        Math.max(1, Number.isFinite(f.week) ? f.week : 1),
        Math.max(1, f.schedule.length),
      ),
      stage: f.seasonStage ?? 'regular',
      tape: Number.isFinite(f.tape) ? f.tape : 0,
      record: { wins, losses, ties },
      titles: (f.history ?? []).filter((h) => h.wonBowl).length,
    };
  } catch {
    return null;
  }
}

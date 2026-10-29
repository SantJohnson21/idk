import type { Franchise, TeamColors, TeamInfo } from './types';
import { TEAMS } from './data';

/**
 * The club's identity as the editor edits it: the three names first, then the five
 * colours the broadcast is built from. Every one of them is used somewhere the player
 * can see — the end zone wash, the lettering on it, the jerseys, the HUD bar, the
 * crowd, the hub hero — so nothing here is cosmetic-only.
 */
export interface TeamPatch {
  city: string;
  nickname: string;
  abbr: string;
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  jersey: string;
}

/** The end zone stacks the city name vertically, so it cannot run on forever. */
export const NAME_MAX = 12;
export const ABBR_MAX = 3;

/** A shelf of palettes, so a new look is one tap rather than five colour pickers. */
export const TEAM_PRESETS: { name: string; colors: TeamColors }[] = [
  {
    name: 'VHS TEAL',
    colors: { primary: '#1fe3cf', secondary: '#ff2e88', accent: '#ffe66d', dark: '#06222a', jersey: '#1fe3cf' },
  },
  {
    name: 'MIDNIGHT',
    colors: { primary: '#7c8cff', secondary: '#e6e9ff', accent: '#ffd166', dark: '#0b1026', jersey: '#7c8cff' },
  },
  {
    name: 'EMBER',
    colors: { primary: '#ff5c00', secondary: '#ffd166', accent: '#ffe8cc', dark: '#25061b', jersey: '#ff5c00' },
  },
  {
    name: 'NEON LIME',
    colors: { primary: '#b4ff39', secondary: '#f4f0dc', accent: '#1fe3cf', dark: '#0b1606', jersey: '#b4ff39' },
  },
  {
    name: 'GOLD RUSH',
    colors: { primary: '#ffc93c', secondary: '#241a05', accent: '#fff3c4', dark: '#1a1203', jersey: '#ffc93c' },
  },
  {
    name: 'BLOOD ORANGE',
    colors: { primary: '#ff495c', secondary: '#f3e9d2', accent: '#ffb703', dark: '#2b0a10', jersey: '#ff495c' },
  },
  {
    name: 'COBALT',
    colors: { primary: '#3aa0ff', secondary: '#dbe6ff', accent: '#ffd166', dark: '#071a2e', jersey: '#3aa0ff' },
  },
  {
    name: 'BLACKOUT',
    colors: { primary: '#9aa4b2', secondary: '#f4f0dc', accent: '#1fe3cf', dark: '#0a0d12', jersey: '#5b6472' },
  },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour the canvas and the stylesheets can both be handed. */
export function isHex(value: string): boolean {
  return HEX.test(value);
}

const cleanName = (value: string, fallback: string): string => {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, NAME_MAX);
  return trimmed || fallback;
};

const cleanHex = (value: string, fallback: string): string =>
  isHex(value ?? '') ? value.toLowerCase() : fallback;

/** The club as it stands, ready to be edited. */
export function teamPatch(team: TeamInfo): TeamPatch {
  return {
    city: team.city,
    nickname: team.nickname,
    abbr: team.abbr,
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    dark: team.colors.dark,
    jersey: team.colors.jersey,
  };
}

/**
 * The cleaned version of a patch: names uppercased and capped, the abbreviation pulled
 * to three characters, and any colour that is not #rrggbb left as it was. Nothing here
 * throws or blanks a field — a bad keystroke never costs the player his club.
 */
export function sanitizePatch(patch: TeamPatch, base: TeamInfo): TeamPatch {
  return {
    city: cleanName(patch.city, base.city),
    nickname: cleanName(patch.nickname, base.nickname),
    abbr:
      (patch.abbr ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, ABBR_MAX) || base.abbr,
    primary: cleanHex(patch.primary, base.colors.primary),
    secondary: cleanHex(patch.secondary, base.colors.secondary),
    accent: cleanHex(patch.accent, base.colors.accent),
    dark: cleanHex(patch.dark, base.colors.dark),
    jersey: cleanHex(patch.jersey, base.colors.jersey),
  };
}

export function patchColors(patch: TeamPatch): TeamColors {
  return {
    primary: patch.primary,
    secondary: patch.secondary,
    accent: patch.accent,
    dark: patch.dark,
    jersey: patch.jersey,
  };
}

const luma = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * What the editor should tell the player before he saves, or null when the club reads
 * fine. The end zone is drawn with the primary as a wash and the secondary as the
 * lettering on it, so a club painted one colour loses its own name on the field.
 */
export function patchWarning(patch: TeamPatch): string | null {
  if (!isHex(patch.primary) || !isHex(patch.secondary) || !isHex(patch.jersey)) {
    return 'COLOURS HAVE TO BE #RRGGBB — A BROKEN ONE IS IGNORED';
  }
  if (patch.primary.toLowerCase() === patch.secondary.toLowerCase()) {
    return 'PRIMARY AND SECONDARY ARE THE SAME — YOUR NAME WILL VANISH INTO THE END ZONE';
  }
  if (Math.abs(luma(patch.primary) - luma(patch.secondary)) < 24) {
    return 'THE END ZONE LETTERING IS BARELY BRIGHTER THAN ITS WASH — TRY A BIGGER GAP';
  }
  return null;
}

/** Write the club's new identity into the franchise. It persists with the save. */
export function applyTeamPatch(franchise: Franchise, patch: TeamPatch): boolean {
  const team = franchise.teams.find((t) => t.id === franchise.teamId);
  if (!team) return false;
  const clean = sanitizePatch(patch, team);
  team.city = clean.city;
  team.nickname = clean.nickname;
  team.abbr = clean.abbr;
  team.colors = patchColors(clean);
  return true;
}

/** The identity the club shipped with, for a restore button. */
export function originalPatch(teamId: string): TeamPatch | null {
  const base = TEAMS.find((t) => t.id === teamId);
  return base ? teamPatch(base) : null;
}

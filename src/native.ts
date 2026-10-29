import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Thin bridge to the native shell. Everything here is a no-op in a browser, so
 * the same build runs on the web, in the preview panel and inside the app.
 */
export const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

/**
 * Session-only evidence that the native shell did its job. The DEVICE CHECK
 * overlay (src/ui/DeviceCheck.tsx) reads this so splash, haptics and the back
 * button can be verified on real hardware without a debugger.
 */
const diag = {
  splash: (isNative ? 'pending' : 'web') as 'pending' | 'hidden' | 'failed' | 'web',
  splashMs: null as number | null,
  splashError: '',
  hapticsSetting: true,
  hapticsSent: 0,
  hapticsSkipped: 0,
  lastImpact: '—',
  impactsSent: 0,
  impactError: '',
  backPresses: 0,
  lastBack: '—',
};

let hapticsEnabled = true;

/** Mirrors the in-game HAPTICS setting; GameScreen calls this when it changes. */
export function setHapticsEnabled(on: boolean) {
  hapticsEnabled = on;
  diag.hapticsSetting = on;
}

/**
 * The game's haptic vocabulary. Patterns rather than durations, so play reads by
 * feel: a selection tick on a play card, a light tap on the snap, a success
 * pattern on points, an error pattern on a turnover, a heavy thud for a blocked
 * punt, and a two-stage spool when the tape rewinds.
 */
export type HapticCue =
  | 'select'
  | 'snap'
  | 'throw'
  | 'catch'
  | 'hit'
  | 'burst'
  | 'takeoff'
  | 'first'
  | 'score'
  | 'turnover'
  | 'block'
  | 'rewind'
  | 'whistle'
  | 'quarter'
  | 'win'
  | 'lose';

type Step =
  | { kind: 'selection'; at: number }
  | { kind: 'impact'; style: ImpactStyle; at: number; web: number }
  | { kind: 'notify'; type: NotificationType; at: number; web: number[] };

const light = (at = 0, web = 11): Step => ({ kind: 'impact', style: ImpactStyle.Light, at, web });
const medium = (at = 0, web = 24): Step => ({ kind: 'impact', style: ImpactStyle.Medium, at, web });
const heavy = (at = 0, web = 55): Step => ({ kind: 'impact', style: ImpactStyle.Heavy, at, web });
const notify = (type: NotificationType, web: number[], at = 0): Step => ({ kind: 'notify', type, at, web });

const CUES: Record<HapticCue, { label: string; steps: Step[] }> = {
  // Choosing a play is a UI selection, not a hit.
  select: { label: 'SELECTION', steps: [{ kind: 'selection', at: 0 }] },
  snap: { label: 'LIGHT', steps: [light(0, 14)] },
  throw: { label: 'LIGHT', steps: [light(0, 10)] },
  catch: { label: 'MEDIUM', steps: [medium()] },
  hit: { label: 'MEDIUM', steps: [medium(0, 30)] },
  burst: { label: 'MEDIUM·LIGHT', steps: [medium(0, 26), light(70)] },
  // Taking off out of the pocket is a foot-plant, not the surge the burst buys.
  takeoff: { label: 'LIGHT', steps: [light(0, 16)] },
  first: { label: 'LIGHT·LIGHT', steps: [light(0, 12), light(90, 12)] },
  score: { label: 'SUCCESS', steps: [notify(NotificationType.Success, [20, 60, 20])] },
  turnover: { label: 'ERROR', steps: [notify(NotificationType.Error, [40, 60, 40])] },
  // A punt off a blocker's back: a heavy thud, then the error buzz under it.
  block: { label: 'HEAVY·ERROR', steps: [heavy(0, 45), notify(NotificationType.Error, [40, 60, 40], 120)] },
  rewind: { label: 'HEAVY·MEDIUM', steps: [heavy(), medium(110, 26)] },
  whistle: { label: 'LIGHT', steps: [light(0, 10)] },
  quarter: { label: 'LIGHT·LIGHT', steps: [light(0, 12), light(130, 12)] },
  win: { label: 'SUCCESS', steps: [notify(NotificationType.Success, [25, 70, 25, 70, 25])] },
  lose: { label: 'ERROR', steps: [notify(NotificationType.Error, [50, 80, 50])] },
};

let cueGeneration = 0;

function fireStep(step: Step) {
  if (isNative) {
    if (step.kind === 'selection') {
      Haptics.selectionChanged().catch((err: unknown) => {
        diag.impactError = err instanceof Error ? err.message : 'selection rejected';
      });
    } else if (step.kind === 'impact') {
      Haptics.impact({ style: step.style }).catch((err: unknown) => {
        // Some devices have haptics disabled system-wide; never surface that.
        diag.impactError = err instanceof Error ? err.message : 'impact rejected';
      });
    } else {
      Haptics.notification({ type: step.type }).catch((err: unknown) => {
        diag.impactError = err instanceof Error ? err.message : 'notification rejected';
      });
    }
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate(step.kind === 'selection' ? 8 : step.web);
}

/**
 * Play one cue. Native uses the taptic engine (works on iOS, where
 * navigator.vibrate does nothing); browsers fall back to Vibration patterns.
 * A newer cue supersedes the tail of a running pattern so hits never pile up.
 */
export function haptic(cue: HapticCue = 'snap') {
  if (!hapticsEnabled) {
    diag.hapticsSkipped++;
    return;
  }
  const pattern = CUES[cue];
  const generation = ++cueGeneration;
  diag.hapticsSent++;
  diag.lastImpact = `${cue.toUpperCase()} · ${pattern.label}`;
  for (const step of pattern.steps) {
    if (step.at === 0) fireStep(step);
    else
      globalThis.setTimeout(() => {
        if (generation === cueGeneration) fireStep(step);
      }, step.at);
  }
}

/**
 * Fire the taptic engine directly, bypassing the game's HAPTICS setting. This is
 * the DEVICE CHECK test button: it proves the hardware and plugin work even if
 * the player turned in-game haptics off.
 */
export async function testImpact(weight: 'light' | 'medium' | 'heavy') {
  const style =
    weight === 'heavy'
      ? ImpactStyle.Heavy
      : weight === 'medium'
        ? ImpactStyle.Medium
        : ImpactStyle.Light;
  try {
    if (isNative) {
      await Haptics.impact({ style });
    } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(weight === 'heavy' ? 55 : weight === 'medium' ? 30 : 12);
    }
    diag.impactsSent++;
    diag.lastImpact = `${weight.toUpperCase()} TEST`;
    diag.impactError = '';
  } catch (err) {
    diag.impactError = err instanceof Error ? err.message : 'impact rejected';
  }
}

/** Called by the router when it handles a hardware back press. */
export function reportBack(action: string) {
  diag.backPresses++;
  diag.lastBack = action;
}

/** Remembers how the splash handoff went (see bootNative). */
function noteSplash(state: 'hidden' | 'failed', ms?: number, error?: string) {
  diag.splash = state;
  if (ms != null) diag.splashMs = Math.round(ms);
  diag.splashError = error ?? '';
}

export type NativeDiag = {
  platform: string;
  isNative: boolean;
  splash: typeof diag.splash;
  splashMs: number | null;
  splashError: string;
  hapticsSetting: boolean;
  hapticsSent: number;
  hapticsSkipped: number;
  lastImpact: string;
  impactsSent: number;
  impactError: string;
  backPresses: number;
  lastBack: string;
};

/** Snapshot for the DEVICE CHECK overlay. */
export function getDiag(): NativeDiag {
  return { platform, isNative, ...diag };
}

/** Which native plugins actually registered in this binary. */
export function getPluginStatus(): { name: string; ok: boolean }[] {
  if (!isNative) return [];
  return ['SplashScreen', 'StatusBar', 'Haptics', 'App'].map((name) => ({
    name,
    ok: Capacitor.isPluginAvailable(name),
  }));
}

/** Installed app version and build number (native only). */
export async function getAppInfo() {
  if (!isNative) return null;
  try {
    return await CapApp.getInfo();
  } catch {
    return null;
  }
}

/** Call once, after the first paint, to hand the splash screen over to the game. */
export async function bootNative() {
  if (!isNative) return;
  const startedAt = performance.now();
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setBackgroundColor({ color: '#080b12' });
    }
  } catch {
    // Status bar control is cosmetic; the game still runs.
  }
  try {
    // Wait one frame so the canvas has something on it before the curtain lifts.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await SplashScreen.hide({ fadeOutDuration: 220 });
    noteSplash('hidden', performance.now() - startedAt);
  } catch (err) {
    // SplashScreen.hide only fails if the plugin is missing; keep playing.
    noteSplash('failed', undefined, err instanceof Error ? err.message : 'hide failed');
  }
}

/**
 * Android hardware back button. The router in App.tsx owns navigation, so this
 * only reports the press; screens decide what "back" means for them.
 */
export function onBackButton(handler: () => void) {
  if (!isNative) return () => {};
  let removed = false;
  const handle = CapApp.addListener('backButton', handler);
  return () => {
    if (removed) return;
    removed = true;
    handle.then((h) => h.remove()).catch(() => {});
  };
}

/** Quit the app (Android back on the title screen). */
export function exitApp() {
  if (isNative) CapApp.exitApp().catch(() => {});
}

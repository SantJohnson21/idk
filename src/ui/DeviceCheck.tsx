import { useEffect, useMemo, useState } from 'react';
import { getAppInfo, getDiag, getPluginStatus, testImpact } from '../native';
import { loadFranchise } from '../game/save';
import { APP_VERSION } from '../version';
import { Modal, PixelButton } from './components';

type Tone = 'ok' | 'warn' | 'bad';

/**
 * Reads the CSS safe-area insets the shell hands the web view. The game lays out
 * with env(safe-area-inset-*), so seeing them here explains a cramped or
 * over-padded layout on a notched device.
 */
function readInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  const insets = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
  probe.remove();
  return insets;
}

/**
 * DEVICE CHECK — the hardware checklist, in the game.
 *
 * Opened by holding the build stamp on the title card (or `?diag` in a browser).
 * It reports the evidence the checklist in DEVICE-CHECK.md asks for: whether the
 * splash was handed off and when, how many haptics fired and at what weight, and
 * what the last hardware back press did.
 */
export function DeviceCheck({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [info, setInfo] = useState<{ version: string; build: string; id: string; name: string } | null>(null);
  const [insets, setInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [viewport, setViewport] = useState({ w: 0, h: 0, dpr: 1 });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    void getAppInfo().then(setInfo);
    setInsets(readInsets());
    setViewport({
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    });
    const id = window.setInterval(() => setTick((n) => n + 1), 700);
    return () => window.clearInterval(id);
  }, []);

  const d = getDiag();
  const plugins = getPluginStatus();
  const pluginsOk = plugins.filter((p) => p.ok);

  const career = useMemo(() => {
    const f = loadFranchise();
    if (!f) return 'NO SAVE YET';
    return `SEASON ${f.season} · WEEK ${Math.min(f.week, f.schedule.length)} · ${f.tape} TAPE`;
  }, [tick]);

  /** What the club editor wrote, read back the way the field reads it. */
  const club = useMemo(() => {
    const f = loadFranchise();
    if (!f) return 'NO SAVE YET';
    const team = f.teams.find((t) => t.id === f.teamId);
    if (!team) return `UNKNOWN CLUB (${f.teamId})`;
    return `${team.city} ${team.nickname} · ${team.abbr} · ${team.colors.primary.toUpperCase()}`;
  }, [tick]);

  const splashTone: Tone | undefined =
    d.splash === 'hidden' ? 'ok' : d.splash === 'failed' ? 'bad' : d.splash === 'web' ? undefined : 'warn';

  const rows: { label: string; value: string; tone?: Tone }[] = [
    {
      label: 'SHELL',
      value: d.isNative ? `${d.platform.toUpperCase()} NATIVE` : `BROWSER (${d.platform})`,
      tone: d.isNative ? 'ok' : 'warn',
    },
    { label: 'APP VERSION', value: info ? `${info.version} (BUILD ${info.build})` : APP_VERSION },
    { label: 'APP ID', value: info?.id ?? '—' },
    {
      label: 'PLUGINS',
      value: plugins.length ? `${pluginsOk.length}/${plugins.length} REGISTERED` : 'BROWSER — N/A',
      tone: plugins.length ? (pluginsOk.length === plugins.length ? 'ok' : 'bad') : undefined,
    },
    {
      label: 'SPLASH',
      value:
        d.splash === 'hidden'
          ? `HANDED OFF @ ${d.splashMs ?? '?'} MS`
          : d.splash === 'failed'
            ? `FAILED — ${d.splashError}`
            : d.splash === 'web'
              ? 'BROWSER — N/A'
              : 'STILL SHOWING',
      tone: splashTone,
    },
    {
      label: 'HAPTICS',
      value: `${d.hapticsSent} SENT · ${d.hapticsSkipped} MUTED · LAST ${d.lastImpact}`,
      tone: d.impactError ? 'bad' : d.hapticsSent + d.impactsSent > 0 ? 'ok' : undefined,
    },
    {
      label: 'HAPTIC SETTING',
      value: d.hapticsSetting ? 'ON' : 'OFF (IN-GAME)',
      tone: d.hapticsSetting ? 'ok' : 'warn',
    },
    {
      label: 'BACK BUTTON',
      value: `${d.backPresses} PRESS${d.backPresses === 1 ? '' : 'ES'} · LAST ${d.lastBack}`,
      tone: d.backPresses > 0 ? 'ok' : d.isNative ? 'warn' : undefined,
    },
    {
      label: 'SAFE AREA',
      value: `T${insets.top} R${insets.right} B${insets.bottom} L${insets.left}`,
      tone: insets.top + insets.bottom > 0 ? 'ok' : undefined,
    },
    { label: 'VIEWPORT', value: `${viewport.w}×${viewport.h} @${viewport.dpr.toFixed(1)}x` },
    { label: 'CAREER', value: career },
    { label: 'CLUB', value: club },
  ];

  if (d.impactError) rows.push({ label: 'HAPTIC ERROR', value: d.impactError.toUpperCase(), tone: 'bad' });
  for (const p of plugins.filter((p) => !p.ok)) {
    rows.push({ label: 'MISSING PLUGIN', value: p.name.toUpperCase(), tone: 'bad' });
  }

  const report = {
    app: 'rewind-bowl',
    version: info?.version ?? APP_VERSION,
    build: info?.build ?? null,
    appId: info?.id ?? null,
    ...d,
    plugins,
    insets,
    viewport,
    career,
    club,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    at: new Date().toISOString(),
  };
  const reportText = JSON.stringify(report, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      setShowRaw(true);
    }
  };

  return (
    <Modal title="DEVICE CHECK" eyebrow="ON-DEVICE VERIFICATION" onClose={onClose} wide>
      <div className="diag-grid">
        {rows.map((r) => (
          <div className="diag-row" key={r.label}>
            <span>{r.label}</span>
            <b className={r.tone ?? ''}>{r.value}</b>
          </div>
        ))}
      </div>

      <div className="diag-actions">
        <PixelButton variant="quiet" tick={false} onClick={() => void testImpact('light')}>
          LIGHT
        </PixelButton>
        <PixelButton variant="quiet" tick={false} onClick={() => void testImpact('medium')}>
          MEDIUM
        </PixelButton>
        <PixelButton variant="quiet" tick={false} onClick={() => void testImpact('heavy')}>
          HEAVY
        </PixelButton>
        <PixelButton variant="ghost" onClick={() => void copy()}>
          {copyState === 'copied' ? 'COPIED ✓' : 'COPY REPORT'}
        </PixelButton>
        <PixelButton variant="quiet" onClick={() => setShowRaw((s) => !s)}>
          {showRaw ? 'HIDE RAW' : 'RAW'}
        </PixelButton>
      </div>

      <p className="diag-note">
        The three test buttons fire the taptic engine directly, even with in-game haptics
        off. Splash and back-button rows update live; hold the build stamp on the title
        card to reopen this panel.
      </p>

      {showRaw && <pre className="diag-raw">{reportText}</pre>}

      {copyState === 'failed' && (
        <p className="diag-note warn">
          Clipboard blocked — copy the raw report above by hand.
        </p>
      )}
    </Modal>
  );
}

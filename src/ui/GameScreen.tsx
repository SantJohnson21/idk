import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Franchise, PlayLogEntry, StatLine } from '../game/types';
import { activeWeek, getTeam } from '../game/season';
import { Match, type DefenseCall } from '../game/match';
import { Renderer } from '../game/render';
import { WEATHER } from '../game/data';
import {
  BASE_FORMATION,
  buildRoute,
  HOT_ROUTE_LABEL,
  HOT_ROUTES,
  type PlayDef,
  type RouteKey,
  type RouteSlot,
} from '../game/playbook';
import { MID_Y, READY_SECONDS } from '../game/constants';
import { nextSpotLabel, spotLabel } from '../game/play';
import { audio } from '../game/audio';
import { haptic, reportBack, type HapticCue } from '../native';
import { PixelButton, RiskPips, TeamBadge } from './components';

/** `2ND & 7` for a drive-log row. */
function downLabel(down: number, toGo: number): string {
  const d = down === 1 ? '1ST' : down === 2 ? '2ND' : down === 3 ? '3RD' : down === 4 ? '4TH' : `${down}TH`;
  return `${d} & ${Math.max(1, Math.ceil(toGo))}`;
}

/** Row colour for a log entry, matching the opponent drive feed. */
function logTone(entry: PlayLogEntry): string {
  if (entry.kind === 'touchdown') return 'td';
  if (entry.kind === 'interception' || entry.kind === 'fumble' || entry.kind === 'safety') return 'turnover';
  if (entry.kind === 'sack') return 'miss';
  return '';
}

/**
 * Which haptic cue each simulation/broadcast event gets. The sim and the match
 * object both announce some events (snap, throw, td), so the handler de-dupes.
 */
const EVENT_CUES: Record<string, HapticCue | undefined> = {
  kickoff: 'snap',
  audible: 'select',
  hotroute: 'select',
  snap: 'snap',
  throw: 'throw',
  burst: 'burst',
  scramble: 'takeoff',
  rewind: 'rewind',
  catch: 'catch',
  break: 'burst',
  tackle: 'hit',
  td: 'score',
  score: 'score',
  first: 'first',
  fg: 'first',
  safety: 'turnover',
  block: 'block',
  turnover: 'turnover',
  intercept: 'turnover',
  drop: 'whistle',
  incomplete: 'whistle',
  deflect: 'whistle',
  whistle: 'whistle',
  miss: 'whistle',
  opptd: 'turnover',
  oppfg: 'whistle',
  quarter: 'quarter',
  overtime: 'quarter',
  defense: 'whistle',
  fourth: 'whistle',
  punt: 'whistle',
  kickready: 'snap',
  win: 'win',
  lose: 'lose',
  tie: 'quarter',
};

const SLOT_LETTER: Record<RouteSlot, string> = {
  WR1: 'X',
  WR2: 'Z',
  SLOT: 'S',
  TE: 'Y',
  RB: 'R',
};

const SLOT_COLOR: Record<RouteSlot, string> = {
  WR1: '#ffd166',
  WR2: '#7dd3fc',
  SLOT: '#ff8ac4',
  TE: '#a7f3d0',
  RB: '#fca5a5',
};

function PlayDiagram({ play }: { play: PlayDef }) {
  const entries = Object.entries(play.routes) as [RouteSlot, RouteKey][];
  return (
    <svg className="play-diagram" viewBox="0 0 100 52" aria-hidden>
      <line x1="8" y1="3" x2="8" y2="49" className="diag-los" />
      <line x1="8" y1="26" x2="94" y2="26" className="diag-mid" />
      {entries.map(([slot, key]) => {
        const startY = play.formation?.[slot] ?? BASE_FORMATION[slot];
        const pts = buildRoute(key, startY, MID_Y);
        if (pts.length === 0) return null;
        const coords = pts.map(
          (p) =>
            `${(9 + p.dx * 2).toFixed(1)},${(26 + (startY - MID_Y) * 0.82 + p.dy * 1.5).toFixed(1)}`,
        );
        const last = coords[coords.length - 1];
        return (
          <g key={slot} stroke={SLOT_COLOR[slot]} fill={SLOT_COLOR[slot]}>
            <circle cx={9} cy={coords[0].split(',')[1]} r="1.7" strokeWidth="0" />
            {coords.length > 1 && (
              <polyline points={coords.join(' ')} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {last && <circle cx={last.split(',')[0]} cy={last.split(',')[1]} r="1.9" strokeWidth="0" />}
          </g>
        );
      })}
      {play.kind === 'run' && (
        <polyline
          points="10,26 20,20 28,30"
          fill="none"
          stroke="#fca5a5"
          strokeWidth="2"
          strokeDasharray="3 2"
        />
      )}
    </svg>
  );
}

function statText(line: StatLine): string {
  if (line.passAtt > 0) {
    return `${line.passComp}/${line.passAtt} · ${line.passYds} YDS · ${line.passTD} TD${
      line.ints ? ` · ${line.ints} INT` : ''
    }`;
  }
  if (line.rushAtt > 0) return `${line.rushAtt} CAR · ${line.rushYds} YDS · ${line.rushTD} TD`;
  if (line.rec > 0) return `${line.rec} REC · ${line.recYds} YDS · ${line.recTD} TD`;
  if (line.fgMade > 0) return `${line.fgMade}/${line.fgAtt} FG`;
  return '';
}

export function GameScreen({
  franchise,
  onExit,
  onFinish,
}: {
  franchise: Franchise;
  onExit: () => void;
  onFinish: (summary: ReturnType<Match['getSummary']>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const dragRef = useRef({ id: -1, ox: 0, oy: 0, x: 0, y: 0, t: 0, moved: 0 });
  const finishedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  // A finger on the glass freezes the snap count; this mirrors the match's own flag
  // so the count bar can show the freeze on the frame it happens.
  const [holding, setHolding] = useState(false);
  const [, forceRender] = useState(0);

  const week = useMemo(() => activeWeek(franchise), [franchise]);
  const opponent = useMemo(
    () => (week ? getTeam(franchise, week.opponentId) : null),
    [franchise, week],
  );

  // Cue de-dupe: the sim and the match both announce snap, throw and scores.
  const lastCue = useRef<{ cue: string; at: number }>({ cue: '', at: 0 });

  const match = useMemo(() => {
    if (!week || !opponent) return null;
    const m = new Match({
      franchise,
      opponent,
      week,
      weather: WEATHER[week.weather] ?? WEATHER.CLEAR,
      seed: Date.now() % 1_000_000,
      onEvent: (name) => {
        audio.play(name);
        const cue = EVENT_CUES[name];
        if (!cue) return;
        const now = performance.now();
        if (lastCue.current.cue === cue && now - lastCue.current.at < 150) return;
        lastCue.current = { cue, at: now };
        haptic(cue);
      },
    });
    return m;
    // The match is created once per game; franchise updates mid-game would reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matchRef = useRef<Match | null>(match);
  matchRef.current = match;

  /**
   * Let go of the field without turning the release into a snap. Every way a thumb
   * can leave — a clean pointerup, an OS gesture cancel, lost capture, a pointerup
   * outside the canvas, a window blur or the app going hidden — comes through here,
   * so the count resumes from where it stood instead of sticking or firing the ball.
   */
  const releaseHold = () => {
    dragRef.current.id = -1;
    setHolding(false);
    const m = matchRef.current;
    if (!m) return;
    m.setReadyHold(false);
    m.setStick(0, 0, false);
    m.setStickScreen(false);
  };

  useEffect(() => {
    const m = matchRef.current;
    if (!m) return;
    if (import.meta.env.DEV) {
      (window as unknown as { __match?: Match }).__match = m;
      // ?block=1 arms the next punt to be blocked so the loose-ball beat can be
      // watched in seconds instead of waiting on a 2% roll. Dev builds only: this
      // whole block is compiled out of production, and Match reads the switch
      // behind its own DEV guard.
      if (new URLSearchParams(window.location.search).has('block')) {
        (window as unknown as { __rwForceBlock?: boolean }).__rwForceBlock = true;
      }
    }
    m.begin();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const m = matchRef.current;
    if (!canvas || !m) return;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;
    // Dev builds hand the renderer to the QA harness so a tap can be aimed at a real
    // man on the field — screen yards in, field yards out — instead of guessed at.
    // Compiled out of a production bundle along with everything else behind DEV.
    if (import.meta.env.DEV) {
      (window as unknown as { __rwRenderer?: Renderer }).__rwRenderer = renderer;
    }
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      m.update(dt);
      renderer.draw(m, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // HUD refresh at 10fps — the canvas handles the fast stuff.
  useEffect(() => {
    const id = window.setInterval(() => forceRender((n) => (n + 1) % 1000), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const m = matchRef.current;
    if (!m) return;
    m.paused = paused;
  }, [paused]);

  // Keyboard controls.
  useEffect(() => {
    const keys = new Set<string>();
    const applyKeys = () => {
      const m = matchRef.current;
      if (!m) return;
      const x = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
      const y = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
      const len = Math.hypot(x, y) || 1;
      m.setStick(x / len, y / len, keys.has('Shift'));
    };
    const onDown = (e: KeyboardEvent) => {
      const m = matchRef.current;
      if (!m) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter'].includes(k)) e.preventDefault();
      if (k === 'escape') {
        setPaused((p) => !p);
        return;
      }
      if (k === 'r' && m.canRewind()) {
        m.rewind();
        return;
      }
      if (k === ' ' || k === 'enter') {
        if (m.phase === 'ready') m.snap();
        else if (m.phase === 'kick') m.kickNow();
        else if (m.phase === 'block') m.settleBlock();
        else if (m.phase === 'result') m.advance();
        else if (m.phase === 'halftime') {
          if (m.reel?.active) m.reelNext();
          else m.continueQuarter();
        } else if (m.phase === 'quarter') m.continueQuarter();
        else if (m.phase === 'live') m.burst();
        else if (m.phase === 'defense') m.skipDrive();
        return;
      }
      if (k === 'b' || k === 'f') {
        m.burst();
        return;
      }
      if (k === 'q' && m.phase === 'live') {
        m.scramble();
        return;
      }
      if (k === 't' && m.phase === 'live') {
        const reads = m.sim?.getReads() ?? [];
        const best = [...reads].sort((a, b) => b.percent - a.percent)[0];
        if (best) m.throwAt(best.projected.x, best.projected.y);
        return;
      }
      if (/^[1-5]$/.test(k)) {
        if (m.phase === 'playcall') {
          const card = m.cards[Number(k) - 1];
          if (card) m.choosePlay(card.id);
        } else if (m.phase === 'live' && m.sim?.phase === 'dropback') {
          const reads = m.sim.getReads();
          const sorted = [...reads].sort((a, b) => b.percent - a.percent);
          const read = sorted[Number(k) - 1];
          if (read) m.throwAt(read.projected.x, read.projected.y);
        }
        return;
      }
      keys.add(k);
      applyKeys();
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      applyKeys();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Android back button: close the quit prompt, otherwise pause/unpause. The
  // final report is not a pausable game, so back leaves it alone.
  useEffect(() => {
    const onBack = () => {
      if (matchRef.current?.phase === 'final') {
        reportBack('REPORT — NO ACTION');
        return;
      }
      if (confirmQuit) {
        setConfirmQuit(false);
        reportBack('CLOSED QUIT PROMPT');
        return;
      }
      setPaused(!paused);
      reportBack(paused ? 'RESUMED THE GAME' : 'PAUSED THE GAME');
    };
    window.addEventListener('rb:back', onBack);
    return () => window.removeEventListener('rb:back', onBack);
  }, [confirmQuit, paused]);

  // Coming back from the app switcher must not drop you into a live snap with
  // the ball already in the air. Pause on hide; the player resumes deliberately.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      if (matchRef.current?.phase === 'final') return;
      // The thumb holding the count went with the app. Release it; the pause keeps
      // the remaining time exactly where it was.
      releaseHold();
      setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // releaseHold only touches refs and stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pointerup delivered outside the canvas, a canceled touch, or a window that
  // loses focus must let go too. With pointer capture the canvas normally sees the
  // up; this is the floor for when it does not.
  useEffect(() => {
    const onWindowPointerEnd = (e: PointerEvent) => {
      if (dragRef.current.id === e.pointerId) releaseHold();
    };
    const onWindowBlur = () => {
      if (dragRef.current.id !== -1 || matchRef.current?.readyHold) releaseHold();
    };
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
    };
    // releaseHold only touches refs and stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const throwToRead = (read: { projected: { x: number; y: number } }) => {
    const m = matchRef.current;
    if (!m) return;
    m.throwAt(read.projected.x, read.projected.y);
  };

  const tapField = (clientX: number, clientY: number) => {
    const m = matchRef.current;
    const r = rendererRef.current;
    if (!m || !r || paused) return;
    if (m.phase === 'halftime' && m.reel?.active) {
      m.reelNext();
      return;
    }
    if (m.phase === 'ready') {
      const f = r.screenToField(clientX, clientY);
      // A tap on a receiver opens his route menu instead of snapping; anywhere else
      // still snaps the ball, so the line keeps the feel it has always had.
      if (m.hotRouteAt(f.x, f.y, r.tapRadiusYards())) return;
      m.snap();
      return;
    }
    if (m.phase === 'kick') {
      m.kickNow();
      return;
    }
    if (m.phase === 'block') {
      m.settleBlock();
      return;
    }
    if (m.phase === 'live' && m.sim) {
      if (m.sim.phase === 'dropback' && m.sim.isPass) {
        const f = r.screenToField(clientX, clientY);
        // Tapping the quarterback is the take-off; anywhere else is a throw. The zone is
        // sized on screen — a fingertip, not a fixed circle of field — and a receiver
        // standing nearer the tap than the quarterback keeps the throw.
        if (m.sim.tapIntent(f.x, f.y, r.tapRadiusYards()) === 'qb') m.scramble();
        else m.throwAt(f.x, f.y);
      }
      // A tap while carrying is not a burst. The deck prints BURST 34 next to the
      // button that spends the hype; a stray thumb on the field was buying one
      // silently, mid-run, for a cost it never showed.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragRef.current = { id: e.pointerId, ox: x, oy: y, x, y, t: performance.now(), moved: 0 };
    // The count waits for a thumb: reaching for a receiver is not a race with the
    // clock, and it starts again the moment the finger lifts.
    matchRef.current?.setReadyHold(true);
    setHolding(true);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = matchRef.current;
    const d = dragRef.current;
    if (!m || d.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    d.moved = Math.max(d.moved, Math.hypot(x - d.ox, y - d.oy));
    d.x = x;
    d.y = y;
    if (d.moved > 9) {
      const dx = x - d.ox;
      const dy = y - d.oy;
      const len = Math.hypot(dx, dy) || 1;
      m.setStick(dx / len, dy / len, d.moved > 58);
      m.setStickScreen(true, d.ox, d.oy, x, y);
    }
  };

  /** End a field gesture. Only a clean tap may snap; a cancel never does. */
  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, allowTap: boolean) => {
    const d = dragRef.current;
    if (d.id !== e.pointerId) return;
    const wasTap = allowTap && d.moved < 12 && performance.now() - d.t < 300;
    releaseHold();
    if (wasTap) tapField(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => endPointer(e, true);
  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => endPointer(e, false);

  const onLostPointerCapture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.id === e.pointerId) releaseHold();
  };

  const onPointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // With capture the canvas keeps the gesture while the thumb is off its edge. If
    // capture never took, leaving is the last thing we will hear from that pointer.
    if (dragRef.current.id === e.pointerId && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      releaseHold();
    }
  };

  const finish = () => {
    const m = matchRef.current;
    if (!m || finishedRef.current) return;
    finishedRef.current = true;
    onFinish(m.getSummary());
  };

  if (!match || !opponent || !week) {
    return (
      <div className="screen match-screen">
        <div className="match-empty">
          <h2>NO GAME ON THE SCHEDULE</h2>
          <PixelButton onClick={onExit}>BACK TO THE HUB</PixelButton>
        </div>
      </div>
    );
  }

  const m = match;
  const phase = m.phase;
  const sim = m.sim;
  const reel = m.reel;
  const reads = sim && sim.phase === 'dropback' ? sim.getReads() : [];
  const outcome = m.lastOutcome;
  // Where the ball is spotted next, in the field's own words: the deck names the
  // spot, so a tackle on the 1 reads as the 1 rather than a bare yardage.
  const resultSpot = outcome ? nextSpotLabel(outcome, m.opponentStartSpot) : null;
  // Their drive's opening field position in the field's own words: a ball snapped
  // on their 3 reads as OPP 3 rather than a bare number in the drive header.
  const driveStart = m.drive?.plays[0]?.spot;
  const backedUpOn = driveStart !== undefined && driveStart <= 5 ? spotLabel(100 - driveStart) : null;
  const summary = phase === 'final' ? m.getSummary() : null;
  const defenseHint = m.defenseHint;
  const topStats = Object.entries(m.stats)
    .map(([id, line]) => ({
      id,
      line,
      text: statText(line),
      name: m.getPlayerName(id),
      yards: line.passYds + line.rushYds + line.recYds,
    }))
    .filter((s) => s.text)
    .sort((a, b) => b.yards - a.yards)
    .slice(0, 4);

  const stageLabel = week.stage === 'bowl' ? 'GRIDIRON BOWL' : week.stage === 'semi' ? 'SEMIFINAL' : `WEEK ${week.week}`;

  return (
    <div className="screen match-screen">
      <div className="match-frame">
        <div className="match-rail">
          <span className="rail-stage">{stageLabel}</span>
          <span className="rail-weather">
            {WEATHER[week.weather].icon} {WEATHER[week.weather].name}
          </span>
          <span className="rail-spacer" />
          <span className="rail-tape">▤ {franchise.tape}</span>
          <button
            className="icon-btn small"
            onClick={() => {
              haptic('select');
              setPaused(true);
            }}
            aria-label="Pause"
          >
            ❚❚
          </button>
        </div>

        <div className="field-shell">
          <canvas
            ref={canvasRef}
            className="field-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onLostPointerCapture}
            onPointerLeave={onPointerLeave}
          />
          {phase === 'defense' && (
            <div className="defense-overlay">
              <div className="defense-card">
                <div className="defense-top">
                  <TeamBadge team={opponent} size="sm" />
                  <div>
                    <div className="eyebrow">OPPONENT DRIVE</div>
                    <b>
                      {opponent.city.toUpperCase()} {opponent.nickname.toUpperCase()}
                    </b>
                  </div>
                  <span className="defense-diff">
                    OFF {opponent.off} · DEF {opponent.def}
                  </span>
                </div>
                <div className="drive-open">
                  <h3>YOUR DEFENSE IS ON THE FIELD</h3>
                  {backedUpOn && <span className="drive-spot">BACKED UP · {backedUpOn}</span>}
                </div>
                <div className="drive-feed">
                  {(m.drive?.plays ?? []).slice(0, m.driveRevealed).map((p, i) => (
                    <div key={i} className={`drive-play ${p.kind}`}>
                      <span className="drive-down">
                        {p.down}
                        {p.down === 1 ? 'ST' : p.down === 2 ? 'ND' : p.down === 3 ? 'RD' : 'TH'} &amp; {p.toGo}
                      </span>
                      <span className="drive-text">{p.text}</span>
                      <b className={p.yards >= 0 ? 'up' : 'down'}>{p.yards > 0 ? `+${p.yards}` : p.yards}</b>
                    </div>
                  ))}
                </div>
                {m.driveApplied && (
                  <div className={`drive-result ${m.drive?.points || m.drive?.ourPoints ? 'scored' : ''}`}>
                    {m.drive?.summary}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="control-deck">
          {phase === 'playcall' && (
            <div className="deck-block">
              <div className="deck-head">
                <div>
                  <div className="eyebrow">{stageLabel}</div>
                  <h2>CALL THE PLAY</h2>
                </div>
                <div className="deck-head-right">
                  <span className={`defense-pill tone-${m.defenseCall}`}>
                    {defenseHint.short} DEFENSE
                  </span>
                  <button
                    className="audible-btn"
                    disabled={m.state.hype < 22}
                    onClick={() => m.audible()}
                  >
                    AUDIBLE <b>22⚡</b>
                  </button>
                </div>
              </div>
              <div className="play-grid">
                {m.cards.map((card, i) => (
                  <button
                    key={card.id}
                    className="play-card"
                    onClick={() => {
                      haptic('select');
                      m.choosePlay(card.id);
                    }}
                  >
                    <span className="play-key">{i + 1}</span>
                    <span className="play-card-top">
                      <b>{card.name}</b>
                      <i className={card.kind}>{card.kind.toUpperCase()}</i>
                    </span>
                    <PlayDiagram play={card} />
                    <span className="play-card-foot">
                      <RiskPips risk={card.risk} />
                      <small>{card.blurb}</small>
                    </span>
                    <span className="play-tip">▸ {card.tip}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <div className="deck-block deck-live">
              <div className="snap-row">
                <div>
                  <div className="eyebrow">{m.hotSlot ? 'CHANGE HIS ROUTE' : 'DEFENSE SHOWS'}</div>
                  <h2 className="defense-call">{m.hotSlot ? m.hotRouteLabel : defenseHint.label}</h2>
                  <small className="dim">
                    {m.hotSlot
                      ? 'Pick a route, then snap it'
                      : 'Drag to move · tap a receiver to change his route · tap SNAP to go'}
                  </small>
                </div>
                <button className="snap-btn" onClick={() => m.snap()}>
                  SNAP ▶
                </button>
              </div>
              <div
                className={`ready-bar${m.readyHeld || holding || paused ? ' held' : ''}`}
                aria-hidden="true"
              >
                <span style={{ animationDuration: `${READY_SECONDS}s` }} />
              </div>
              {m.hotSlot && (
                <div className="hot-row">
                  {HOT_ROUTES.map((key) => (
                    <button
                      key={key}
                      className="hot-btn"
                      onClick={() => {
                        haptic('select');
                        audio.play('select');
                        m.applyHotRoute(key);
                      }}
                    >
                      {HOT_ROUTE_LABEL[key]}
                    </button>
                  ))}
                  <button
                    className="hot-btn ghost"
                    onClick={() => {
                      haptic('select');
                      audio.init();
                      m.cancelHotRoute();
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              )}
            </div>
          )}

          {phase === 'live' && sim && (
            <div className="deck-block deck-live">
              {sim.isPass && sim.phase === 'dropback' && (
                <>
                  <div className="live-label">
                    <span className="eyebrow">TAP A RECEIVER</span>
                    <span className={`press ${sim.pressure > 55 ? 'hot' : ''}`}>
                      PRESSURE {Math.round(sim.pressure)}%
                    </span>
                    <button className="take-off-btn" onClick={() => m.scramble()}>
                      TAKE OFF
                    </button>
                  </div>
                  <div className="receiver-strip">
                    {[...reads]
                      .sort((a, b) => b.percent - a.percent)
                      .map((r, i) => {
                        const actor = sim.byId.get(r.actorId);
                        const name = actor?.rosterId ? m.getPlayerName(actor.rosterId) : '';
                        return (
                          <button
                            key={r.actorId}
                            className={`receiver-btn pct-${r.percent >= 70 ? 'good' : r.percent >= 52 ? 'ok' : 'bad'}`}
                            onClick={() => throwToRead(r)}
                          >
                            <span className="rec-key">{i + 1}</span>
                            <span className="rec-slot">{SLOT_LETTER[r.slot]}</span>
                            <span className="rec-name">{name.split(' ').slice(-1)[0] || r.slot}</span>
                            <b className="rec-pct">{r.percent}%</b>
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
              {sim.phase === 'carry' && (
                <div className="carry-bar">
                  <div>
                    <div className="eyebrow">RUN IT</div>
                    <small className="dim">Drag anywhere on the field to cut · tap BURST to break a tackle</small>
                  </div>
                  <button
                    className="burst-btn"
                    disabled={m.state.hype < 34}
                    onClick={() => m.burst()}
                  >
                    BURST <b>34⚡</b>
                  </button>
                </div>
              )}
              {sim.phase === 'air' && (
                <div className="deck-quiet">
                  <span className="blink-dot" /> BALL IN THE AIR…
                </div>
              )}
              {sim.phase === 'dead' && <div className="deck-quiet">WHISTLE…</div>}
            </div>
          )}

          {phase === 'result' && outcome && (
            <div className="deck-block result-deck">
              <div className="result-main">
                <span className={`result-headline ${outcome.touchdown ? 'gold' : outcome.turnover ? 'red' : ''}`}>
                  {outcome.headline}
                </span>
                <p>{outcome.description}</p>
                <div className="result-tags">
                  {resultSpot && <span className="spot">{resultSpot}</span>}
                  {outcome.isPass && <span>{(outcome.airYards ?? 0) > 0 ? `${outcome.airYards} AIR` : 'PASS'}</span>}
                  {!outcome.isPass && (
                    <span>
                      {outcome.kind === 'punt' ||
                      outcome.kind === 'field_goal' ||
                      outcome.kind === 'field_goal_miss'
                        ? 'KICK'
                        : 'RUN'}
                    </span>
                  )}
                  <span className={outcome.yards >= 0 ? 'up' : 'down'}>
                    {outcome.incomplete
                      ? 'NO GAIN'
                      : outcome.yards > 0
                        ? `+${outcome.yards} YDS`
                        : `${outcome.yards} YDS`}
                  </span>
                  {outcome.brokenTackles > 0 && <span className="gold">BROKE {outcome.brokenTackles}</span>}
                  {outcome.sub && <span className="gold">{outcome.sub}</span>}
                </div>
              </div>
              <div className="result-actions">
                {m.canRewind() && (
                  <PixelButton
                    variant="gold"
                    tick={false}
                    onClick={() => m.rewind()}
                  >
                    ◀◀ REWIND ({m.state.rewinds})
                  </PixelButton>
                )}
                <PixelButton className="btn-wide" onClick={() => m.advance()}>
                  NEXT ▶
                </PixelButton>
              </div>
            </div>
          )}

          {phase === 'fourth' && (
            <div className="deck-block">
              <div className="deck-head">
                <div>
                  <div className="eyebrow">
                    {m.state.down}TH &amp; {Math.ceil(m.state.toGo)} · {m.state.spot > 50 ? `OPP ${100 - m.state.spot}` : `OWN ${m.state.spot}`}
                  </div>
                  <h2>FOURTH DOWN CALL</h2>
                </div>
              </div>
              <div className="fourth-grid">
                <button
                  className="fourth-card go"
                  onClick={() => {
                    haptic('select');
                    m.chooseFourth('go');
                  }}
                >
                  <b>GO FOR IT</b>
                  <small>Pick a play. Trust the tape.</small>
                </button>
                <button
                  className="fourth-card"
                  onClick={() => {
                    haptic('select');
                    m.chooseFourth('punt');
                  }}
                >
                  <b>PUNT</b>
                  <small>Flip the field. No points.</small>
                </button>
                <button
                  className="fourth-card fg"
                  disabled={!m.canGoForFieldGoal}
                  onClick={() => {
                    haptic('select');
                    m.chooseFourth('fg');
                  }}
                >
                  <b>{m.fieldGoalDistance} YD FG</b>
                  <small>{m.canGoForFieldGoal ? 'Legs only. Hit the meter.' : 'Out of range'}</small>
                </button>
              </div>
              {m.canRewind() && (
                <div className="fourth-rewind">
                  <PixelButton variant="gold" tick={false} onClick={() => m.rewind()}>
                    ◀◀ REWIND ({m.state.rewinds})
                  </PixelButton>
                  <small className="dim">
                    Undo that snap. The down, the spot and the clock come back with it.
                  </small>
                </div>
              )}
            </div>
          )}

          {phase === 'block' && (
            <div className="deck-block block-deck">
              <div>
                <div className="eyebrow">SPECIAL TEAMS</div>
                <h2>PUNT BLOCKED</h2>
                <small className="dim">Loose ball — the kicking team has to fall on it.</small>
              </div>
              <PixelButton variant="ghost" onClick={() => m.settleBlock()}>
                WHISTLE ▶
              </PixelButton>
            </div>
          )}

          {phase === 'kick' && (
            <div className="deck-block kick-deck">
              <div className="kick-copy">
                <div className="eyebrow">TAKE THE POINTS</div>
                <h2>{m.fieldGoalDistance} YARD FIELD GOAL</h2>
                <small className="dim">Time it in the green zone. TAP KICK or hit the field.</small>
              </div>
              <button className="kick-btn" onClick={() => m.kickNow()}>
                KICK IT
              </button>
            </div>
          )}

          {(phase === 'quarter' || (phase === 'halftime' && !reel)) && (
            <div className="deck-block quarter-deck">
              <div>
                <div className="eyebrow">
                  {phase === 'halftime' ? 'HALFTIME' : 'END OF QUARTER'}
                </div>
                <h2>
                  {m.overtimeReady
                    ? 'TIED UP. SUDDEN DEATH TIME.'
                    : phase === 'halftime'
                      ? 'HALFTIME BREAK'
                      : `END OF ${m.state.quarter === 1 ? '1ST' : m.state.quarter === 2 ? '2ND' : m.state.quarter === 3 ? '3RD' : '4TH'}`}
                </h2>
                <div className="quarter-score">
                  <TeamBadge team={m.playerTeam} size="sm" />
                  <b>
                    {m.state.scoreUs} — {m.state.scoreThem}
                  </b>
                  <TeamBadge team={opponent} size="sm" />
                </div>
              </div>
              <PixelButton className="btn-wide" onClick={() => m.continueQuarter()}>
                {m.overtimeReady ? 'START OT ▶' : 'CONTINUE ▶'}
              </PixelButton>
            </div>
          )}

          {phase === 'halftime' && reel && (
            <div className="deck-block reel-deck">
              <div className="reel-head">
                <div>
                  <div className="eyebrow">
                    FIRST-HALF TAPE · {Math.min(reel.index + 1, reel.moments.length)}/{reel.moments.length}
                  </div>
                  <h2>{reel.active ? 'HIGHLIGHT REEL' : 'TAPE COMPLETE'}</h2>
                </div>
                <div className="quarter-score">
                  <TeamBadge team={m.playerTeam} size="sm" />
                  <b>
                    {m.state.scoreUs} — {m.state.scoreThem}
                  </b>
                  <TeamBadge team={opponent} size="sm" />
                </div>
              </div>
              <ol className="reel-strip">
                {reel.moments.map((film, i) => (
                  <li
                    key={film.playCounter}
                    className={`reel-item ${
                      reel.active && i === reel.index ? 'now' : i < reel.index || !reel.active ? 'past' : ''
                    }`}
                  >
                    <b>{film.moment.headline}</b>
                    <span>{film.moment.label}</span>
                  </li>
                ))}
              </ol>
              <div className="reel-actions">
                <PixelButton variant="ghost" onClick={() => m.endReel()}>
                  SKIP ▶▶
                </PixelButton>
                <PixelButton variant="ghost" onClick={() => m.replayReel()}>
                  REPLAY ◀◀
                </PixelButton>
                {reel.active ? (
                  <PixelButton variant="gold" onClick={() => m.reelNext()}>
                    NEXT ▶
                  </PixelButton>
                ) : (
                  <PixelButton variant="gold" className="btn-wide" onClick={() => m.continueQuarter()}>
                    START 3RD ▶
                  </PixelButton>
                )}
              </div>
              <div className="reel-note dim small">
                {franchise.settings.reducedMotion || franchise.settings.slowmo === 'off'
                  ? 'Time is left alone — the tape plays at full speed.'
                  : franchise.settings.slowmo === 'short'
                    ? 'Your own snaps, replayed with a shorter dip. Tap the field for the next one.'
                    : 'Your own snaps, filmed as they happened and replayed at half speed. Tap the field for the next one.'}
              </div>
            </div>
          )}

          {phase === 'defense' && (
            <div className="deck-block defense-deck">
              <div>
                <div className="eyebrow">DEFENSE</div>
                <h2>{opponent.abbr} BALL</h2>
                <small className="dim">Drive simulated live · your defense is on its own</small>
              </div>
              <PixelButton variant="ghost" onClick={() => m.skipDrive()}>
                SKIP ▶▶
              </PixelButton>
            </div>
          )}

          {phase === 'final' && summary && (
            <div className="deck-block final-deck">
              <div className="final-score">
                <div>
                  <span className="eyebrow">{summary.win ? 'BALL GAME · WIN' : summary.tie ? 'BALL GAME · TIE' : 'BALL GAME · LOSS'}</span>
                  <h2 className={`final-verdict ${summary.win ? 'win' : summary.tie ? 'tie' : 'loss'}`}>
                    {summary.ourScore} — {summary.theirScore}
                  </h2>
                  <small className="dim">
                    {opponent.city} {opponent.nickname} · {summary.totalYards} total yards · {summary.touchdowns} TD
                  </small>
                </div>
                <div className="tape-earned">
                  ▤ +{summary.tapeEarned}
                  <small>TAPE</small>
                </div>
              </div>
              <div className="final-body">
                <div className="final-stats">
                  <div className="eyebrow">STAT LEADERS</div>
                  {topStats.map((s) => (
                    <div key={s.id} className="stat-row">
                      <b>{s.name}</b>
                      <span>{s.text}</span>
                    </div>
                  ))}
                  {topStats.length === 0 && <span className="dim small">A quiet day at the office.</span>}
                  <div className="mvp-line">
                    ★ GAME MVP: <b>{summary.mvpName}</b>
                  </div>
                </div>
                <div className="final-highlights">
                  <div className="eyebrow">TAPE HIGHLIGHTS</div>
                  {summary.highlights.length ? (
                    summary.highlights.map((h, i) => <p key={i}>▸ {h}</p>)
                  ) : (
                    <p className="dim">No highlights. Burn the film.</p>
                  )}
                </div>
              </div>
              <PixelButton className="btn-wide btn-xl" variant="gold" onClick={finish}>
                FILE THE REPORT ▶
              </PixelButton>
            </div>
          )}
        </div>
      </div>

      {(paused || confirmQuit) && (
        <div className="modal-backdrop">
          <div className="modal pause-modal">
            <header className="modal-head">
              <div>
                <div className="eyebrow">TAPE DECK</div>
                <h2>{confirmQuit ? 'LEAVE THE GAME?' : 'PAUSED'}</h2>
              </div>
            </header>
            <div className="modal-body">
              {confirmQuit ? (
                <p className="modal-copy">
                  Walking out now forfeits this week. No tape, no stats — the schedule waits.
                </p>
              ) : (
                <div className="pause-stats">
                  <div>
                    <b>
                      {m.state.scoreUs} — {m.state.scoreThem}
                    </b>
                    <span>SCORE</span>
                  </div>
                  <div>
                    <b>{m.state.rewinds}</b>
                    <span>REWINDS</span>
                  </div>
                  <div>
                    <b>{Math.round(m.state.hype)}</b>
                    <span>HYPE</span>
                  </div>
                  <div>
                    <b>{m.totalYards}</b>
                    <span>YARDS</span>
                  </div>
                </div>
              )}
              {!confirmQuit && (
                <div className="pause-log">
                  <div className="eyebrow">
                    DRIVE LOG · {m.state.drivePlays} SNAP{m.state.drivePlays === 1 ? '' : 'S'} ·{' '}
                    {m.state.driveYards >= 0 ? `+${m.state.driveYards}` : m.state.driveYards} YDS
                  </div>
                  {m.playLog.length ? (
                    <div className="drive-feed play-log">
                      {m.playLog.map((entry, i) => (
                        <div key={i} className={`drive-play ${logTone(entry)}`}>
                          <span className="drive-down">{downLabel(entry.down, entry.toGo)}</span>
                          <span className="drive-text">{entry.text}</span>
                          <b className={entry.incomplete ? 'gold' : entry.yards >= 0 ? 'up' : 'down'}>
                            {entry.incomplete
                              ? `${entry.airYards ?? 0} AIR`
                              : entry.yards > 0
                                ? `+${entry.yards}`
                                : entry.yards}
                          </b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="dim small">No snaps yet this drive.</span>
                  )}
                </div>
              )}
              <div className="modal-actions">
                {confirmQuit ? (
                  <>
                    <PixelButton variant="ghost" onClick={() => setConfirmQuit(false)}>
                      KEEP PLAYING
                    </PixelButton>
                    <PixelButton variant="danger" onClick={onExit}>
                      FORFEIT &amp; EXIT
                    </PixelButton>
                  </>
                ) : (
                  <>
                    <PixelButton variant="ghost" onClick={() => setConfirmQuit(true)}>
                      QUIT GAME
                    </PixelButton>
                    <PixelButton onClick={() => setPaused(false)}>RESUME ▶</PixelButton>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

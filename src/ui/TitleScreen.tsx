import { useEffect, useRef, useState } from 'react';
import type { Franchise } from '../game/types';
import { playerTeam, seasonTotals } from '../game/season';
import { TEAMS } from '../game/data';
import { audio } from '../game/audio';
import { haptic } from '../native';
import { APP_VERSION } from '../version';
import { fmtRecord, Modal, PixelButton, TeamBadge } from './components';

export function TitleScreen({
  franchise,
  onContinue,
  onNew,
}: {
  franchise: Franchise | null;
  onContinue: () => void;
  onNew: (teamId?: string) => void;
}) {
  const [confirmNew, setConfirmNew] = useState(false);
  const [help, setHelp] = useState(false);
  const [pick, setPick] = useState(false);
  const [pickId, setPickId] = useState(TEAMS[0].id);

  // Holding the build stamp opens DEVICE CHECK — the hardware checklist panel.
  const holdTimer = useRef<number | null>(null);
  const cancelHold = () => {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const startHold = () => {
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      window.dispatchEvent(new CustomEvent('rb:diag'));
    }, 700);
  };
  useEffect(() => cancelHold, []);

  const team = franchise ? playerTeam(franchise) : null;
  const totals = franchise ? seasonTotals(franchise) : null;

  const start = () => {
    if (franchise) setConfirmNew(true);
    else setPick(true);
  };

  return (
    <div className="screen title-screen">
      <div className="title-field" aria-hidden>
        <div className="title-field-lines" />
        <div className="title-spotlight" />
        <div className="title-crowd" />
      </div>

      <div className="title-vhs">
        <span className="rec-dot" /> REC
        <span className="title-vhs-ch">CH 03</span>
        <span className="title-vhs-sp">SP 0:00:00</span>
      </div>

      <div className="title-stack">
        <div className="title-kicker">A TAP-FIRST FOOTBALL STORY</div>
        <h1 className="game-logo" aria-label="Rewind Bowl">
          <span className="logo-line logo-rewind">REWIND</span>
          <span className="logo-line logo-bowl">BOWL</span>
          <span className="logo-season">SEASON &apos;87</span>
          <span className="logo-ghost" aria-hidden>
            REWIND BOWL
          </span>
        </h1>
        <p className="tagline">CALL THE PLAY. RUN THE ROCK. REWIND THE TAPE.</p>

        <div className="title-features">
          <span>
            <b>◀◀</b> REWIND BAD PLAYS
          </span>
          <span>
            <b>⚡</b> HYPE BURSTS
          </span>
          <span>
            <b>★</b> 8-WEEK SEASON
          </span>
        </div>

        <div className="title-cta">
          {franchise && (
            <PixelButton className="btn-xl" onClick={onContinue}>
              CONTINUE FRANCHISE ▶
            </PixelButton>
          )}
          <PixelButton
            className="btn-xl"
            variant={franchise ? 'ghost' : 'primary'}
            onClick={start}
          >
            {franchise ? 'NEW FRANCHISE' : 'START FRANCHISE ▶'}
          </PixelButton>
          <PixelButton variant="quiet" onClick={() => setHelp(true)}>
            HOW TO PLAY
          </PixelButton>
        </div>

        {franchise && team && totals && (
          <div className="save-line">
            <TeamBadge team={team} size="sm" />
            <span>
              SEASON {franchise.season} · WEEK {Math.min(franchise.week, 10)} ·{' '}
              {fmtRecord(totals.wins, totals.losses, totals.ties)} · {franchise.tape} TAPE
            </span>
          </div>
        )}
      </div>

      <div className="title-foot">
        <span>{team ? `${team.city} ${team.nickname} · GRIDIRON LEAGUE` : `GRIDIRON LEAGUE · ${TEAMS.length} CLUBS`}</span>
        <span>ONE THUMB. FOUR QUARTERS. NO MULLIGANS — EXCEPT THE TAPE.</span>
        <span
          className="build-stamp"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
        >
          BUILD {APP_VERSION} · HOLD FOR DEVICE CHECK
        </span>
      </div>

      {confirmNew && franchise && (
        <Modal
          title="REPLACE THE TAPE?"
          eyebrow="WARNING"
          onClose={() => setConfirmNew(false)}
        >
          <p className="modal-copy">
            Starting a new franchise erases your current save: Season {franchise.season},
            week {Math.min(franchise.week, 10)}, {franchise.tape} tape,{' '}
            {franchise.history.filter((h) => h.wonBowl).length} championship
            {franchise.history.filter((h) => h.wonBowl).length === 1 ? '' : 's'}.
          </p>
          <div className="modal-actions">
            <PixelButton variant="ghost" onClick={() => setConfirmNew(false)}>
              KEEP PLAYING
            </PixelButton>
            <PixelButton
              variant="danger"
              onClick={() => {
                setConfirmNew(false);
                setPick(true);
              }}
            >
              ERASE &amp; PICK A CLUB
            </PixelButton>
          </div>
        </Modal>
      )}

      {pick && (
        <Modal title="CHOOSE YOUR CLUB" eyebrow="NEW FRANCHISE" onClose={() => setPick(false)} wide>
          <p className="modal-copy">
            Eight clubs, one tape. Whoever you pick is the team you coach — its colours fill the
            end zone, its nickname goes on the box score — and you can repaint the whole thing in
            the club editor once you are in the building.
          </p>
          <div className="team-picker">
            {TEAMS.map((t) => (
              <button
                key={t.id}
                className={`team-card ${pickId === t.id ? 'selected' : ''}`}
                onClick={() => {
                  haptic('select');
                  audio.play('select');
                  setPickId(t.id);
                }}
              >
                <div className="team-card-head">
                  <TeamBadge team={t} size="sm" />
                  <div>
                    <b>{t.city}</b>
                    <small>{t.nickname}</small>
                  </div>
                </div>
                <div className="team-card-grades">
                  <span>
                    OFF <b>{t.off}</b>
                  </span>
                  <span>
                    DEF <b>{t.def}</b>
                  </span>
                  <span>
                    KICK <b>{t.kick}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <PixelButton variant="ghost" onClick={() => setPick(false)}>
              BACK
            </PixelButton>
            <PixelButton
              variant="gold"
              onClick={() => {
                const chosen = TEAMS.find((t) => t.id === pickId) ?? TEAMS[0];
                audio.init();
                setPick(false);
                onNew(chosen.id);
              }}
            >
              COACH THE {TEAMS.find((t) => t.id === pickId)?.nickname ?? 'CLUB'} ▶
            </PixelButton>
          </div>
        </Modal>
      )}

      {help && (
        <Modal title="HOW TO PLAY" eyebrow="COACH'S CLINIC" onClose={() => setHelp(false)} wide>
          <div className="help-grid">
            <div>
              <h3>ON OFFENSE</h3>
              <p>
                You coach the offense. Four play cards are dealt each down. The scout hint tells
                you what the defense is showing — blitzes leave receivers open, deep shells give
                you the underneath.
              </p>
              <ul>
                <li>
                  <b>Tap a receiver</b> (or any open spot) to throw. Lead your man away from the
                  coverage.
                </li>
                <li>
                  <b>Drag anywhere</b> to run after the catch or handoff. Sharp cuts can break
                  ankles.
                </li>
                <li>
                  <b>Tap your QB</b> — or push the stick, or drag the field — to <b>scramble</b>.
                  He tucks it and runs: the gains are his rushing yards, a loss is a loss on the
                  ground, and there is no throw to regret.
                </li>
                <li>
                  <b>BURST</b> spends 34 hype for a guaranteed broken tackle and a speed spike.
                </li>
                <li>
                  <b>AUDIBLE</b> costs 22 hype and rerolls your play cards.
                </li>
              </ul>
            </div>
            <div>
              <h3>THE TAPE DECK</h3>
              <p>
                Rewinding undoes the last snap — score, clock, stats and all. It costs one tape
                token, and you bank another every touchdown. Use it on a back-breaking pick or a
                fourth-down stop.
              </p>
              <h3>BUILD THE DYNASTY</h3>
              <p>
                Eight weeks, top four make the playoffs, then the Gridiron Bowl. Earn tape, train
                players, meet morale demands, and draft a rookie each offseason. Quirks like{' '}
                <b>SHOWTIME</b>, <b>CANNON</b> and <b>CLUTCH</b> change every snap.
              </p>
              <p className="dim">
                Your defense is simulated drive-by-drive. Build a roster that can rush the passer
                and cover — the scoreboard notices.
              </p>
            </div>
          </div>
          <div className="help-controls">
            <span>
              <b>DESKTOP:</b> arrows/WASD to run · 1–5 to throw · Q scramble · B burst · R rewind · ESC
              pause
            </span>
          </div>
          <div className="modal-actions">
            <PixelButton onClick={() => setHelp(false)}>GOT IT ▶</PixelButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { Franchise, Player, Ratings } from '../game/types';
import { getTeam, playerTeam, seasonTotals, signRookie } from '../game/season';
import { canFieldLineup, overall } from '../game/market';
import { QUIRKS } from '../game/data';
import { audio } from '../game/audio';
import { haptic } from '../native';
import {
  Empty,
  keyRatings,
  Panel,
  PixelButton,
  QuirkChip,
  RatingBar,
  TeamBadge,
} from './components';

/** The draft's cut runs on the market's lineup rule: pay for the pick, then make room. */
function canCutAfterSigning(franchise: Franchise, cut: Player, rookie: Player): boolean {
  return canFieldLineup(franchise.roster.filter((p) => p.id !== cut.id).concat(rookie));
}

export function OffseasonScreen({
  franchise,
  update,
  onStartSeason,
  onHub,
}: {
  franchise: Franchise;
  update: (fn: (f: Franchise) => void) => void;
  onStartSeason: () => void;
  onHub: () => void;
}) {
  const team = playerTeam(franchise);
  const totals = seasonTotals(franchise);
  const entry = franchise.history[franchise.history.length - 1];
  const champion = franchise.championId ? getTeam(franchise, franchise.championId) : null;
  const pool = franchise.draftPool;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cutId, setCutId] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const selected = pool?.find((p) => p.id === selectedId) ?? null;
  const cut = franchise.roster.find((p) => p.id === cutId) ?? null;
  const canSign = Boolean(selected && cut && canCutAfterSigning(franchise, cut, selected));

  const sign = () => {
    if (!selected || !cut || !canSign) return;
    update((f) => {
      signRookie(f, selected.id, cut.id);
    });
    setSigned(true);
    audio.play('td');
  };

  const skip = () => {
    update((f) => {
      f.draftPool = null;
    });
    setSigned(true);
    audio.play('select');
  };

  return (
    <div className="screen offseason-screen">
      <header className="topbar">
        <button
          className="brandmark"
          onClick={() => {
            haptic('select');
            onHub();
          }}
        >
          <span className="brandmark-tape">◀◀</span> REWIND BOWL
        </button>
        <div className="topbar-actions">
          <span className="tape-chip">▤ {franchise.tape} TAPE</span>
        </div>
      </header>

      <div className="hub-scroll">
        <section
          className="offseason-hero"
          style={{ borderColor: `${team.colors.primary}55` }}
        >
          <div className="eyebrow">POST-SEASON · YEAR {franchise.season}</div>
          <h1>
            SEASON {franchise.season} IS <span>IN THE CAN</span>
          </h1>
          <p>
            {entry?.wonBowl
              ? 'Champions. Somebody call the parade route.'
              : entry?.madePlayoffs
                ? 'A playoff run to remember. Next year, finish it.'
                : 'No playoffs. The film room is going to be busy this winter.'}
          </p>
          <div className="recap-grid">
            <div>
              <b>
                {totals.wins}-{totals.losses}
                {totals.ties ? `-${totals.ties}` : ''}
              </b>
              <span>RECORD</span>
            </div>
            <div>
              <b>{totals.pf}</b>
              <span>POINTS</span>
            </div>
            <div>
              <b>{entry?.madePlayoffs ? 'YES' : 'NO'}</b>
              <span>PLAYOFFS</span>
            </div>
            <div>
              <b>{entry?.wonBowl ? '★' : '—'}</b>
              <span>BOWL</span>
            </div>
          </div>
          <div className="recap-footer">
            <div>
              <span className="dim small">SEASON MVP</span>
              <b>{entry?.mvpName ?? '—'}</b>
            </div>
            {champion && (
              <div className="champion-line">
                ★ {champion.city} {champion.nickname} won the Gridiron Bowl
                {entry?.bowlScore ? ` · ${entry.bowlScore}` : ''}
              </div>
            )}
          </div>
        </section>

        {!signed && pool && pool.length > 0 ? (
          <>
            <div className="section-head">
              <h2>SCOUTING REPORT</h2>
              <span className="dim small">ONE PICK · MAKE IT COUNT</span>
            </div>
            <div className="prospect-grid">
              {pool.map((p) => (
                <button
                  key={p.id}
                  className={`prospect ${selectedId === p.id ? 'selected' : ''}`}
                  onClick={() => {
                    haptic('select');
                    setSelectedId(p.id);
                    audio.play('select');
                  }}
                >
                  <div className="prospect-top">
                    <span className="prospect-pos">{p.pos}</span>
                    <span className="prospect-ovr">{overall(p)}</span>
                  </div>
                  <h3>{p.name}</h3>
                  <div className="prospect-ratings">
                    {keyRatings(p).map((r) => (
                      <span key={r.key}>
                        {r.label} <b>{p.ratings[r.key]}</b>
                      </span>
                    ))}
                  </div>
                  <QuirkChip id={p.quirk} small />
                </button>
              ))}
            </div>

            {selected && (
              <Panel className="draft-pick-panel">
                <div className="section-head">
                  <h2>SIGN {selected.name.toUpperCase()}</h2>
                  <span className="dim small">CHOOSE A PLAYER TO RELEASE</span>
                </div>
                <div className="draft-detail">
                  <div className="draft-prospect-big">
                    <span className="prospect-pos">{selected.pos}</span>
                    <h3>{selected.name}</h3>
                    <QuirkChip id={selected.quirk} />
                    <p className="muted small">{QUIRKS[selected.quirk]?.desc}</p>
                    <div className="rating-stack">
                      {(Object.keys(selected.ratings) as (keyof Ratings)[]).map((key) => (
                        <RatingBar key={key} label={key.toUpperCase()} value={selected.ratings[key]} compact />
                      ))}
                    </div>
                  </div>
                  <div className="cut-list">
                    {franchise.roster.map((p) => {
                      const allowed = canCutAfterSigning(franchise, p, selected);
                      return (
                        <button
                          key={p.id}
                          className={`cut-row ${cutId === p.id ? 'selected' : ''} ${!allowed ? 'disabled' : ''}`}
                          disabled={!allowed}
                          onClick={() => {
                            haptic('select');
                            setCutId(p.id);
                          }}
                        >
                          <span className="num">{p.num}</span>
                          <span className="who">
                            <b>{p.name}</b>
                            <small>
                              {p.pos} · {overall(p)} OVR · {p.quirk.replace(/_/g, ' ').toUpperCase()}
                            </small>
                          </span>
                          <span className={allowed ? 'dim small' : 'warn small'}>
                            {allowed ? 'RELEASE' : 'NEEDED'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="modal-actions">
                  <PixelButton variant="ghost" onClick={skip}>
                    SKIP DRAFT
                  </PixelButton>
                  <PixelButton variant="gold" disabled={!canSign} onClick={sign}>
                    SIGN ROOKIE &amp; CUT ▶
                  </PixelButton>
                </div>
              </Panel>
            )}

            {!selected && (
              <div className="draft-actions">
                <PixelButton variant="ghost" onClick={skip}>
                  SKIP DRAFT
                </PixelButton>
              </div>
            )}
          </>
        ) : (
          <Panel className="roster-set-panel">
            <div className="eyebrow">ROSTER LOCKED</div>
            <h2>{signed ? 'THE ROOKIE IS IN THE BUILDING' : 'NO DRAFT PICKS MADE'}</h2>
            <p className="muted">
              Training camp is next. Spend tape, set your lineup, and get ready for season{' '}
              {franchise.season + 1}.
            </p>
            <div className="ready-roster">
              {franchise.roster.map((p) => (
                <span key={p.id} className="ready-player">
                  <b>{p.num}</b> {p.name.split(' ')[1] ?? p.name} <i>{p.pos}</i>
                </span>
              ))}
            </div>
            <div className="modal-actions">
              <PixelButton variant="ghost" onClick={onHub}>
                BACK TO HUB
              </PixelButton>
              <PixelButton className="btn-wide" onClick={onStartSeason}>
                START SEASON {franchise.season + 1} ▶
              </PixelButton>
            </div>
          </Panel>
        )}

        {!pool && !signed && (
          <Panel>
            <Empty text="NO DRAFT CLASS AVAILABLE" />
          </Panel>
        )}

        <footer className="hub-footer">
          <span>REWIND BOWL '87 · OFFSEASON</span>
          <span className="dim small">
            ★ {franchise.history.filter((h) => h.wonBowl).length}{' '}
            {franchise.history.filter((h) => h.wonBowl).length === 1 ? 'TITLE' : 'TITLES'}
          </span>
        </footer>
      </div>
    </div>
  );
}

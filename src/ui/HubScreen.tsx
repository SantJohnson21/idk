import { useMemo, useState } from 'react';
import { ACHIEVEMENTS } from '../game/achievements';
import type { Franchise, Player, Ratings } from '../game/types';
import {
  activeWeek,
  getTeam,
  opponentForWeek,
  playerTeam,
  restTeam,
  rewindCost,
  seasonTotals,
  sortedStandings,
  trainPlayer,
  trainingCost,
  upgradeRewinds,
} from '../game/season';
import { QUIRKS, REGULAR_WEEKS, WEATHER } from '../game/data';
import { audio } from '../game/audio';
import { haptic, setHapticsEnabled } from '../native';
import { TeamEditor } from './TeamEditor';
import { MARKET } from '../game/constants';
import { careerStage } from '../game/development';
import {
  buyPrice,
  dealVerdict,
  depthTag,
  overall,
  placeInRoster,
  sellPlayer,
  sellValue,
  sellVerdict,
  signFreeAgent,
  type Deal,
} from '../game/market';
import {
  DevTraitChip,
  Empty,
  fmtRecord,
  keyRatings,
  Modal,
  MoraleMeter,
  Panel,
  PixelButton,
  QuirkChip,
  RatingBar,
  TeamBadge,
} from './components';

type Tab = 'locker' | 'season' | 'film';

const RATING_LABELS: Record<keyof Ratings, string> = {
  spd: 'SPEED',
  arm: 'ARM',
  hands: 'HANDS',
  blk: 'BLOCK',
  cov: 'COVERAGE',
  tkl: 'TACKLE',
  pow: 'POWER',
};

const UNIT_ORDER = ['QB', 'RB', 'WR', 'SLOT', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];

export function HubScreen({
  franchise,
  update,
  onPlay,
  onOffseason,
  onTitle,
}: {
  franchise: Franchise;
  update: (fn: (f: Franchise) => void) => void;
  onPlay: () => void;
  onOffseason: () => void;
  onTitle: () => void;
}) {
  const [tab, setTab] = useState<Tab>('locker');
  const [trainId, setTrainId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [market, setMarket] = useState(false);
  const [club, setClub] = useState(false);

  const team = playerTeam(franchise);
  const week = activeWeek(franchise);
  const opp = opponentForWeek(franchise);
  const totals = seasonTotals(franchise);
  const record = franchise.standings[team.id] ?? { w: totals.wins, l: totals.losses, t: totals.ties };
  // A tie is a result, not a loss: the saved summary carries its own flag, so the
  // card never has to guess from the score whether the game was drawn.
  const lastGame = franchise.lastGameSummary;
  const lastTie = Boolean(lastGame && lastGame.tie);
  const standings = useMemo(() => sortedStandings(franchise), [franchise]);
  const trainers = franchise.roster.find((p) => p.id === trainId) ?? null;
  const isOffseason = franchise.seasonStage === 'offseason';
  const playoff = franchise.seasonStage === 'playoffs';
  const moraleAvg = Math.round(
    franchise.roster.reduce((sum, p) => sum + p.morale, 0) / Math.max(1, franchise.roster.length),
  );

  const training = (player: Player, stat: keyof Ratings) => {
    update((f) => {
      trainPlayer(f, player.id, stat);
    });
    audio.init();
    audio.play('select');
  };

  const stageLabel = week?.stage === 'bowl' ? 'GRIDIRON BOWL' : week?.stage === 'semi' ? 'SEMIFINAL' : `WEEK ${week?.week ?? franchise.week}`;

  const clickTab = (t: Tab) => {
    setTab(t);
    haptic('select');
    audio.init();
    audio.play('select');
  };

  const wire = franchise.freeAgents ?? [];
  const topAgent = [...wire].sort((a, b) => overall(b) - overall(a))[0] ?? null;

  const openMarket = () => {
    haptic('select');
    audio.init();
    audio.play('select');
    setMarket(true);
  };

  const openSettings = () => {
    haptic('select');
    setSettings(true);
  };

  return (
    <div className="screen hub-screen">
      <header className="topbar">
        <button className="brandmark" onClick={() => clickTab('locker')}>
          <span className="brandmark-tape">◀◀</span> REWIND BOWL
        </button>
        <div className="topbar-actions">
          <span className="tape-chip">▤ {franchise.tape} TAPE</span>
          <button className="icon-btn" aria-label="Settings" onClick={openSettings}>
            ⚙
          </button>
        </div>
      </header>

      <div className="hub-scroll">
        <div
          className="team-hero"
          style={{
            background: `linear-gradient(120deg, ${team.colors.dark}, #0a1119 72%)`,
            borderColor: `${team.colors.primary}44`,
          }}
        >
          <TeamBadge team={team} size="lg" />
          <div className="team-hero-copy">
            <div className="eyebrow">YOUR FRANCHISE</div>
            <h1>
              {team.city} <span>{team.nickname}</span>
            </h1>
            <p>
              SEASON {franchise.season} ·{' '}
              {isOffseason ? 'OFFSEASON' : `WEEK ${Math.min(franchise.week, franchise.schedule.length)}`}
              {' · '}
              <span className="dim">{franchise.difficulty.toUpperCase()}</span>
            </p>
            <button
              className="text-btn club-edit-btn"
              onClick={() => {
                haptic('select');
                audio.init();
                audio.play('select');
                setClub(true);
              }}
            >
              ✎ EDIT CLUB
            </button>
          </div>
          <div className="hero-record">
            <b>{fmtRecord(record.w, record.l, record.t)}</b>
            <span>RECORD</span>
          </div>
        </div>

        {isOffseason ? (
          <Panel className="next-game offseason-card">
            <div className="week-tag">SEASON COMPLETE</div>
            <h2>THE TAPE IS IN THE CAN</h2>
            <p className="muted">
              Review the season, sign a rookie and get the roster ready for next year.
            </p>
            <div className="pill-row">
              <span className="pill">▤ {franchise.tape} TAPE</span>
              <span className="pill">◀◀ {2 + franchise.rewindLevel} REWINDS</span>
              <span className="pill">
                ★ {franchise.history.filter((h) => h.wonBowl).length} TITLES
              </span>
            </div>
            <PixelButton className="btn-wide" onClick={onOffseason}>
              GO TO OFFSEASON ▶
            </PixelButton>
          </Panel>
        ) : week && opp ? (
          <Panel className="next-game">
            <div className="week-tag">
              {stageLabel} {week.home ? '· HOME' : '· AWAY'}
            </div>
            <div className="matchup">
              <div className="matchup-side">
                <TeamBadge team={team} size="md" />
                <b>{team.abbr}</b>
                <span>{fmtRecord(record.w, record.l, record.t)}</span>
              </div>
              <div className="vs">
                <span>VS</span>
                <i />
              </div>
              <div className="matchup-side">
                <TeamBadge team={opp} size="md" />
                <b>{opp.abbr}</b>
                <span>
                  {(() => {
                    const s = franchise.standings[opp.id];
                    return s ? fmtRecord(s.w, s.l, s.t) : '0-0';
                  })()}
                </span>
              </div>
            </div>
            <div className="game-meta">
              <span>
                {WEATHER[week.weather].icon} {WEATHER[week.weather].name}
              </span>
              <span>OFF {opp.off}</span>
              <span>DEF {opp.def}</span>
              <span>{playoff ? 'WIN OR GO HOME' : 'GRIDIRON LEAGUE'}</span>
            </div>
            <p className="weather-desc">{WEATHER[week.weather].desc}</p>
            <PixelButton className="btn-wide take-field" onClick={onPlay}>
              {week.stage === 'bowl' ? 'PLAY THE BOWL ▶' : week.stage === 'semi' ? 'PLAY SEMIFINAL ▶' : 'TAKE THE FIELD ▶'}
            </PixelButton>
            {lastGame && (
              <div className={`last-result ${lastGame.win ? 'win' : lastTie ? 'tie' : 'loss'}`}>
                LAST: {lastGame.win ? 'W' : lastTie ? 'T' : 'L'} {lastGame.our}-{lastGame.theirs} vs{' '}
                {getTeam(franchise, lastGame.opponentId).abbr} · +{lastGame.tapeEarned} TAPE
              </div>
            )}
          </Panel>
        ) : (
          <Panel className="next-game">
            <Empty text="NO MATCHUP SCHEDULED" />
          </Panel>
        )}

        <div className="tabrow">
          <button className={tab === 'locker' ? 'tab active' : 'tab'} onClick={() => clickTab('locker')}>
            LOCKER
          </button>
          <button className={tab === 'season' ? 'tab active' : 'tab'} onClick={() => clickTab('season')}>
            SEASON
          </button>
          <button className={tab === 'film' ? 'tab active' : 'tab'} onClick={() => clickTab('film')}>
            FILM ROOM
          </button>
        </div>

        {tab === 'locker' && (
          <div className="tab-content">
            <div className="stat-strip">
              <div>
                <b>{franchise.tape}</b>
                <span>TAPE</span>
              </div>
              <div>
                <b>{2 + franchise.rewindLevel}</b>
                <span>REWINDS</span>
              </div>
              <div>
                <b>{moraleAvg}</b>
                <span>MORALE</span>
              </div>
              <div>
                <b>{totals.wins + totals.losses + totals.ties}</b>
                <span>GAMES</span>
              </div>
            </div>

            <Panel className="deck-card">
              <div className="deck-copy">
                <div className="eyebrow">TAPE DECK</div>
                <h3>REWIND CAPACITY {2 + franchise.rewindLevel}</h3>
                <p>
                  Every game starts with {2 + franchise.rewindLevel} rewind tokens. Touchdowns
                  bank another, up to {2 + franchise.rewindLevel + 2}.
                </p>
              </div>
              <div className="deck-action">
                <span className="cost">▤ {franchise.rewindLevel >= 2 ? 'MAXED' : rewindCost(franchise)}</span>
                <PixelButton
                  variant="gold"
                  disabled={franchise.rewindLevel >= 2 || franchise.tape < rewindCost(franchise)}
                  onClick={() => {
                    update((f) => {
                      upgradeRewinds(f);
                    });
                    audio.play('fg');
                  }}
                >
                  {franchise.rewindLevel >= 2 ? 'FULL DECK' : 'UPGRADE +1'}
                </PixelButton>
              </div>
            </Panel>

            <Panel className="deck-card">
              <div className="deck-copy">
                <div className="eyebrow">THE MARKET</div>
                <h3>
                  {wire.length} VETERAN{wire.length === 1 ? '' : 'S'} ON THE WIRE
                </h3>
                <p>
                  {topAgent
                    ? `${topAgent.name} · ${overall(topAgent)} OVR at ▤ ${buyPrice(topAgent)} is the best of them. `
                    : 'The wire is picked clean. '}
                  Sign with tape, or sell a man you do not need.
                </p>
              </div>
              <div className="deck-action">
                <span className="cost">
                  ROSTER {franchise.roster.length}/{MARKET.rosterMax}
                </span>
                <PixelButton variant="gold" onClick={openMarket}>
                  OPEN MARKET
                </PixelButton>
              </div>
            </Panel>

            <div className="section-head">
              <h2>LOCKER ROOM</h2>
              <button
                className="text-btn"
                onClick={() => {
                  haptic('select');
                  update((f) => {
                    restTeam(f);
                  });
                  audio.play('first');
                }}
                disabled={franchise.tape < 50}
              >
                TEAM MEETING · 50 TAPE
              </button>
            </div>
            <p className="muted small">
              Tap a player to train. Stars with big egos need targets — feed them or the locker
              gets loud.
            </p>

            {(['OFFENSE', 'DEFENSE', 'SPECIAL TEAMS'] as const).map((unit) => {
              const players = franchise.roster
                .filter((p) => {
                  if (unit === 'OFFENSE') return ['QB', 'RB', 'WR', 'TE', 'OL'].includes(p.pos);
                  if (unit === 'DEFENSE') return ['DL', 'LB', 'CB', 'S'].includes(p.pos);
                  return p.pos === 'K';
                })
                .sort((a, b) => UNIT_ORDER.indexOf(a.pos) - UNIT_ORDER.indexOf(b.pos));
              if (!players.length) return null;
              return (
                <div className="roster-unit" key={unit}>
                  <div className="unit-head">
                    {unit} <span>{players.length}</span>
                  </div>
                  {players.map((p) => (
                    <button
                      className="player-row"
                      key={p.id}
                      onClick={() => {
                        haptic('select');
                        setTrainId(p.id);
                      }}
                    >
                      <span className="num">{p.num}</span>
                      <span className="who">
                        <b>
                          {p.name}
                          {p.trait === 'prodigy' && (
                            <span className="prodigy-star" title="PRODIGY — develops faster than the curve">
                              {' '}
                              ★
                            </span>
                          )}
                        </b>
                        <small>
                          {p.pos} · AGE {p.age} · {QUIRKS[p.quirk]?.name ?? 'NO QUIRK'}
                        </small>
                      </span>
                      <span className="mini-ratings">
                        {keyRatings(p).map((r) => (
                          <span key={r.key}>
                            {r.label} <b>{p.ratings[r.key]}</b>
                          </span>
                        ))}
                      </span>
                      <MoraleMeter value={p.morale} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'season' && (
          <div className="tab-content">
            <div className="two-col">
              <Panel className="schedule-panel">
                <div className="section-head">
                  <h2>SCHEDULE</h2>
                  <span className="dim small">
                    {fmtRecord(record.w, record.l, record.t)}
                  </span>
                </div>
                <div className="schedule-list">
                  {franchise.schedule.map((w) => {
                    const o = getTeam(franchise, w.opponentId);
                    const active = !isOffseason && w.week === franchise.week;
                    return (
                      <div className={`schedule-row ${active ? 'active' : ''}`} key={`${w.week}-${w.stage}`}>
                        <span className="wk">
                          {w.stage === 'bowl' ? 'BOWL' : w.stage === 'semi' ? 'SEMI' : `WK${w.week}`}
                        </span>
                        <span className="sch-opp">
                          <i>{w.home ? 'VS' : '@'}</i> {o.city} {o.nickname}
                        </span>
                        <span className="sch-wx">{WEATHER[w.weather].icon}</span>
                        <span className={`sch-res ${w.result ? (w.result.win ? 'w' : w.result.tie ? 't' : 'l') : ''}`}>
                          {w.result ? `${w.result.win ? 'W' : w.result.tie ? 'T' : 'L'} ${w.result.our}-${w.result.theirs}` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel className="standings-panel">
                <div className="section-head">
                  <h2>STANDINGS</h2>
                  <span className="dim small">TOP 4 → PLAYOFFS</span>
                </div>
                <table className="standings">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>TEAM</th>
                      <th>W-L-T</th>
                      <th>PF</th>
                      <th>PA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, i) => (
                      <tr
                        key={row.team.id}
                        className={`${row.team.id === team.id ? 'us' : ''} ${i < 4 ? 'seed' : ''}`}
                      >
                        <td>{i + 1}</td>
                        <td>
                          <span className="dot" style={{ background: row.team.colors.primary }} />
                          {row.team.abbr}
                        </td>
                        <td>
                          {row.w}-{row.l}
                          {row.t ? `-${row.t}` : ''}
                        </td>
                        <td>{row.pf}</td>
                        <td>{row.pa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>

            <Panel className="bracket-panel">
              <div className="section-head">
                <h2>THE ROAD TO THE BOWL</h2>
                {franchise.championId && (
                  <span className="champion-chip">
                    ★ {getTeam(franchise, franchise.championId).nickname} CHAMPIONS
                  </span>
                )}
              </div>
              {franchise.playoffSeeds ? (
                <div className="bracket">
                  <div className="bracket-col">
                    <div className="eyebrow">SEMIFINALS</div>
                    <BracketGame
                      franchise={franchise}
                      a={getTeam(franchise, franchise.playoffSeeds[0])}
                      b={getTeam(franchise, franchise.playoffSeeds[3])}
                    />
                    <BracketGame
                      franchise={franchise}
                      a={getTeam(franchise, franchise.playoffSeeds[1])}
                      b={getTeam(franchise, franchise.playoffSeeds[2])}
                    />
                  </div>
                  <div className="bracket-arrow">▶</div>
                  <div className="bracket-col">
                    <div className="eyebrow">GRIDIRON BOWL</div>
                    <div className="bracket-final">
                      <span>{franchise.championId ? `${getTeam(franchise, franchise.championId).city} ${getTeam(franchise, franchise.championId).nickname}` : 'TBD'}</span>
                      <small>
                        {franchise.schedule.find((w) => w.stage === 'bowl')?.result
                          ? `${franchise.schedule.find((w) => w.stage === 'bowl')!.result!.our} - ${franchise.schedule.find((w) => w.stage === 'bowl')!.result!.theirs}`
                          : 'AWAITING KICKOFF'}
                      </small>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="muted">
                  Win games, climb the standings, and finish in the top four after Week{' '}
                  {REGULAR_WEEKS}. Then it is win-or-go-home football.
                </p>
              )}
            </Panel>
          </div>
        )}

        {tab === 'film' && <FilmRoom franchise={franchise} />}

        <footer className="hub-footer">
          <span>REWIND BOWL '87 · TAPE ROLLING</span>
          <button className="text-btn" onClick={openSettings}>
            SETTINGS
          </button>
        </footer>
      </div>

      {trainers && (
        <TrainingModal
          franchise={franchise}
          player={trainers}
          onTrain={training}
          onClose={() => setTrainId(null)}
          onRest={() => {
            update((f) => {
              restTeam(f);
            });
            audio.play('first');
          }}
        />
      )}

      {market && (
        <MarketModal franchise={franchise} update={update} onClose={() => setMarket(false)} />
      )}

      {club && (
        <TeamEditor franchise={franchise} update={update} onClose={() => setClub(false)} />
      )}

      {settings && (
        <SettingsModal
          franchise={franchise}
          update={update}
          onClose={() => setSettings(false)}
          onTitle={() => {
            setSettings(false);
            onTitle();
          }}
        />
      )}
    </div>
  );
}

function BracketGame({
  franchise,
  a,
  b,
}: {
  franchise: Franchise;
  a: ReturnType<typeof getTeam>;
  b: ReturnType<typeof getTeam>;
}) {
  const ours = a.id === franchise.teamId || b.id === franchise.teamId;
  const result = franchise.schedule.find(
    (w) => w.stage === 'semi' && (w.opponentId === a.id || w.opponentId === b.id),
  );
  // The bracket reads the scoreline: a postseason game is played until it is
  // decided, so a tie is not a win for the opponent (or for anyone).
  const winner =
    result?.result && result.opponentId
      ? result.result.our === result.result.theirs
        ? null
        : result.result.our > result.result.theirs
          ? franchise.teamId
          : result.opponentId
      : null;
  return (
    <div className={`bracket-game ${ours ? 'ours' : ''}`}>
      <div className={winner === a.id ? 'winner' : ''}>
        <span className="dot" style={{ background: a.colors.primary }} />
        {a.city} {a.nickname}
      </div>
      <div className={winner === b.id ? 'winner' : ''}>
        <span className="dot" style={{ background: b.colors.primary }} />
        {b.city} {b.nickname}
      </div>
      {result?.result && (
        <small>
          {result.result.our === result.result.theirs
            ? 'NO WINNER'
            : result.result.our > result.result.theirs
              ? 'YOU ADVANCE'
              : 'SEASON OVER'}{' '}
          · {result.result.our}-{result.result.theirs}
        </small>
      )}
    </div>
  );
}

function TrainingModal({
  franchise,
  player,
  onTrain,
  onClose,
  onRest,
}: {
  franchise: Franchise;
  player: Player;
  onTrain: (p: Player, stat: keyof Ratings) => void;
  onClose: () => void;
  onRest: () => void;
}) {
  const quirk = QUIRKS[player.quirk];
  const stats = Object.keys(RATING_LABELS) as (keyof Ratings)[];
  return (
    <Modal
      title={player.name}
      eyebrow={`${player.pos} · #${player.num} · AGE ${player.age} ${careerStage(player.age)} · MORALE ${player.morale}`}
      onClose={onClose}
      wide
    >
      <div className="training-head">
        <div className="quirk-card">
          <span className="quirk-icon">{quirk?.icon}</span>
          <div>
            <b>{quirk?.name}</b>
            <p>{quirk?.desc}</p>
          </div>
        </div>
        <DevTraitChip player={player} />
        {player.trait === 'prodigy' && (
          <div className="prodigy-note">
            GROWS 60% FASTER IN CAMP · DECLINES AT HALF SPEED · TRAINS FOR 25% LESS TAPE
          </div>
        )}
        <div className="tape-wallet">▤ {franchise.tape} TAPE AVAILABLE</div>
      </div>
      <div className="training-grid">
        {stats.map((key) => {
          const value = player.ratings[key];
          const cost = trainingCost(value, player);
          const maxed = value >= 99;
          return (
            <div className="train-row" key={key}>
              <div className="train-info">
                <span>{RATING_LABELS[key]}</span>
                <RatingBar label="" value={value} compact />
              </div>
              <div className="train-action">
                <span className="cost">{maxed ? 'MAX' : `▤ ${cost}`}</span>
                <PixelButton
                  variant="ghost"
                  disabled={maxed || franchise.tape < cost}
                  onClick={() => onTrain(player, key)}
                >
                  +1
                </PixelButton>
              </div>
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <span className="dim small">
          {player.ego >= 2 ? 'STAR · wants 3+ touches per game' : 'ROLE PLAYER'} ·{' '}
          {player.age <= 24
            ? 'GROWS EVERY WINTER'
            : player.age <= 28
              ? 'IN HIS PRIME'
              : 'LOSES A STEP EACH WINTER'}
        </span>
        <PixelButton variant="quiet" onClick={onRest} disabled={franchise.tape < 50}>
          TEAM MEETING (50)
        </PixelButton>
      </div>
    </Modal>
  );
}

function FilmRoom({ franchise }: { franchise: Franchise }) {
  const team = playerTeam(franchise);
  const leaders = (metric: 'passYds' | 'rushYds' | 'recYds') => {
    const rows = Object.entries(franchise.seasonStats)
      .map(([id, s]) => ({ player: franchise.roster.find((p) => p.id === id), value: s[metric], stat: s }))
      .filter((r) => r.player)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    return rows;
  };
  const pass = leaders('passYds');
  const rush = leaders('rushYds');
  const rec = leaders('recYds');
  const titles = franchise.history.filter((h) => h.wonBowl).length;
  const best = [...franchise.history].sort((a, b) => b.wins - a.wins)[0];

  return (
    <div className="tab-content">
      <div className="two-col">
        <Panel className="leaders-panel">
          <div className="section-head">
            <h2>SEASON LEADERS</h2>
            <span className="dim small">SEASON {franchise.season}</span>
          </div>
          <LeaderBlock title="PASSING" rows={pass} metric="YDS" accent={team.colors.primary} />
          <LeaderBlock title="RUSHING" rows={rush} metric="YDS" accent={team.colors.secondary} />
          <LeaderBlock title="RECEIVING" rows={rec} metric="YDS" accent={team.colors.accent} />
          {!pass.length && !rush.length && !rec.length && <Empty text="NO SNAPS LOGGED YET" />}
        </Panel>

        <div className="film-side">
          <Panel className="last-game-panel">
            <div className="section-head">
              <h2>LAST BROADCAST</h2>
            </div>
            {franchise.lastGameSummary ? (
              <>
                <div className="last-score">
                  <b
                    className={
                      franchise.lastGameSummary.win ? 'win' : franchise.lastGameSummary.tie ? 'tie' : 'loss'
                    }
                  >
                    {franchise.lastGameSummary.win ? 'W' : franchise.lastGameSummary.tie ? 'T' : 'L'}{' '}
                    {franchise.lastGameSummary.our}-{franchise.lastGameSummary.theirs}
                  </b>
                  <span>
                    vs {getTeam(franchise, franchise.lastGameSummary.opponentId).nickname} · WEEK{' '}
                    {franchise.lastGameSummary.week}
                  </span>
                </div>
                <div className="mvp-line">MVP: {franchise.lastGameSummary.mvp}</div>
                <ul className="highlight-list">
                  {franchise.lastGameSummary.highlights.slice(0, 3).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
                <div className="dim small">+{franchise.lastGameSummary.tapeEarned} TAPE EARNED</div>
              </>
            ) : (
              <Empty text="NO GAME TAPE YET" />
            )}
          </Panel>

          <Panel className="legacy-panel">
            <div className="section-head">
              <h2>THE ARCHIVE</h2>
              <span className="dim small">
                ★ {titles} TITLE{titles === 1 ? '' : 'S'}
              </span>
            </div>
            {best && (
              <p className="muted small">
                BEST FINISH: {best.wins}-{best.losses}
                {best.ties ? `-${best.ties}` : ''} · SEASON {best.season}
              </p>
            )}
            <div className="history-list">
              {[...franchise.history].reverse().map((h) => (
                <div className="history-row" key={h.season}>
                  <span>S{h.season}</span>
                  <b>
                    {h.wins}-{h.losses}
                    {h.ties ? `-${h.ties}` : ''}
                  </b>
                  <span className={h.wonBowl ? 'title-badge' : 'dim'}>
                    {h.wonBowl ? '★ CHAMPS' : h.madePlayoffs ? 'PLAYOFFS' : 'MISSED'}
                  </span>
                  <small>{h.mvpName}</small>
                </div>
              ))}
              {!franchise.history.length && <Empty text="NO COMPLETED SEASONS" />}
            </div>
            <div className="section-head">
              <h2>MILESTONES</h2>
              <span className="dim small">
                {Object.keys(franchise.achievements?.unlocked ?? {}).length}/{ACHIEVEMENTS.length}
              </span>
            </div>
            <div className="history-list">
              {ACHIEVEMENTS.map((a) => {
                const season = franchise.achievements?.unlocked[a.id];
                return (
                  <div className="history-row" key={a.id}>
                    <span>{season ? `S${season}` : '—'}</span>
                    <b>{a.name}</b>
                    <span className={season ? 'title-badge' : 'dim'}>{season ? 'EARNED' : 'LOCKED'}</span>
                    <small>{a.desc}</small>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
      <Panel className="film-note">
        <span className="eyebrow">BROADCAST NOTES</span>
        <p>
          The tape remembers everything. Every yard, every quirk, every gut-punch interception.
          Rewind the season in your head — or just run it back next year.
        </p>
      </Panel>
    </div>
  );
}

function LeaderBlock({
  title,
  rows,
  metric,
  accent,
}: {
  title: string;
  rows: { player?: Player; value: number }[];
  metric: string;
  accent: string;
}) {
  return (
    <div className="leader-block">
      <div className="leader-title" style={{ color: accent }}>
        {title}
      </div>
      {rows.length ? (
        rows.map((r, i) => (
          <div className="leader-row" key={`${title}-${i}`}>
            <span className="leader-rank">{i + 1}</span>
            <span className="leader-name">{r.player?.name}</span>
            <b>{r.value}</b>
            <small>{metric}</small>
          </div>
        ))
      ) : (
        <div className="dim small">—</div>
      )}
    </div>
  );
}

function SettingsModal({
  franchise,
  update,
  onClose,
  onTitle,
}: {
  franchise: Franchise;
  update: (fn: (f: Franchise) => void) => void;
  onClose: () => void;
  onTitle: () => void;
}) {
  const toggle = (key: 'sound' | 'music' | 'crt' | 'haptics' | 'reducedMotion') => {
    update((f) => {
      f.settings[key] = !f.settings[key];
      if (key === 'sound') audio.setEnabled(f.settings.sound);
      if (key === 'music') {
        audio.setMusic(f.settings.music);
        if (f.settings.music) audio.startMusic();
        else audio.stopMusic();
      }
      // Apply the switch now rather than in App's effect: the confirmation tick
      // on turning haptics back on has to pass a bridge that is already enabled.
      if (key === 'haptics') setHapticsEnabled(f.settings.haptics);
    });
    haptic('select');
    audio.init();
    audio.play('select');
  };
  return (
    <Modal title="SYSTEM" eyebrow="BROADCAST SETTINGS" onClose={onClose}>
      <div className="settings-list">
        <Toggle label="SOUND FX" value={franchise.settings.sound} onClick={() => toggle('sound')} />
        <Toggle label="MUSIC" value={franchise.settings.music} onClick={() => toggle('music')} />
        <Toggle label="CRT SCANLINES" value={franchise.settings.crt} onClick={() => toggle('crt')} />
        <Toggle label="HAPTICS" value={franchise.settings.haptics} onClick={() => toggle('haptics')} />
        <Toggle
          label="REDUCED MOTION"
          value={franchise.settings.reducedMotion}
          onClick={() => toggle('reducedMotion')}
        />
      </div>
      <p className="dim small">
        REDUCED MOTION holds the camera still on hits and scores and plays the halftime tape
        at full speed. Haptics and gameplay are unaffected. New careers copy the phone&apos;s
        accessibility setting.
      </p>
      <div className="setting-block">
        <div className="eyebrow">SCREEN</div>
        <p className="dim small">
          Turn the phone sideways at any time for the wide broadcast: the field fills the
          left of the frame and the tape deck sits beside it. Rotation is in place, so the
          clock, score and drive survive it — there is nothing to set.
        </p>
      </div>
      <div className="setting-block">
        <div className="eyebrow">SLOW MOTION</div>
        <p className="dim small">
          How far the game stretches time on a broken tackle, a sack, a pick or a score from
          deep. Camera shake is its own switch and keeps working either way.
        </p>
        <div className="segmented">
          {(['off', 'short', 'full'] as const).map((m) => (
            <button
              key={m}
              className={franchise.settings.slowmo === m ? 'seg active' : 'seg'}
              onClick={() => {
                haptic('select');
                update((f) => {
                  f.settings.slowmo = m;
                });
                audio.play('select');
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-block">
        <div className="eyebrow">DIFFICULTY</div>
        <p className="dim small">
          Changes opponent ratings for the next game. The tape does not judge.
        </p>
        <div className="segmented">
          {(['rookie', 'pro', 'legend'] as const).map((d) => (
            <button
              key={d}
              className={franchise.difficulty === d ? 'seg active' : 'seg'}
              onClick={() => {
                haptic('select');
                update((f) => {
                  f.difficulty = d;
                });
                audio.play('select');
              }}
            >
              {d.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <PixelButton variant="quiet" onClick={onTitle}>
          EXIT TO TITLE
        </PixelButton>
        <PixelButton onClick={onClose}>BACK TO THE TAPE</PixelButton>
      </div>
    </Modal>
  );
}

function Toggle({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) {
  return (
    <button className={`toggle-row ${value ? 'on' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <i>{value ? 'ON' : 'OFF'}</i>
    </button>
  );
}

/** Why the market said no. */
const TROUBLE: Record<Deal, string> = {
  ok: '',
  'no-tape': 'NOT ENOUGH TAPE FOR THAT ONE',
  full: 'THE ROSTER IS FULL — SOMEBODY HAS TO GO',
  'illegal-lineup': 'A LINEUP NEEDS ONE MAN AT EVERY POSITION',
  'not-found': 'HE IS ALREADY GONE',
};

/**
 * The wire and your own roster, one screen: sign a veteran with tape and, if the
 * roster is at its cap, name the man who leaves; or sell a body you can spare.
 */
function MarketModal({
  franchise,
  update,
  onClose,
}: {
  franchise: Franchise;
  update: (fn: (f: Franchise) => void) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'agents' | 'sell'>('agents');
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const wire = [...(franchise.freeAgents ?? [])].sort((a, b) => overall(b) - overall(a));
  const pending = wire.find((p) => p.id === pendingAgentId) ?? null;

  const say = (verdict: Deal, done: string) => {
    if (verdict !== 'ok') {
      setNote(TROUBLE[verdict]);
      audio.play('whistle');
      return;
    }
    setNote(done);
    audio.play('first');
  };

  const buy = (agent: Player) => {
    const verdict = dealVerdict(franchise, agent.id);
    if (verdict === 'full') {
      haptic('select');
      setPendingAgentId(agent.id);
      setNote(`${agent.name.toUpperCase()} WANTS A JOB — PICK WHO LEAVES`);
      return;
    }
    if (verdict !== 'ok') {
      say(verdict, '');
      return;
    }
    update((f) => {
      signFreeAgent(f, agent.id);
    });
    say('ok', `SIGNED ${agent.name.toUpperCase()} · ${agent.pos} ${overall(agent)} · −▤ ${buyPrice(agent)}`);
    setPendingAgentId(null);
  };

  const swap = (agent: Player, release: Player) => {
    const verdict = dealVerdict(franchise, agent.id, release.id);
    if (verdict !== 'ok') {
      say(verdict, '');
      return;
    }
    update((f) => {
      signFreeAgent(f, agent.id, release.id);
    });
    say(
      'ok',
      `SIGNED ${agent.name.toUpperCase()} · ${release.name.toUpperCase()} RELEASED · −▤ ${buyPrice(agent)}`,
    );
    setPendingAgentId(null);
  };

  const sell = (player: Player) => {
    const verdict = sellVerdict(franchise, player.id);
    if (verdict !== 'ok') {
      say(verdict, '');
      return;
    }
    update((f) => {
      sellPlayer(f, player.id);
    });
    say('ok', `SOLD ${player.name.toUpperCase()} · +▤ ${sellValue(player)}`);
  };

  const row = (p: Player, fit: string, action: React.ReactNode) => (
    <div className="cut-row" key={p.id}>
      <span className="num">{p.num}</span>
      <span className="who">
        <b>
          {p.name}
          {p.trait === 'prodigy' && (
            <span className="prodigy-star" title="PRODIGY — develops faster than the curve">
              {' '}
              ★
            </span>
          )}
        </b>
        <small>
          {p.pos} · AGE {p.age} · {overall(p)} OVR · {QUIRKS[p.quirk]?.name ?? 'NO QUIRK'}
        </small>
      </span>
      <span className={fit === 'BENCH' || fit === 'NEEDED' ? 'market-tag' : 'market-tag on'}>{fit}</span>
      {action}
    </div>
  );

  return (
    <Modal
      title="THE MARKET"
      eyebrow={`${franchise.roster.length}/${MARKET.rosterMax} MEN · ▤ ${franchise.tape} TAPE`}
      onClose={onClose}
      wide
    >
      <div className="segmented">
        <button
          className={tab === 'agents' ? 'seg active' : 'seg'}
          onClick={() => {
            haptic('select');
            setTab('agents');
            setPendingAgentId(null);
          }}
        >
          FREE AGENTS · {wire.length}
        </button>
        <button
          className={tab === 'sell' ? 'seg active' : 'seg'}
          onClick={() => {
            haptic('select');
            setTab('sell');
            setPendingAgentId(null);
          }}
        >
          SELL FOR TAPE
        </button>
      </div>
      {note && <p className="market-note">{note}</p>}

      {tab === 'agents' && !pending && (
        <div className="market-list">
          {wire.length ? (
            wire.map((p) => {
              const price = buyPrice(p);
              const verdict = dealVerdict(franchise, p.id);
              return row(
                p,
                depthTag(placeInRoster(franchise.roster, p), p),
                <PixelButton
                  variant="gold"
                  className="btn-compact"
                  disabled={verdict === 'no-tape' || verdict === 'not-found'}
                  onClick={() => buy(p)}
                >
                  {verdict === 'no-tape' ? `NEED ▤${price}` : `SIGN ▤${price}`}
                </PixelButton>,
              );
            })
          ) : (
            <Empty text="THE WIRE IS EMPTY" />
          )}
        </div>
      )}

      {tab === 'agents' && pending && (
        <div className="market-room">
          <div className="section-head">
            <h2>MAKE ROOM FOR {pending.name.toUpperCase()}</h2>
            <span className="dim small">▤ {buyPrice(pending)} · WHO LEAVES?</span>
          </div>
          <div className="market-list">
            {franchise.roster.map((p) => {
              const verdict = dealVerdict(franchise, pending.id, p.id);
              return row(
                p,
                verdict === 'ok' ? 'RELEASE' : 'NEEDED',
                <PixelButton
                  variant="ghost"
                  className="btn-compact"
                  disabled={verdict !== 'ok'}
                  onClick={() => swap(pending, p)}
                >
                  GO
                </PixelButton>,
              );
            })}
          </div>
          <div className="modal-actions">
            <PixelButton
              variant="quiet"
              onClick={() => {
                setPendingAgentId(null);
                setNote(null);
              }}
            >
              CANCEL
            </PixelButton>
          </div>
        </div>
      )}

      {tab === 'sell' && (
        <div className="market-list">
          {[...franchise.roster]
            .sort((a, b) => overall(b) - overall(a))
            .map((p) => {
              const verdict = sellVerdict(franchise, p.id);
              return row(
                p,
                depthTag(franchise.roster, p),
                <PixelButton
                  variant="ghost"
                  className="btn-compact"
                  disabled={verdict !== 'ok'}
                  onClick={() => sell(p)}
                >
                  {verdict === 'ok' ? `SELL ▤${sellValue(p)}` : 'NEEDED'}
                </PixelButton>,
              );
            })}
        </div>
      )}

      <p className="dim small">
        Prices scale with grade, position and quirk; a sale pays 55% of the asking price. Sold
        players go back on the wire, and a roster at its cap has to release somebody to sign.
      </p>
      <div className="modal-actions">
        <PixelButton onClick={onClose}>DONE</PixelButton>
      </div>
    </Modal>
  );
}

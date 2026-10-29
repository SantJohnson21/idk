import { useState } from 'react';
import type { Franchise, TeamInfo } from '../game/types';
import { playerTeam } from '../game/season';
import {
  ABBR_MAX,
  NAME_MAX,
  TEAM_PRESETS,
  applyTeamPatch,
  isHex,
  originalPatch,
  patchColors,
  patchWarning,
  sanitizePatch,
  teamPatch,
  type TeamPatch,
} from '../game/club';
import { audio } from '../game/audio';
import { haptic } from '../native';
import { Modal, PixelButton, TeamBadge } from './components';

/** Where each colour actually turns up, so the editor is not guesswork. */
const COLOUR_FIELDS: { key: keyof TeamPatch; label: string; hint: string }[] = [
  { key: 'primary', label: 'PRIMARY', hint: 'end zone wash · HUD bar · crowd flecks' },
  { key: 'jersey', label: 'JERSEY', hint: 'what your men wear on the field' },
  { key: 'secondary', label: 'SECONDARY', hint: 'the lettering and checker inside the end zone' },
  { key: 'accent', label: 'ACCENT', hint: 'badge tick · film room leaders' },
  { key: 'dark', label: 'DARK', hint: 'hub hero backdrop · badge shadow' },
];

export function TeamEditor({
  franchise,
  update,
  onClose,
}: {
  franchise: Franchise;
  update: (fn: (f: Franchise) => void) => void;
  onClose: () => void;
}) {
  const team = playerTeam(franchise);
  const saved = teamPatch(team);
  const [draft, setDraft] = useState<TeamPatch>(saved);

  const clean = sanitizePatch(draft, team);
  const warning = patchWarning(clean);
  const changed = JSON.stringify(clean) !== JSON.stringify(saved);
  const preview: TeamInfo = {
    ...team,
    city: clean.city,
    nickname: clean.nickname,
    abbr: clean.abbr,
    colors: patchColors(clean),
  };

  const edit = (key: keyof TeamPatch, value: string) =>
    setDraft((d) => ({ ...d, [key]: key === 'abbr' ? value.toUpperCase() : value }));

  const save = () => {
    if (!changed) {
      onClose();
      return;
    }
    update((f) => {
      applyTeamPatch(f, clean);
    });
    audio.play('first');
    onClose();
  };

  return (
    <Modal title="CLUB EDITOR" eyebrow="NAMES AND BROADCAST COLOURS" onClose={onClose} wide>
      <div
        className="club-preview"
        style={{
          background: `linear-gradient(120deg, ${preview.colors.dark}, #0a1119 72%)`,
          borderColor: `${preview.colors.primary}55`,
        }}
      >
        <div className="endzone-swatch" style={{ background: preview.colors.primary }}>
          <b style={{ color: preview.colors.secondary }}>{preview.city}</b>
        </div>
        <div className="club-preview-copy">
          <TeamBadge team={preview} size="lg" />
          <div>
            <b>
              {preview.city} {preview.nickname}
            </b>
            <small>
              {preview.abbr} · END ZONE, BADGE, HUD AND JERSEYS ALL FOLLOW THIS
            </small>
          </div>
        </div>
      </div>

      <div className="club-fields">
        <div className="club-field">
          <label htmlFor="club-city">
            CITY<small>End zone lettering · max {NAME_MAX}</small>
          </label>
          <input
            id="club-city"
            className="club-input"
            value={draft.city}
            maxLength={NAME_MAX}
            onChange={(e) => edit('city', e.target.value)}
          />
        </div>
        <div className="club-field">
          <label htmlFor="club-nick">
            NICKNAME<small>The hero, the bracket, the box score</small>
          </label>
          <input
            id="club-nick"
            className="club-input"
            value={draft.nickname}
            maxLength={NAME_MAX}
            onChange={(e) => edit('nickname', e.target.value)}
          />
        </div>
        <div className="club-field">
          <label htmlFor="club-abbr">
            ABBREVIATION<small>Three characters · max {ABBR_MAX}</small>
          </label>
          <input
            id="club-abbr"
            className="club-input club-input-short"
            value={draft.abbr}
            maxLength={ABBR_MAX}
            onChange={(e) => edit('abbr', e.target.value)}
          />
        </div>
      </div>

      <div className="club-fields">
        {COLOUR_FIELDS.map((f) => (
          <div className="club-field" key={f.key}>
            <label htmlFor={`club-${f.key}`}>
              {f.label}
              <small>{f.hint}</small>
            </label>
            <span className="club-hex">{clean[f.key]}</span>
            <input
              id={`club-${f.key}`}
              className="swatch"
              type="color"
              value={isHex(draft[f.key]) ? draft[f.key] : clean[f.key]}
              onChange={(e) => edit(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>PALETTES</h2>
        <span className="dim small">TAP TO TRY ONE ON — THE NAME STAYS</span>
      </div>
      <div className="preset-row">
        {TEAM_PRESETS.map((p) => (
          <button
            key={p.name}
            className="preset-btn"
            onClick={() => {
              haptic('select');
              audio.play('select');
              setDraft((d) => ({ ...d, ...p.colors }));
            }}
          >
            <i style={{ background: p.colors.primary }} />
            <i style={{ background: p.colors.secondary }} />
            <i style={{ background: p.colors.accent }} />
            {p.name}
          </button>
        ))}
      </div>

      {warning && <p className="market-note">{warning}</p>}
      <p className="dim small">
        The roster, the tape and the league are untouched — this is your badge, your name and the
        colours the broadcast paints you in.
      </p>

      <div className="modal-actions">
        <PixelButton
          variant="quiet"
          onClick={() => {
            haptic('select');
            audio.play('select');
            setDraft(originalPatch(team.id) ?? saved);
          }}
        >
          RESTORE ORIGINAL
        </PixelButton>
        <PixelButton variant="ghost" onClick={onClose}>
          CANCEL
        </PixelButton>
        <PixelButton variant="gold" disabled={!changed} onClick={save}>
          SAVE CLUB ▶
        </PixelButton>
      </div>
    </Modal>
  );
}

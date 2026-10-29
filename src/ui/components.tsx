import { useEffect, useRef, type ReactNode } from 'react';
import type { Player, Ratings, TeamInfo } from '../game/types';
import { QUIRKS } from '../game/data';
import { haptic } from '../native';

/**
 * Open modals register a closer here so the hardware back button can dismiss the
 * top one instead of leaving the screen behind it (see src/App.tsx).
 */
const modalClosers: Array<() => void> = [];

export function closeTopModal(): boolean {
  const close = modalClosers[modalClosers.length - 1];
  if (!close) return false;
  close();
  return true;
}

export function Panel({
  children,
  className = '',
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: string;
}) {
  return (
    <section
      className={`panel ${className}`}
      style={glow ? { boxShadow: `0 0 0 1px ${glow}55, 0 10px 30px #0008` } : undefined}
    >
      {children}
    </section>
  );
}

export function PixelButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className = '',
  type = 'button',
  tick = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'gold' | 'danger' | 'quiet';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  /** Selection tick on press. Off where a stronger cue fires right after. */
  tick?: boolean;
}) {
  return (
    <button
      type={type}
      className={`pbtn ${variant} ${className}`}
      onClick={() => {
        if (onClick && tick) haptic('select');
        onClick?.();
      }}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const close = () => closeRef.current();
    modalClosers.push(close);
    return () => {
      const i = modalClosers.lastIndexOf(close);
      if (i >= 0) modalClosers.splice(i, 1);
    };
  }, []);

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button
            className="icon-btn"
            onClick={() => {
              haptic('select');
              onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function TeamBadge({ team, size = 'md' }: { team: TeamInfo; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div
      className={`team-badge ${size}`}
      style={{
        background: `linear-gradient(145deg, ${team.colors.primary}, ${team.colors.dark})`,
        borderColor: team.colors.secondary,
        color: '#f7f3e7',
      }}
    >
      <span>{team.abbr}</span>
      <i style={{ background: team.colors.accent }} />
    </div>
  );
}

export function RatingBar({
  label,
  value,
  accent,
  compact,
}: {
  label: string;
  value: number;
  accent?: string;
  compact?: boolean;
}) {
  const color = value >= 85 ? '#5ee6a8' : value >= 72 ? '#ffd166' : value >= 60 ? '#ffa94d' : '#ff6b7a';
  return (
    <div className={`rating ${compact ? 'compact' : ''}`}>
      <div className="rating-top">
        <span>{label}</span>
        <b style={{ color: accent ?? color }}>{value}</b>
      </div>
      <div className="rating-track">
        <i style={{ width: `${value}%`, background: accent ?? color }} />
      </div>
    </div>
  );
}

export function QuirkChip({ id, small }: { id: Player['quirk']; small?: boolean }) {
  const q = QUIRKS[id];
  if (!q) return null;
  return (
    <span className={`quirk ${small ? 'small' : ''}`} title={q.desc}>
      <i>{q.icon}</i> {q.name}
    </span>
  );
}

export function MoraleMeter({ value }: { value: number }) {
  const color = value >= 80 ? '#5ee6a8' : value >= 55 ? '#ffd166' : '#ff6b7a';
  const face = value >= 80 ? '☺' : value >= 55 ? '•' : '☹';
  return (
    <span className="morale" style={{ color }} title={`Morale ${value}`}>
      {face} {value}
    </span>
  );
}

export function RiskPips({ risk }: { risk: number }) {
  return (
    <span className={`risk risk-${risk}`}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= risk ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

export function fmtRecord(w: number, l: number, t = 0) {
  return `${w}-${l}${t ? `-${t}` : ''}`;
}

export function keyRatings(player: Player): { key: keyof Ratings; label: string }[] {
  switch (player.pos) {
    case 'QB':
      return [
        { key: 'arm', label: 'ARM' },
        { key: 'spd', label: 'SPD' },
      ];
    case 'RB':
      return [
        { key: 'spd', label: 'SPD' },
        { key: 'pow', label: 'POW' },
        { key: 'hands', label: 'HANDS' },
      ];
    case 'WR':
    case 'SLOT':
      return [
        { key: 'spd', label: 'SPD' },
        { key: 'hands', label: 'HANDS' },
      ];
    case 'TE':
      return [
        { key: 'hands', label: 'HANDS' },
        { key: 'blk', label: 'BLK' },
      ];
    case 'OL':
      return [
        { key: 'blk', label: 'BLK' },
        { key: 'pow', label: 'POW' },
      ];
    case 'DL':
      return [
        { key: 'pow', label: 'POW' },
        { key: 'tkl', label: 'TKL' },
      ];
    case 'LB':
      return [
        { key: 'cov', label: 'COV' },
        { key: 'tkl', label: 'TKL' },
      ];
    case 'CB':
      return [
        { key: 'cov', label: 'COV' },
        { key: 'spd', label: 'SPD' },
      ];
    case 'S':
      return [
        { key: 'cov', label: 'COV' },
        { key: 'tkl', label: 'TKL' },
      ];
    case 'K':
      return [{ key: 'pow', label: 'LEG' }];
    default:
      return [{ key: 'spd', label: 'SPD' }];
  }
}

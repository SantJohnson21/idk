import { FIELD_W, MID_Y, OPP_GOAL, OWN_GOAL } from './constants';
import type { Match } from './match';
import { QB_TAP_CORE, type SimActor } from './play';
import type { TeamInfo } from './types';

const PALETTE = {
  bg: '#06090e',
  turfA: '#0c342a',
  turfB: '#0f3e31',
  turfNightA: '#0a2b25',
  turfNightB: '#0d352c',
  line: '#d7f5df',
  lineSoft: 'rgba(214,245,223,0.26)',
  yellow: '#ffd166',
  blue: '#4f9dff',
  cream: '#f4f0dc',
  dark: '#080c11',
  magenta: '#ff2e88',
  cyan: '#1fe3cf',
  white: '#f7f3e7',
};

const SLOT_LABEL: Record<string, string> = {
  WR1: 'X',
  WR2: 'Z',
  SLOT: 'S',
  TE: 'Y',
  RB: 'R',
};

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Pixels per field yard the camera holds at a canvas this size. */
export function cameraScale(w: number, h: number): number {
  // Landscape has width to spare, so it budgets the canvas height against the
  // field's short axis instead of the portrait formula's 35×28 yard keyhole.
  // A phone turned sideways sees ~44 yards across and ~70 downfield: most of the
  // field's width plus twice the route tree, while players stay readable.
  if (w > h) return clamp(Math.min(w / 46, h / 44), 7.2, 17);
  return clamp(Math.min(w / 35, h / 28), 7.2, 17);
}

/** A tap target's radius in CSS pixels: a thumb, not a yard marker. */
export const TAP_RADIUS_PX = 26;

/** That radius in field yards — the unit the field-space tap zones are measured in. */
export function tapRadiusForScale(scale: number, px = TAP_RADIUS_PX): number {
  return Math.max(QB_TAP_CORE, px / Math.max(1, scale));
}

function rgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  floor?: boolean;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;
  scale = 11;
  cam = { x: 60, y: MID_Y };
  particles: Particle[] = [];
  lastFlash = 0;
  time = 0;
  private resizeObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  screenToField(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: this.cam.x + (sx - this.w / 2) / this.scale,
      y: this.cam.y + (sy - this.h / 2) / this.scale,
    };
  }

  /**
   * The take-off tap zone's radius in field yards, for the camera the player is
   * actually looking at: a thumb is a fixed size and the field is not, so the zone is
   * measured on screen and converted here rather than hardcoded in yards.
   */
  tapRadiusYards(px = TAP_RADIUS_PX): number {
    return tapRadiusForScale(this.scale, px);
  }

  private X(x: number) {
    return (x - this.cam.x) * this.scale + this.w / 2;
  }

  private Y(y: number) {
    return (y - this.cam.y) * this.scale + this.h / 2;
  }

  private focus(match: Match) {
    const sim = match.sim;
    const blockFx = match.blockFx;
    if (!sim && blockFx) {
      // The loose ball owns the camera while it squirts backwards off the block.
      const p = clamp(blockFx.t / blockFx.hold, 0, 1);
      const yard = blockFx.fromYard + (blockFx.toYard - blockFx.fromYard) * (1 - Math.pow(1 - p, 3));
      return { x: OWN_GOAL + yard, y: MID_Y };
    }
    if (sim) {
      if (sim.phase === 'air') return { x: sim.ball.x + 3, y: sim.ball.y };
      // 'halftime' keeps the camera on the film's carrier: the reel puppets the
      // recorded sim, and a dead frame would otherwise snap back to the QB.
      if (sim.carrier && (sim.phase === 'carry' || match.phase === 'result' || match.phase === 'halftime')) {
        return { x: sim.carrier.x + 4, y: sim.carrier.y };
      }
      return { x: sim.qb.x + 9, y: sim.qb.y };
    }
    return { x: OWN_GOAL + match.state.spot + 10, y: MID_Y };
  }

  private updateCamera(match: Match, dt: number) {
    const targetScale = cameraScale(this.w, this.h);
    this.scale = lerp(this.scale, targetScale, Math.min(1, dt * 5));
    const halfW = this.w / (2 * this.scale);
    const halfH = this.h / (2 * this.scale);
    const f = this.focus(match);
    const targetX = clamp(f.x, halfW - 7, 127 - halfW);
    const targetY = halfH >= FIELD_W / 2 ? MID_Y : clamp(f.y, halfH - 2.5, FIELD_W - halfH + 2.5);
    const speed = match.phase === 'live' ? 7 : 3.5;
    this.cam.x = lerp(this.cam.x, targetX, Math.min(1, dt * speed));
    this.cam.y = lerp(this.cam.y, targetY, Math.min(1, dt * speed));
  }

  draw(match: Match, dt: number) {
    this.time += dt;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();
    this.updateCamera(match, dt);
    const ctx = this.ctx;
    const sim = match.sim;
    // REDUCED MOTION holds the frame completely still. Otherwise trauma is
    // squared, so a routine tackle is a nudge and only a big hit or a score
    // moves the camera; the HUD is drawn after the restore and never shakes.
    const trauma = sim && !match.franchise.settings.reducedMotion ? sim.shake : 0;
    // 0.16 trauma (an ordinary hit) is under a pixel; 0.55 (a deep score) is ~6.
    const amp = trauma * (3 + trauma * 16);
    const sx = amp >= 0.5 ? Math.sin(this.time * 74) * amp : 0;
    const sy = amp >= 0.5 ? Math.cos(this.time * 59) * amp * 0.7 : 0;

    ctx.save();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.translate(sx, sy);
    this.drawStands(match);
    this.drawField(match);
    this.drawLines(match);
    if (sim) {
      this.drawRouteGhosts(match);
      this.drawActors(match);
      this.drawBall(match);
      this.drawReads(match);
      this.updateParticles(match, dt);
      this.drawParticles();
    } else if (match.blockFx) {
      this.drawBlockScramble(match);
    }
    this.drawWeather(match);
    this.drawStick(match);
    ctx.restore();

    this.drawSlowmo(match);
    this.drawHud(match);
    this.drawKick(match);
    this.drawFlash(match);
    this.drawRewind(match);
    this.drawReel(match);
    this.drawVignette();
    this.drawScanline();
  }

  // --------------------------------------------------------------- slowmo ---

  /**
   * The tell that time has thinned out: a faint cool wash over the whole frame
   * and one band of light drifting down it. It scales with match.slowmoK, so a
   * shrug-off barely reads and a long score sits under it for half a second.
   * REDUCED MOTION keeps the frame completely plain.
   */
  private drawSlowmo(match: Match) {
    const k = match.franchise.settings.reducedMotion ? 0 : match.slowmoK;
    if (k <= 0.001) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(104,168,255,${(0.05 * k).toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, this.h);
    const band = Math.max(18, this.h * 0.09);
    const y = ((this.time * 92) % (this.h + band * 2)) - band;
    const grad = ctx.createLinearGradient(0, y - band, 0, y + band);
    grad.addColorStop(0, 'rgba(198,228,255,0)');
    grad.addColorStop(0.5, `rgba(198,228,255,${(0.075 * k).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(198,228,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - band, this.w, band * 2);
  }

  // ---------------------------------------------------------------- field ---

  private drawStands(match: Match) {
    const ctx = this.ctx;
    const topY = this.Y(0);
    const botY = this.Y(FIELD_W);
    ctx.fillStyle = '#070b10';
    if (topY > 0) ctx.fillRect(0, 0, this.w, topY);
    if (botY < this.h) ctx.fillRect(0, botY, this.w, this.h - botY);
    // Crowd pixels in the visible stands.
    const startX = Math.floor(this.cam.x - this.w / this.scale / 2);
    const endX = Math.ceil(this.cam.x + this.w / this.scale / 2);
    for (let x = startX; x < endX; x += 1.5) {
      for (let row = 0; row < 5; row++) {
        const seed = x * 17 + row * 31;
        const px = this.X(x + (hash(seed) - 0.5) * 0.8);
        const pyTop = topY - 8 - row * 7;
        const pyBot = botY + 8 + row * 7;
        const onTop = pyTop > -10 && pyTop < this.h;
        const onBot = pyBot > -10 && pyBot < this.h;
        const colors = [match.playerTeam.colors.primary, match.opponent.colors.primary, '#d8cba7', '#76808f'];
        const c = colors[Math.floor(hash(seed + 3) * colors.length)];
        if (onTop) {
          ctx.fillStyle = rgba(c, 0.28 + hash(seed + 7) * 0.5);
          ctx.fillRect(Math.round(px), Math.round(pyTop), 2, 2);
        }
        if (onBot) {
          ctx.fillStyle = rgba(c, 0.22 + hash(seed + 9) * 0.45);
          ctx.fillRect(Math.round(px), Math.round(pyBot), 2, 2);
        }
      }
    }
    // Camera flashes.
    for (let i = 0; i < 8; i++) {
      const t = (this.time * 0.35 + hash(i + 99)) % 1;
      if (t > 0.12) continue;
      const px = this.w * hash(i + 200);
      const py = topY - 5 - hash(i + 300) * 20;
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - t / 0.12)})`;
      ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
  }

  private drawField(match: Match) {
    const ctx = this.ctx;
    const night = match.weather.id === 'NIGHT' || match.weather.id === 'FOG';
    const a = night ? PALETTE.turfNightA : PALETTE.turfA;
    const b = night ? PALETTE.turfNightB : PALETTE.turfB;
    const y0 = this.Y(0);
    const y1 = this.Y(FIELD_W);
    for (let x = 0; x < 120; x += 5) {
      const px = this.X(x);
      const pw = 5 * this.scale + 1;
      if (px > this.w || px + pw < 0) continue;
      ctx.fillStyle = Math.floor(x / 5) % 2 === 0 ? a : b;
      ctx.fillRect(Math.floor(px), Math.floor(y0), Math.ceil(pw), Math.ceil(y1 - y0));
    }
    // Mow texture / grain.
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let x = Math.ceil(this.cam.x - 30); x < this.cam.x + 30; x += 3) {
      ctx.fillRect(Math.round(this.X(x)), Math.round(y0), 1, Math.round(y1 - y0));
    }

    // End zones.
    const endzones: { x: number; team: TeamInfo; label: string }[] = [
      { x: 0, team: match.playerTeam, label: match.playerTeam.city },
      { x: 110, team: match.opponent, label: match.opponent.city },
    ];
    for (const ez of endzones) {
      const left = this.X(ez.x);
      const width = 10 * this.scale + 1;
      ctx.fillStyle = rgba(ez.team.colors.primary, 0.3);
      ctx.fillRect(Math.floor(left), Math.floor(y0), Math.ceil(width), Math.ceil(y1 - y0));
      // Checker band.
      for (let row = 0; row < 26; row++) {
        for (let col = 0; col < 5; col++) {
          if ((row + col) % 2 === 0) continue;
          const bx = this.X(ez.x + col * 2);
          const by = this.Y(row * 2.1);
          ctx.fillStyle = rgba(ez.team.colors.secondary, 0.1);
          ctx.fillRect(Math.floor(bx), Math.floor(by), Math.ceil(2 * this.scale), Math.ceil(2.1 * this.scale));
        }
      }
      // End zone lettering.
      ctx.save();
      ctx.translate(this.X(ez.x + 5), this.Y(MID_Y));
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(18, this.scale * 2.2)}px PressStart, monospace`;
      ctx.fillStyle = rgba(ez.team.colors.secondary, 0.75);
      ctx.fillText(ez.label, 0, 0);
      ctx.font = `400 ${Math.max(9, this.scale * 0.9)}px Silkscreen, monospace`;
      ctx.fillStyle = rgba(PALETTE.white, 0.45);
      ctx.fillText('REWIND BOWL', 0, Math.max(14, this.scale * 1.7));
      ctx.restore();
    }

    // Center field mark.
    const mx = this.X(60);
    const my = this.Y(MID_Y);
    if (mx > -100 && mx < this.w + 100) {
      ctx.save();
      ctx.translate(mx, my);
      ctx.strokeStyle = 'rgba(225,244,224,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, this.scale * 4.5, this.scale * 2.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `700 ${Math.max(10, this.scale * 0.9)}px PressStart, monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(225,244,224,0.18)';
      ctx.fillText('RB', 0, 4);
      ctx.restore();
    }

    // Goal posts.
    for (const gx of [0, 120]) {
      const px = this.X(gx);
      if (px < -40 || px > this.w + 40) continue;
      ctx.strokeStyle = 'rgba(255,209,102,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, this.Y(21.5));
      ctx.lineTo(px, this.Y(FIELD_W - 21.5));
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,209,102,0.7)';
      ctx.fillRect(px - 1, this.Y(21.5) - 3, 3, 5);
      ctx.fillRect(px - 1, this.Y(FIELD_W - 21.5) - 2, 3, 5);
    }
  }

  private drawLines(match: Match) {
    const ctx = this.ctx;
    const y0 = this.Y(0);
    const y1 = this.Y(FIELD_W);
    const x0 = this.X(0);
    const x1 = this.X(120);
    // Major yard lines.
    for (let x = 0; x <= 120; x += 5) {
      const px = this.X(x);
      if (px < -5 || px > this.w + 5) continue;
      const major = x % 10 === 0;
      ctx.fillStyle = major ? 'rgba(215,245,223,0.34)' : 'rgba(215,245,223,0.14)';
      ctx.fillRect(Math.round(px), Math.floor(y0), major ? 2 : 1, Math.ceil(y1 - y0));
    }
    // Hash marks.
    ctx.fillStyle = 'rgba(215,245,223,0.3)';
    const start = Math.floor(this.cam.x - this.w / this.scale / 2);
    for (let x = Math.max(10, start); x <= Math.min(110, start + 80); x++) {
      if (x % 5 === 0) continue;
      for (const hy of [18.2, 35.1]) {
        const py = this.Y(hy);
        const px = this.X(x);
        ctx.fillRect(Math.round(px), Math.round(py), 1, Math.round(this.scale * 0.35));
      }
    }
    // Yard numbers.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(8, this.scale * 1.05)}px PressStart, monospace`;
    for (let x = 20; x <= 100; x += 10) {
      const px = this.X(x);
      if (px < -30 || px > this.w + 30) continue;
      const label = String(x <= 60 ? x - 10 : 110 - x);
      for (const ny of [9.5, 43.8]) {
        ctx.fillStyle = 'rgba(220,242,225,0.2)';
        ctx.fillText(label, px, this.Y(ny));
        if (x === 60) {
          ctx.fillStyle = 'rgba(255,209,102,0.25)';
          ctx.fillText('50', px, this.Y(ny));
        }
      }
    }
    // Sidelines.
    ctx.fillStyle = 'rgba(235,250,240,0.75)';
    ctx.fillRect(Math.floor(this.X(10)), Math.round(y0), 2, Math.ceil(y1 - y0));
    ctx.fillRect(Math.floor(this.X(110)), Math.round(y0), 2, Math.ceil(y1 - y0));
    ctx.fillRect(Math.floor(x0), Math.round(y0), Math.ceil(x1 - x0), 2);
    ctx.fillRect(Math.floor(x0), Math.round(y1) - 2, Math.ceil(x1 - x0), 2);

    // Line of scrimmage & first-down marker.
    const los = match.sim ? match.sim.los : OWN_GOAL + match.state.spot;
    const target = clamp(los + match.snapToGo, OWN_GOAL, OPP_GOAL);
    const losX = this.X(los);
    if (losX > -10 && losX < this.w + 10) {
      ctx.fillStyle = 'rgba(62,131,255,0.75)';
      ctx.fillRect(Math.round(losX), Math.floor(y0), 2, Math.ceil(y1 - y0));
    }
    const fdX = this.X(target);
    if (fdX > -10 && fdX < this.w + 10) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,209,102,0.7)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(255,209,102,0.85)';
      ctx.fillRect(Math.round(fdX), Math.floor(y0), 2, Math.ceil(y1 - y0));
      ctx.restore();
    }
    // Ball spot tick.
    const spotX = this.X(OWN_GOAL + match.state.spot);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(Math.round(spotX) - 1, this.Y(MID_Y) - 3, 3, 6);
  }

  private drawRouteGhosts(match: Match) {
    const sim = match.sim;
    if (!sim || (match.phase !== 'ready' && !(match.phase === 'live' && sim.elapsed < 0.45))) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.2;
    for (const a of sim.offense) {
      if (!a.slot || !a.route.length) continue;
      ctx.strokeStyle = 'rgba(230,255,240,0.22)';
      ctx.beginPath();
      ctx.moveTo(this.X(sim.los), this.Y(a.startY));
      for (const p of a.route) {
        ctx.lineTo(this.X(sim.los + p.dx), this.Y(a.startY + p.dy));
      }
      ctx.stroke();
      const last = a.route[a.route.length - 1];
      if (last) {
        ctx.fillStyle = 'rgba(230,255,240,0.2)';
        ctx.beginPath();
        ctx.arc(this.X(sim.los + last.dx), this.Y(a.startY + last.dy), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- actors ---

  private drawActors(match: Match) {
    const sim = match.sim;
    if (!sim) return;
    const actors = sim.actors
      .filter((a) => {
        const px = this.X(a.x);
        const py = this.Y(a.y);
        return px > -40 && px < this.w + 40 && py > -40 && py < this.h + 40;
      })
      .sort((a, b) => a.y - b.y);
    for (const a of actors) this.drawActor(a, sim.carrier?.id === a.id);
  }

  private drawActor(a: SimActor, isCarrier: boolean) {
    const ctx = this.ctx;
    const s = this.scale;
    const sx = this.X(a.x);
    const sy = this.Y(a.y);
    const speed = Math.hypot(a.vx, a.vy);
    const bob = speed > 1 ? Math.sin(a.bob * 2) : 0;
    const primary = a.side === 'off' ? a.jerseyColor : a.jerseyColor;
    const helmet = a.side === 'off' ? '#0b1c22' : '#151015';
    const trim = a.side === 'off' ? '#f4f0dc' : '#e7d9c8';
    const isLineman = a.role === 'DL' || a.role === 'OL';

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(Math.round(sx), Math.round(sy + s * 0.48), s * (isLineman ? 0.42 : 0.34), s * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs.
    const legW = Math.max(2, Math.round(s * 0.16));
    const legH = Math.max(3, Math.round(s * (isLineman ? 0.34 : 0.4)));
    const legY = sy + s * 0.02 + bob * s * 0.05;
    ctx.fillStyle = a.side === 'off' ? '#e9e2c8' : '#c9b79e';
    ctx.fillRect(Math.round(sx - s * 0.22), Math.round(legY), legW, legH);
    ctx.fillRect(Math.round(sx + s * 0.07), Math.round(legY), legW, legH);
    ctx.fillStyle = '#11151a';
    ctx.fillRect(Math.round(sx - s * 0.24), Math.round(legY + legH - 2), legW + 1, 2);
    ctx.fillRect(Math.round(sx + s * 0.06), Math.round(legY + legH - 2), legW + 1, 2);

    // Torso.
    const torsoW = isLineman ? s * 0.78 : s * 0.68;
    const torsoH = isLineman ? s * 0.54 : s * 0.58;
    const tx = sx - torsoW / 2;
    const ty = sy - s * 0.12 - torsoH;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, Math.ceil(torsoW) + 2, Math.ceil(torsoH) + 2);
    ctx.fillStyle = primary;
    ctx.fillRect(Math.round(tx), Math.round(ty), Math.ceil(torsoW), Math.ceil(torsoH));
    ctx.fillStyle = rgba(trim, 0.85);
    ctx.fillRect(Math.round(tx), Math.round(ty + torsoH * 0.18), Math.ceil(torsoW), Math.max(1, s * 0.09));
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.round(tx), Math.round(ty + torsoH * 0.78), Math.ceil(torsoW), Math.max(1, s * 0.08));

    // Helmet.
    const hw = Math.max(5, Math.round(s * 0.5));
    const hh = Math.max(4, Math.round(s * 0.34));
    const hx = Math.round(sx - hw / 2);
    const hy = Math.round(ty - hh + 2);
    ctx.fillStyle = '#04070a';
    ctx.fillRect(hx - 1, hy - 1, hw + 2, hh + 2);
    ctx.fillStyle = helmet;
    ctx.fillRect(hx, hy, hw, hh);
    ctx.fillStyle = a.side === 'off' ? rgba('#f4f0dc', 0.9) : rgba('#ff6b6b', 0.8);
    ctx.fillRect(hx + Math.floor(hw / 2) - 1, hy, 2, hh);
    ctx.fillStyle = 'rgba(220,240,255,0.55)';
    ctx.fillRect(hx + hw - 3, hy + Math.floor(hh / 2), 3, 2);

    // Number.
    if (s >= 10.5) {
      ctx.fillStyle = 'rgba(10,12,16,0.8)';
      ctx.font = `700 ${Math.max(6, Math.round(s * 0.44))}px Silkscreen, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(a.jersey), sx, ty + torsoH * 0.58);
    }

    if (a.stunned > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(hx, hy, hw, hh);
    }
    if (a.hitFlash > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${a.hitFlash * 2})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx - 2, hy - 2, hw + 4, hh + 4);
    }
    if (isCarrier && a.hasBall) {
      const pulse = 0.6 + Math.sin(this.time * 8) * 0.25;
      ctx.strokeStyle = `rgba(255,209,102,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy + s * 0.4, s * 0.52, s * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = PALETTE.yellow;
      const ay = hy - s * 0.45;
      ctx.beginPath();
      ctx.moveTo(sx, ay);
      ctx.lineTo(sx - s * 0.2, ay - s * 0.25);
      ctx.lineTo(sx + s * 0.2, ay - s * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    if (a.surge > 0) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = `rgba(31,227,207,${0.35 - i * 0.09})`;
        ctx.fillRect(
          Math.round(sx - s * (0.2 + i * 0.18)),
          Math.round(sy - s * (0.6 + i * 0.12)),
          Math.max(2, s * 0.16),
          Math.max(2, s * 0.16),
        );
      }
    }
  }

  private drawBall(match: Match) {
    const sim = match.sim;
    if (!sim) return;
    const ctx = this.ctx;
    const s = this.scale;
    const ball = sim.ball;
    if (ball.state === 'air') {
      const bx = this.X(ball.x);
      const by = this.Y(ball.y);
      // Landing reticle.
      const lx = this.X(sim.ballTarget.x);
      const ly = this.Y(sim.ballTarget.y);
      const pulse = 0.65 + Math.sin(this.time * 10) * 0.25;
      ctx.strokeStyle = `rgba(255,209,102,${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, s * (0.8 + Math.sin(this.time * 8) * 0.12), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lx - s * 0.35, ly);
      ctx.lineTo(lx + s * 0.35, ly);
      ctx.moveTo(lx, ly - s * 0.35);
      ctx.lineTo(lx, ly + s * 0.35);
      ctx.stroke();
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(bx, by, s * 0.22, s * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ball in flight.
      const py = by - ball.z * s * 0.55;
      ctx.fillStyle = '#9a5224';
      ctx.beginPath();
      ctx.ellipse(bx, py, s * 0.26, s * 0.16, Math.atan2(ball.y - ball.startY, ball.x - ball.startX), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,224,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx - s * 0.08, py);
      ctx.lineTo(bx + s * 0.08, py);
      ctx.stroke();
      return;
    }
    if (ball.state === 'held') {
      const bx = this.X(ball.x);
      const by = this.Y(ball.y);
      ctx.fillStyle = '#9a5224';
      ctx.beginPath();
      ctx.ellipse(bx, by - s * 0.1, s * 0.19, s * 0.11, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,224,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx - s * 0.06, by - s * 0.16);
      ctx.lineTo(bx + s * 0.06, by - s * 0.05);
      ctx.stroke();
    }
  }

  /**
   * The blocked-punt beat. No sim is running — the outcome is already decided — so
   * this draws the one thing worth watching: the ball squirting backwards off the
   * block with three dying hops, turf coming up where the rush got home, and a scuff
   * where the kicking team finally falls on it.
   */
  private drawBlockScramble(match: Match) {
    const fx = match.blockFx;
    if (!fx) return;
    const ctx = this.ctx;
    const s = this.scale;
    const p = clamp(fx.t / fx.hold, 0, 1);
    const travel = fx.toYard - fx.fromYard;
    const ease = 1 - Math.pow(1 - p, 3);
    const yard = fx.fromYard + travel * ease;
    const hop = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p) * 1.5;
    const bx = this.X(OWN_GOAL + yard);
    const by = this.Y(MID_Y);
    const fromX = this.X(OWN_GOAL + fx.fromYard);
    // Turf kicked up at the block.
    for (let i = 0; i < 4; i++) {
      const age = clamp(p * 1.7 - i * 0.12, 0, 1);
      if (age <= 0 || age >= 1) continue;
      ctx.fillStyle = `rgba(215,222,201,${(0.3 * (1 - age)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(
        fromX + (i - 1.5) * s * 0.45,
        by + (i % 2 ? 1 : -1) * s * 0.22,
        s * (0.16 + age * 0.6),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // The trail it leaves.
    for (let i = 1; i <= 4; i++) {
      const t = Math.max(0, p - i * 0.045);
      const g = 1 - Math.pow(1 - t, 3);
      const tx = this.X(OWN_GOAL + fx.fromYard + travel * g);
      const ty = this.Y(MID_Y) - Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 1.5 * s;
      ctx.fillStyle = `rgba(154,82,36,${(0.3 - i * 0.06).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(tx, ty - s * 0.1, s * 0.16, s * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shadow, then the ball tumbling above it.
    ctx.fillStyle = `rgba(0,0,0,${(0.3 - hop * 0.12).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(bx, by, s * (0.24 + hop * 0.05), s * (0.11 + hop * 0.02), 0, 0, Math.PI * 2);
    ctx.fill();
    const spin = p * 9;
    const py = by - hop * s - s * 0.1;
    ctx.fillStyle = '#9a5224';
    ctx.beginPath();
    ctx.ellipse(bx, py, s * 0.24, s * 0.15, spin, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,246,224,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx - Math.cos(spin) * s * 0.08, py - Math.sin(spin) * s * 0.08);
    ctx.lineTo(bx + Math.cos(spin) * s * 0.08, py + Math.sin(spin) * s * 0.08);
    ctx.stroke();
    // A pulse on the ball so the eye finds it in the crowd.
    ctx.strokeStyle = `rgba(255,107,122,${(0.45 + Math.sin(this.time * 14) * 0.25).toFixed(2)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(bx, py, s * (0.5 + Math.sin(this.time * 9) * 0.06), 0, Math.PI * 2);
    ctx.stroke();
    // The scuff it dies on, so the beat ends somewhere the eye can read.
    if (p > 0.7) {
      const fade = (p - 0.7) / 0.3;
      ctx.fillStyle = `rgba(18,24,18,${(0.4 * fade).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(this.X(OWN_GOAL + fx.toYard), by, s * 0.5, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawReads(match: Match) {
    const sim = match.sim;
    if (!sim || match.phase !== 'live' || sim.phase !== 'dropback' || !sim.isPass) return;
    const ctx = this.ctx;
    const reads = sim.reads.length ? sim.reads : sim.getReads();
    const sorted = [...reads].sort((a, b) => b.percent - a.percent);
    const best = sorted[0]?.actorId;
    for (const r of reads) {
      const actor = sim.byId.get(r.actorId);
      if (!actor) continue;
      const px = this.X(r.projected.x);
      const py = this.Y(r.projected.y) - this.scale * 1.5;
      if (px < -40 || px > this.w + 40 || py < 20 || py > this.h - 40) continue;
      const w = Math.max(36, this.scale * 3.3);
      const h = Math.max(14, this.scale * 1.15);
      const color = r.percent >= 70 ? '#5ee6a8' : r.percent >= 52 ? PALETTE.yellow : '#ff6b7a';
      ctx.fillStyle = 'rgba(5,9,14,0.82)';
      ctx.fillRect(Math.round(px - w / 2), Math.round(py - h), Math.round(w), Math.round(h));
      ctx.strokeStyle = r.actorId === best ? 'rgba(255,209,102,0.9)' : rgba(color, 0.55);
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(px - w / 2) + 0.5, Math.round(py - h) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(7, Math.round(this.scale * 0.58))}px Silkscreen, monospace`;
      ctx.fillStyle = color;
      ctx.fillText(`${SLOT_LABEL[r.slot] ?? '?'} ${r.percent}%`, px, py - h / 2 + 1);
      // Pointer.
      ctx.fillStyle = r.actorId === best ? 'rgba(255,209,102,0.9)' : rgba(color, 0.5);
      ctx.beginPath();
      ctx.moveTo(px - 3, py);
      ctx.lineTo(px + 3, py);
      ctx.lineTo(px, py + 5);
      ctx.closePath();
      ctx.fill();
    }
    // The pocket is still live: a pulsing ring on the quarterback, so the player can
    // see he is one tap (or one drag) from taking off.
    if (sim.qb.hasBall) {
      const qx = this.X(sim.qb.x);
      const qy = this.Y(sim.qb.y);
      ctx.strokeStyle = `rgba(255,209,102,${(0.3 + Math.sin(this.time * 7) * 0.18).toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(qx, qy, this.scale * (0.85 + Math.sin(this.time * 7) * 0.06), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Pressure warning near the QB.
    const pressure = sim.pressure;
    if (pressure > 55 && sim.qb) {
      const px = this.X(sim.qb.x);
      const py = this.Y(sim.qb.y) - this.scale * 1.5;
      ctx.fillStyle = `rgba(255,70,90,${0.55 + Math.sin(this.time * 12) * 0.25})`;
      ctx.font = `700 ${Math.max(8, this.scale * 0.62)}px PressStart, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('PRESSURE', px, py);
    }
  }

  private drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      const px = this.X(p.x);
      const py = this.Y(p.y);
      ctx.fillRect(Math.round(px), Math.round(py), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private updateParticles(match: Match, dt: number) {
    const sim = match.sim;
    if (sim && sim.flash > this.lastFlash + 0.08) {
      const o = sim.result;
      const x = sim.carrier?.x ?? sim.ball.x;
      const y = sim.carrier?.y ?? sim.ball.y;
      const colors = o?.touchdown
        ? [match.playerTeam.colors.primary, match.playerTeam.colors.secondary, PALETTE.yellow, PALETTE.cream]
        : ['#f8f5e6', '#ffd166', '#ff6b7a'];
      const count = o?.touchdown ? 40 : 8;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = Math.random() * (o?.touchdown ? 7 : 3);
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - (o?.touchdown ? 2 : 0),
          life: 0.6 + Math.random() * 0.6,
          max: 1.2,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: o?.touchdown ? 3 : 2,
        });
      }
    }
    this.lastFlash = sim?.flash ?? 0;
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 2.4 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-140);
  }

  // -------------------------------------------------------------- weather ---

  private drawWeather(match: Match) {
    const id = match.weather.id;
    const ctx = this.ctx;
    const t = this.time;
    if (id === 'RAIN') {
      ctx.strokeStyle = 'rgba(160,210,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const x = ((hash(i) * this.w + t * 220) % (this.w + 60)) - 30;
        const y = (hash(i + 40) * this.h + t * 900) % (this.h + 40) - 20;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 10);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,40,60,0.1)';
      ctx.fillRect(0, 0, this.w, this.h);
    } else if (id === 'SNOW') {
      ctx.fillStyle = 'rgba(235,245,255,0.75)';
      for (let i = 0; i < 50; i++) {
        const x = (hash(i + 7) * this.w + Math.sin(t + i) * 22 + t * 16) % this.w;
        const y = (hash(i + 13) * this.h + t * 28) % this.h;
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
    } else if (id === 'FOG') {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, 'rgba(120,140,150,0.2)');
      g.addColorStop(1, 'rgba(120,140,150,0.34)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    } else if (id === 'WIND') {
      ctx.strokeStyle = 'rgba(200,230,255,0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const y = (hash(i) * this.h + Math.sin(t * 0.6 + i) * 12 + this.h) % this.h;
        const x = ((t * (90 + i * 8) + hash(i + 9) * this.w) % (this.w + 100)) - 50;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 34 + i * 3, y - 2);
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ ui ---

  private drawStick(match: Match) {
    const st = match.stickScreen;
    if (!st.active) return;
    const ctx = this.ctx;
    const ox = st.ox;
    const oy = st.oy;
    const dx = st.x - ox;
    const dy = st.y - oy;
    const mag = Math.min(42, Math.hypot(dx, dy));
    const ang = Math.atan2(dy, dx);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(31,227,207,0.4)';
    ctx.beginPath();
    ctx.arc(ox, oy, 26, 0, Math.PI * 2);
    ctx.stroke();
    const kx = ox + Math.cos(ang) * mag;
    const ky = oy + Math.sin(ang) * mag;
    ctx.fillStyle = 'rgba(31,227,207,0.35)';
    ctx.beginPath();
    ctx.arc(kx, ky, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(240,255,252,0.7)';
    ctx.beginPath();
    ctx.arc(kx, ky, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(31,227,207,0.3)';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawHud(match: Match) {
    const ctx = this.ctx;
    const w = this.w;
    const pad = Math.max(8, Math.min(16, w * 0.025));
    // Tall enough that a two-digit score is never clipped by the bar's lower
    // edge, and opaque enough that field markings don't read through it.
    const barH = Math.max(40, Math.min(52, this.h * 0.088));
    const grad = ctx.createLinearGradient(0, 0, 0, barH);
    grad.addColorStop(0, 'rgba(4,7,11,0.98)');
    grad.addColorStop(1, 'rgba(4,7,11,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, barH);
    ctx.fillStyle = rgba(match.playerTeam.colors.primary, 0.8);
    ctx.fillRect(0, barH, w * 0.5, 1);
    ctx.fillStyle = rgba(match.opponent.colors.primary, 0.8);
    ctx.fillRect(w * 0.5, barH, w * 0.5, 1);

    const scoreFont = Math.max(13, Math.min(22, w * 0.045));
    const labelFont = Math.max(7, Math.min(10, w * 0.022));
    ctx.textBaseline = 'middle';
    // Left team.
    ctx.textAlign = 'left';
    ctx.font = `700 ${labelFont}px PressStart, monospace`;
    ctx.fillStyle = match.playerTeam.colors.primary;
    ctx.fillText(match.playerTeam.abbr, pad, barH * 0.29);
    ctx.font = `${scoreFont}px PressStart, monospace`;
    ctx.fillStyle = PALETTE.cream;
    ctx.fillText(String(match.state.scoreUs), pad, barH * 0.64);
    // Right team.
    ctx.textAlign = 'right';
    ctx.font = `700 ${labelFont}px PressStart, monospace`;
    ctx.fillStyle = match.opponent.colors.primary;
    ctx.fillText(match.opponent.abbr, w - pad, barH * 0.29);
    ctx.font = `${scoreFont}px PressStart, monospace`;
    ctx.fillStyle = PALETTE.cream;
    ctx.fillText(String(match.state.scoreThem), w - pad, barH * 0.64);

    // Center clock.
    ctx.textAlign = 'center';
    const clockLabel = this.clockText(match.state.clock);
    const qLabel = match.state.overtime ? 'OT' : `Q${Math.min(match.state.quarter, 4)}`;
    ctx.font = `700 ${labelFont}px PressStart, monospace`;
    ctx.fillStyle = 'rgba(240,245,235,0.55)';
    ctx.fillText(`${qLabel}  ·  ${clockLabel}`, w / 2, barH * 0.31);
    ctx.font = `700 ${Math.max(8, labelFont * 1.1)}px Silkscreen, monospace`;
    ctx.fillStyle = match.state.possession === 'us' ? match.playerTeam.colors.primary : match.opponent.colors.primary;
    ctx.fillText('OFFENSE', w / 2, barH * 0.66);

    // Down & distance pill.
    const dnd = `${this.ordinal(Math.min(4, match.state.down))} & ${Math.max(1, Math.ceil(match.state.toGo))}`;
    const spot = this.spotLabel(match.state.spot);
    const pillW = Math.min(w - pad * 2, Math.max(132, w * 0.42));
    const pillH = Math.max(20, barH * 0.56);
    const pillX = pad;
    const pillY = barH + 7;
    ctx.fillStyle = 'rgba(4,8,13,0.82)';
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.max(7, labelFont * 0.95)}px PressStart, monospace`;
    ctx.fillStyle = match.state.down === 4 ? PALETTE.yellow : 'rgba(236,245,232,0.9)';
    ctx.fillText(dnd, pillX + 7, pillY + pillH / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(236,245,232,0.55)';
    ctx.fillText(spot, pillX + pillW - 7, pillY + pillH / 2 + 1);

    // Hype meter.
    const meterW = Math.min(150, w * 0.36);
    const meterH = 8;
    const mx = pad;
    const my = this.h - 24;
    ctx.font = `700 ${Math.max(6, labelFont * 0.8)}px PressStart, monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(236,245,232,0.5)';
    ctx.fillText('HYPE', mx, my - 9);
    const segs = 10;
    const filled = Math.round((match.state.hype / 100) * segs);
    for (let i = 0; i < segs; i++) {
      const segW = (meterW - (segs - 1) * 2) / segs;
      const x = mx + i * (segW + 2);
      ctx.fillStyle = i < filled ? (i >= 7 ? PALETTE.magenta : PALETTE.cyan) : 'rgba(255,255,255,0.1)';
      ctx.fillRect(Math.round(x), my, Math.round(segW), meterH);
    }
    if (match.state.hype >= 34) {
      ctx.fillStyle = PALETTE.magenta;
      ctx.font = `700 ${Math.max(6, labelFont * 0.75)}px Silkscreen, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('BURST READY', mx + meterW + 8, my + 4);
    }

    // Rewinds.
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.max(7, labelFont * 0.9)}px PressStart, monospace`;
    ctx.fillStyle = match.canRewind() ? PALETTE.yellow : 'rgba(236,245,232,0.55)';
    ctx.fillText(`◀◀ x${match.state.rewinds}`, w - pad, this.h - 20);
    ctx.font = `400 ${Math.max(6, labelFont * 0.7)}px Silkscreen, monospace`;
    ctx.fillStyle = 'rgba(236,245,232,0.35)';
    ctx.fillText('REWIND', w - pad, this.h - 9);

    // REC indicator.
    if (Math.sin(this.time * 3) > -0.2) {
      ctx.fillStyle = 'rgba(255,60,80,0.9)';
      ctx.beginPath();
      ctx.arc(w - pad - 42, 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'right';
    ctx.font = `400 ${Math.max(6, labelFont * 0.65)}px Silkscreen, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('REC', w - pad - 36, 11);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = `400 ${Math.max(6, labelFont * 0.65)}px Silkscreen, monospace`;
    ctx.fillText('SP', pad, barH - 7);

    // Context hints.
    const sim = match.sim;
    if (match.phase === 'live' && sim) {
      let hint = '';
      if (sim.phase === 'dropback' && sim.isPass) hint = 'TAP A RECEIVER · TAP THE QB TO RUN';
      else if (sim.phase === 'air') hint = 'BALL IN THE AIR';
      else if (sim.phase === 'carry') hint = match.state.hype >= 34 ? 'DRAG TO RUN  ·  TAP BURST FOR HYPE' : 'DRAG TO RUN';
      if (hint) {
        ctx.textAlign = 'center';
        ctx.font = `400 ${Math.max(7, labelFont * 0.82)}px Silkscreen, monospace`;
        const tw = ctx.measureText(hint).width;
        const hx = w / 2;
        const hy = this.h - 42;
        ctx.fillStyle = 'rgba(4,8,13,0.7)';
        ctx.fillRect(hx - tw / 2 - 7, hy - 9, tw + 14, 18);
        ctx.fillStyle = 'rgba(236,245,232,0.7)';
        ctx.fillText(hint, hx, hy + 1);
      }
    }
    if (match.phase === 'ready') {
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.max(8, labelFont)}px PressStart, monospace`;
      ctx.fillStyle = 'rgba(255,209,102,0.9)';
      ctx.fillText('TAP TO SNAP', w / 2, this.h - 44);
    }
    if (match.phase === 'block') {
      // Red and blinking, like the moment deserves.
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.max(8, labelFont)}px PressStart, monospace`;
      ctx.fillStyle = `rgba(255,107,122,${(0.62 + Math.sin(this.time * 12) * 0.28).toFixed(2)})`;
      ctx.fillText('PUNT BLOCKED · LOOSE BALL', w / 2, this.h - 44);
    }
  }

  private drawKick(match: Match) {
    if (match.phase !== 'kick' || !match.kick) return;
    const ctx = this.ctx;
    const w = this.w;
    const barW = Math.min(w * 0.72, 320);
    const x = (w - barW) / 2;
    const y = this.h * 0.66;
    const h = 16;
    ctx.fillStyle = 'rgba(4,8,13,0.9)';
    ctx.fillRect(x - 6, y - 26, barW + 12, h + 46);
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(8, Math.min(12, w * 0.026))}px PressStart, monospace`;
    ctx.fillStyle = PALETTE.cream;
    ctx.fillText(`${match.fieldGoalDistance} YD FIELD GOAL`, w / 2, y - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, barW, h);
    const perfectW = barW * match.kick.perfectHalf * 2;
    const goodW = barW * match.kick.goodHalf * 2;
    ctx.fillStyle = 'rgba(255,209,102,0.35)';
    ctx.fillRect(w / 2 - goodW / 2, y, goodW, h);
    ctx.fillStyle = 'rgba(94,230,168,0.7)';
    ctx.fillRect(w / 2 - perfectW / 2, y, perfectW, h);
    const nx = x + barW * match.kick.pos;
    ctx.fillStyle = PALETTE.cream;
    ctx.fillRect(nx - 1, y - 4, 3, h + 8);
    ctx.font = `400 ${Math.max(7, w * 0.018)}px Silkscreen, monospace`;
    ctx.fillStyle = 'rgba(240,245,235,0.7)';
    ctx.fillText('TAP TO KICK', w / 2, y + h + 16);
  }

  private drawFlash(match: Match) {
    const sim = match.sim;
    if (!sim) return;
    if (sim.flash > 0) {
      this.ctx.fillStyle = `rgba(255,255,255,${Math.min(0.24, sim.flash * 0.35)})`;
      this.ctx.fillRect(0, 0, this.w, this.h);
    }
    if (sim.freeTextTimer > 0 && sim.freeText) {
      const ctx = this.ctx;
      const p = clamp(sim.freeTextTimer / 0.9, 0, 1);
      const y = this.h * 0.28 - (1 - p) * 12;
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.max(12, Math.min(26, this.w * 0.055))}px PressStart, monospace`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4,7,11,0.8)';
      ctx.strokeText(sim.freeText, this.w / 2, y);
      ctx.fillStyle = PALETTE.cream;
      ctx.fillText(sim.freeText, this.w / 2, y);
    }
  }

  private drawRewind(match: Match) {
    if (match.rewindFx <= 0) return;
    const ctx = this.ctx;
    const t = match.rewindFx;
    ctx.save();
    ctx.fillStyle = `rgba(120,200,255,${0.06 + Math.sin(this.time * 20) * 0.02})`;
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < 7; i++) {
      const y = (hash(i + Math.floor(this.time * 24)) * this.h) | 0;
      const height = 2 + hash(i + 5) * 10;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(220,240,255,0.13)' : 'rgba(80,160,255,0.09)';
      ctx.fillRect(0, y, this.w, height);
    }
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(14, Math.min(30, this.w * 0.06))}px PressStart, monospace`;
    ctx.fillStyle = `rgba(240,250,255,${0.7 * Math.min(1, t)})`;
    ctx.fillText('◀◀ REWIND', this.w / 2, this.h * 0.5);
    // VHS tracking bars on the edges.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, this.h - 8, this.w, 8);
    ctx.restore();
  }

  // ------------------------------------------------------------- reel ui ---

  /**
   * The halftime reel's broadcast furniture: a tape tag, the moment counter and
   * the caption for the play being watched. The frames themselves go through
   * the ordinary field path, so what you watch is the real snap.
   */
  private drawReel(match: Match) {
    const reel = match.reel;
    if (!reel || match.phase !== 'halftime') return;
    const film = reel.moments[reel.index];
    if (!film) return;
    const ctx = this.ctx;
    const w = this.w;
    const pad = Math.max(8, Math.min(16, w * 0.025));
    const barH = Math.max(40, Math.min(52, this.h * 0.088));
    const labelFont = Math.max(7, Math.min(10, w * 0.022));
    ctx.textBaseline = 'middle';

    // Tape tag, under the scoreboard on the right so it clears the down pill.
    const tag = reel.active ? `◀◀ TAPE ${reel.index + 1}/${reel.moments.length}` : 'TAPE COMPLETE';
    const tagH = Math.max(18, barH * 0.52);
    ctx.textAlign = 'left';
    ctx.font = `700 ${Math.max(7, labelFont * 0.95)}px PressStart, monospace`;
    const tagW = ctx.measureText(tag).width + 14;
    ctx.fillStyle = 'rgba(4,8,13,0.86)';
    ctx.fillRect(w - pad - tagW, barH + 7, tagW, tagH);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(w - pad - tagW + 0.5, barH + 7.5, tagW - 1, tagH - 1);
    ctx.fillStyle = reel.active ? PALETTE.magenta : 'rgba(236,245,232,0.6)';
    ctx.fillText(tag, w - pad - tagW + 7, barH + 7 + tagH / 2 + 1);
    if (reel.active && Math.sin(this.time * 5) > -0.4) {
      ctx.fillStyle = 'rgba(255,46,136,0.9)';
      ctx.fillRect(w - pad - tagW - 9, barH + 7 + tagH / 2 - 2, 4, 4);
    }

    // Caption band, clear of the hype meter and the rewind count.
    const bandH = Math.max(42, Math.min(58, this.h * 0.09));
    const bandY = this.h - bandH - Math.max(58, this.h * 0.11);
    const bandX = pad;
    const bandW = w - pad * 2;
    ctx.fillStyle = 'rgba(4,8,13,0.86)';
    ctx.fillRect(bandX, bandY, bandW, bandH);
    ctx.fillStyle = reel.active ? PALETTE.yellow : 'rgba(255,209,102,0.45)';
    ctx.fillRect(bandX, bandY, 3, bandH);

    ctx.font = `700 ${Math.max(8, labelFont * 1.3)}px PressStart, monospace`;
    ctx.fillStyle = PALETTE.cream;
    ctx.fillText(this.fit(film.moment.headline, bandW - 24), bandX + 10, bandY + bandH * 0.3);
    ctx.font = `400 ${Math.max(7, labelFont * 0.95)}px Silkscreen, monospace`;
    ctx.fillStyle = 'rgba(236,245,232,0.8)';
    ctx.fillText(this.fit(film.moment.label, bandW - 24), bandX + 10, bandY + bandH * 0.62);
    ctx.fillStyle = 'rgba(236,245,232,0.45)';
    const speed = match.slowmoK > 0.02 ? 'HALF SPEED' : 'FULL SPEED';
    ctx.fillText(this.fit(`${film.moment.play.toUpperCase()} · ${speed}`, bandW - 24), bandX + 10, bandY + bandH * 0.87);
  }

  /** Trim text to the space it has, at the font that is currently set. */
  private fit(text: string, max: number): string {
    if (this.ctx.measureText(text).width <= max) return text;
    let out = text;
    while (out.length > 4 && this.ctx.measureText(`${out}…`).width > max) out = out.slice(0, -2);
    return `${out}…`;
  }

  private drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.35,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.78,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawScanline() {
    // A very subtle moving tracking line; CSS handles the static scanlines.
    const y = ((this.time * 26) % (this.h + 80)) - 40;
    this.ctx.fillStyle = 'rgba(255,255,255,0.018)';
    this.ctx.fillRect(0, y, this.w, 2);
  }

  private clockText(sec: number) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  private ordinal(n: number) {
    return n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : '4TH';
  }

  private spotLabel(spot: number) {
    if (spot <= 50) return `OWN ${Math.round(spot)}`;
    return `OPP ${Math.round(100 - spot)}`;
  }
}

// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from './GameScreen';
import { createFranchise } from '../game/season';
import type { Match } from '../game/match';

/**
 * The fourth-down deck is where the tape is easiest to lose: the engine keeps the
 * snapshot alive (`canRewind()` stays true and the HUD paints the counter gold),
 * but the deck is a different branch of the render tree from the result deck, so
 * the button can vanish without any engine test noticing. These checks mount the
 * real screen, drive a real third-down snap into the fourth-down deck, and press
 * the button a player presses.
 *
 * Sound and haptics are not the subject; they are stubbed so a headless DOM does
 * not have to own an audio device or a phone motor.
 */
vi.mock('../game/audio', () => ({
  audio: new Proxy({}, { get: () => () => undefined }),
}));

vi.mock('../native', () => ({
  haptic: () => undefined,
  reportBack: () => () => undefined,
  setHapticsEnabled: () => undefined,
  isNative: false,
}));

const fakeContext = () => {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (t, k) => {
      if (k === 'canvas') return undefined;
      if (k === 'measureText') return () => ({ width: 8 });
      if (!(k in t)) t[k as string] = () => undefined;
      return t[k as string];
    },
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  });
};

beforeAll(() => {
  // The render loop is replaced by the component's own 10fps HUD tick, which is
  // enough to move the deck from one phase to the next without a canvas.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => fakeContext(),
  });
});

afterEach(cleanup);

/** Mount the real game screen and hand back the match it built. */
const mount = async (): Promise<Match> => {
  render(
    <GameScreen
      franchise={createFranchise(42)}
      onExit={() => undefined}
      onFinish={() => undefined}
    />,
  );
  await waitFor(
    () => expect((window as unknown as { __match?: Match }).__match).toBeTruthy(),
    { timeout: 5000 },
  );
  const m = (window as unknown as { __match: Match }).__match;
  await waitFor(() => expect(m.phase).toBe('playcall'), { timeout: 5000 });
  return m;
};

/**
 * A real 3rd & 30 that cannot be converted on the ground, so `advance()` has to
 * open the fourth-down deck with the snapshot still armed.
 */
const driveToFourthDown = (m: Match) => {
  m.state.down = 3;
  m.state.toGo = 30;
  m.state.spot = 50;
  m.state.clock = 60;
  const card = m.cards.find((c) => c.kind === 'run') ?? m.cards[0];
  m.choosePlay(card.id);
  for (let i = 0; i < 60_000 && m.phase !== 'result'; i++) m.update(1 / 60);
  expect(m.phase).toBe('result');
  m.advance();
  expect(m.phase).toBe('fourth');
};

/**
 * The control this guard exists for. A bare findByRole surfaces as a generic
 * five-second timeout, which tells a future reader nothing; this names exactly
 * what went missing.
 */
const findDeckRewind = async () => {
  try {
    return await screen.findByRole('button', { name: /REWIND/ }, { timeout: 2500 });
  } catch {
    throw new Error(
      'the fourth-down deck is missing its REWIND button: no button named /REWIND/ was rendered after a failed third down',
    );
  }
};

describe('fourth-down rewind', () => {
  it('offers REWIND on the fourth-down deck while the tape is armed', async () => {
    const m = await mount();
    const tokens = m.state.rewinds;
    expect(tokens).toBeGreaterThan(0);

    driveToFourthDown(m);
    expect(m.canRewind()).toBe(true);

    const button = await findDeckRewind();
    expect(button.textContent).toContain(`(${tokens})`);
    expect(screen.getByText('FOURTH DOWN CALL')).toBeTruthy();
  });

  it('spends a token and returns the deck to play calling when pressed', async () => {
    const m = await mount();
    const tokens = m.state.rewinds;

    driveToFourthDown(m);
    const button = await findDeckRewind();
    fireEvent.click(button);

    expect(m.phase).toBe('playcall');
    expect(m.state.rewinds).toBe(tokens - 1);
    expect(m.state.down).toBe(3);
    expect(m.state.toGo).toBe(30);

    await waitFor(() => expect(screen.getByText('CALL THE PLAY')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText('FOURTH DOWN CALL')).toBeNull();
    expect(screen.queryByRole('button', { name: /REWIND/ })).toBeNull();
  });
});

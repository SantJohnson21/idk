// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import { installGameScreenStubs, mountGameScreen } from './rewind-deck-harness';

/**
 * The deck prints `BURST 34⚡` on the button that spends hype. The field is not
 * that button: a tap while the ball is carried is a stray thumb, and it used to
 * buy a burst silently. This mounts the real screen, runs a real handoff into the
 * carry, and taps the glass.
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

beforeAll(installGameScreenStubs);
afterEach(cleanup);

/** Deal a run, snap it, and advance the sim to the handoff. */
function intoCarry(m: Awaited<ReturnType<typeof mountGameScreen>>) {
  const card = m.cards.find((c) => c.kind === 'run') ?? m.cards[0];
  m.choosePlay(card.id);
  m.snap();
  for (let i = 0; i < 12_000 && m.sim?.phase !== 'carry'; i++) m.update(1 / 60);
  return m.sim?.phase === 'carry';
}

describe('carry taps', () => {
  it('does not spend hype when the field is tapped mid-carry', async () => {
    const m = await mountGameScreen(19);
    expect(intoCarry(m)).toBe(true);
    expect(m.phase).toBe('live');

    m.state.hype = 80;
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, { clientX: 24, clientY: 24, pointerId: 7 });
    fireEvent.pointerUp(canvas!, { clientX: 24, clientY: 24, pointerId: 7 });

    expect(m.state.hype).toBe(80);
    expect(m.sim?.phase).toBe('carry');
  });
});

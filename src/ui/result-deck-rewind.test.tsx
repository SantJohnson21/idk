// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  findRewindButton,
  installGameScreenStubs,
  mountGameScreen,
  resultDeck,
  snapIntoResult,
} from './rewind-deck-harness';

/**
 * The result deck is where most rewinds are spent: a tipped interception or a
 * fourth-quarter fumble is on screen for as long as the player looks at it. The
 * engine has always kept the snapshot; what is easy to lose is the button in
 * `result-actions`, which lives in a different branch of the render tree from
 * the fourth-down tape row. These checks mount the real screen, run a real snap,
 * and press the control a player presses.
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

describe('result-deck rewind', () => {
  it('offers REWIND on the result deck with the live token count', async () => {
    const m = await mountGameScreen();
    const tokens = m.state.rewinds;
    expect(tokens).toBeGreaterThan(0);

    snapIntoResult(m);
    expect(m.canRewind()).toBe(true);

    const deck = await resultDeck();
    const button = await findRewindButton('result deck', deck);
    expect(button.textContent).toContain(`(${tokens})`);
  });

  it('spends a token and returns the deck to play calling when pressed', async () => {
    const m = await mountGameScreen();
    const tokens = m.state.rewinds;

    snapIntoResult(m);
    const deck = await resultDeck();
    const button = await findRewindButton('result deck', deck);
    fireEvent.click(button);

    expect(m.phase).toBe('playcall');
    expect(m.state.rewinds).toBe(tokens - 1);

    await waitFor(() => expect(screen.getByText('CALL THE PLAY')).toBeTruthy(), { timeout: 5000 });
    expect(document.querySelector('.result-deck')).toBeNull();
    expect(screen.queryByRole('button', { name: /REWIND/ })).toBeNull();
  });
});

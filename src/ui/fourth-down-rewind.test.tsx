// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  driveToFourthDown,
  findRewindButton,
  fourthDownDeck,
  installGameScreenStubs,
  mountGameScreen,
} from './rewind-deck-harness';

/**
 * The fourth-down deck is where the tape is easiest to lose: the engine keeps the
 * snapshot alive (`canRewind()` stays true and the HUD paints the counter gold),
 * but the deck is a different branch of the render tree from the result deck, so
 * the button can vanish without any engine test noticing. These checks mount the
 * real screen, drive a real third-down snap into the fourth-down deck, and press
 * the button a player presses.
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

describe('fourth-down rewind', () => {
  it('offers REWIND on the fourth-down deck while the tape is armed', async () => {
    const m = await mountGameScreen();
    const tokens = m.state.rewinds;
    expect(tokens).toBeGreaterThan(0);

    driveToFourthDown(m);
    expect(m.canRewind()).toBe(true);

    const deck = await fourthDownDeck();
    const button = await findRewindButton('fourth-down deck', deck);
    expect(button.textContent).toContain(`(${tokens})`);
    expect(screen.getByText('FOURTH DOWN CALL')).toBeTruthy();
  });

  it('spends a token and returns the deck to play calling when pressed', async () => {
    const m = await mountGameScreen();
    const tokens = m.state.rewinds;

    driveToFourthDown(m);
    const deck = await fourthDownDeck();
    const button = await findRewindButton('fourth-down deck', deck);
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

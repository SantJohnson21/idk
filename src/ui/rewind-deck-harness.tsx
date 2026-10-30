import { render, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { GameScreen } from './GameScreen';
import { createFranchise } from '../game/season';
import type { Match } from '../game/match';

/**
 * Shared setup for the two decks that carry the tape. Rendering the real
 * `GameScreen` is the point — the affordances live in different branches of its
 * render tree, so only a mount can tell whether the one a player is looking at
 * still exists. Canvas, sound and haptics are stubbed: a headless DOM has no 2D
 * context, no audio device and no phone motor, and none of them is the subject.
 *
 * Each test file keeps its own `vi.mock` calls because Vitest hoists those per
 * file; everything else lives here.
 */

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

export function installGameScreenStubs() {
  // The render loop is replaced by the component's own 10fps HUD tick, which is
  // enough to move the deck from one phase to the next without a canvas.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => fakeContext(),
  });
}

/** Mount the real game screen and hand back the match it built. */
export async function mountGameScreen(seed = 42): Promise<Match> {
  render(
    <GameScreen
      franchise={createFranchise(seed)}
      onExit={() => undefined}
      onFinish={() => undefined}
    />,
  );
  await waitFor(
    () => {
      if (!(window as unknown as { __match?: Match }).__match) {
        throw new Error('the game screen has not built a match yet');
      }
    },
    { timeout: 5000 },
  );
  const m = (window as unknown as { __match: Match }).__match;
  await waitFor(
    () => {
      if (m.phase !== 'playcall') throw new Error(`the match opened in ${m.phase}, not playcall`);
    },
    { timeout: 5000 },
  );
  return m;
}

/** Run one real snap — a run card, so nothing is picked off — into the result deck. */
export function snapIntoResult(m: Match) {
  const card = m.cards.find((c) => c.kind === 'run') ?? m.cards[0];
  m.choosePlay(card.id);
  for (let i = 0; i < 60_000 && m.phase !== 'result'; i++) m.update(1 / 60);
  if (m.phase !== 'result') {
    throw new Error(`the snap did not resolve into a result deck (phase ${m.phase})`);
  }
}

/**
 * A real 3rd & 30 that cannot be converted on the ground, so `advance()` has to
 * open the fourth-down deck with the snapshot still armed.
 */
export function driveToFourthDown(m: Match) {
  m.state.down = 3;
  m.state.toGo = 30;
  m.state.spot = 50;
  m.state.clock = 60;
  snapIntoResult(m);
  m.advance();
  if (m.phase !== 'fourth') {
    throw new Error(`a failed third down did not reach the fourth-down deck (phase ${m.phase})`);
  }
}

const waitForDeck = async (
  selector: string,
  name: string,
  climbTo?: string,
): Promise<HTMLElement> => {
  try {
    return await waitFor(
      () => {
        const el = document.querySelector(selector);
        if (!el) throw new Error('not on screen yet');
        return (climbTo ? el.closest(climbTo) ?? el : el) as HTMLElement;
      },
      { timeout: 5000 },
    );
  } catch {
    throw new Error(`the ${name} deck never rendered: ${selector} did not appear`);
  }
};

/** The deck a player is standing on after the whistle. */
export const resultDeck = () => waitForDeck('.result-deck', 'result');

/** The deck after a failed third down; the tape row is a sibling of the grid. */
export const fourthDownDeck = () => waitForDeck('.fourth-grid', 'fourth-down', '.deck-block');

/**
 * The control these guards exist for. A bare findByRole surfaces as a generic
 * five-second timeout, which tells a future reader nothing; this names exactly
 * what went missing, and scopes the query to the deck under test so the other
 * deck's button can never satisfy it.
 */
export const findRewindButton = async (deckName: string, scope: HTMLElement) => {
  try {
    return await within(scope).findByRole('button', { name: /REWIND/ }, { timeout: 2500 });
  } catch {
    throw new Error(
      `the ${deckName} is missing its REWIND button: no button named /REWIND/ was rendered`,
    );
  }
};

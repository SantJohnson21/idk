# REWIND BOWL '87 — game audit

What the game actually does, what exercises it, and what is still missing. Written
against the source in `src/`, the headless suites, and a played season, not against
the design document's intentions.

Legend: **EXERCISED** = implemented and run by an automated check (or a played
season) · **FIXED** = a defect found in this audit and repaired, with a check that
fails if the repair is reverted · **GAP** = advertised or expected but not
implemented, or implemented but not verified here.

## Retro Bowl core loop

| Element | Status | Where / evidence |
| --- | --- | --- |
| Snap from a dealt hand of plays | EXERCISED | `match.choosePlay` / `snap`; `sim.test.ts` *Full games*, `season.test.ts` plays every week |
| Pass, rush, catch, tackle simulation | EXERCISED | `play.ts` (11-on-11 tick sim); `sim.test.ts` *PlaySim smoke*, *Full games* |
| Downs, distance, chains, turnover on downs | EXERCISED | `match.resolvePlay` / `advance`; `sim.test.ts` *Spot audit*, *Fourth-down stands* |
| Clock, quarters, halftime, overtime | EXERCISED | `match.endQuarter` / `startQuarter`; `sim.test.ts` *Full games*, the 14–14 OT case; `season.test.ts` |
| Scoring: touchdown + extra point, field goal, safety, defensive score | EXERCISED | `match.resolvePlay`, `kickNow`, `applyDrive`; `sim.test.ts` *Full games*, *Takeaway in our own red zone*; `season.test.ts` played season |
| Kicking meter | EXERCISED | `match.startFieldGoal` / `kickNow`; `sim.test.ts` *Full games* and *fourth-down stands* kick for real |
| Turnovers: interception, fumble, pick six | EXERCISED | `sim.test.ts` *forcedPick*, *forcedPickSix*, *Takeaway in our own red zone* |
| Punts, blocks, safeties, touchbacks | EXERCISED | `match.punt`; `sim.test.ts` *The blocked punt beat*, *backed-up drives* |
| Season schedule and standings | **FIXED** / EXERCISED | `season.ts`; `season.test.ts`. Fixed: playoff results were being added to the regular-season table |
| Playoffs and the Gridiron Bowl | EXERCISED | `season.ts` `ensurePlayoffs` / `advanceAfterGame`; `season.test.ts` bracket fixture and a played bracket run |
| Roster, season stats, MVP | EXERCISED | `mergeStats`, `getSummary`, `seasonMvp`; `season.test.ts` asserts the games counter and the history book |
| Tape upgrades, training, drafting, aging | EXERCISED | `season.ts`, `development.ts`; `sim.test.ts` *Season progression*, *age curve*, *prodigy*; `season.test.ts` offseason |
| Four save slots and career round trip | EXERCISED | `save.ts`; `sim.test.ts` *Save slots*; `season.test.ts` writes and reloads the career between every week |

## Claimed differentiators

| Hook | Status | Where / evidence |
| --- | --- | --- |
| **Tape rewind** | EXERCISED | `match.snapshot` / `rewind`; `sim.test.ts` rewind checks; `fourth-down-rewind.test.tsx`, `result-deck-rewind.test.tsx` mount the real screen |
| **Hot routes at the line** | EXERCISED | `play.hotRouteAt` / `setHotRoute`, `match.applyHotRoute`; `sim.test.ts` *Hot routes at the line*; the deck's menu is in `GameScreen` |
| **Scramble / take off** | EXERCISED | `play.scramble`, `match.scramble`; `sim.test.ts` *QB scramble*; deck button and QB tap in `GameScreen` |
| **Hype, burst, audible** | EXERCISED / **FIXED** | `match.burst` / `audible`; fixed: a tap on the field while carrying spent 34 hype with no cost on screen (`carry-tap.test.tsx`) |
| **Your club, your colours** | EXERCISED | `club.ts`; `sim.test.ts` *Choosing a club, and editing it*; editor reachable from the hub |
| **Ego and morale** | EXERCISED (indirect) | `applyMorale` after every game and `play.ts` applies morale to ratings; the season playthrough runs it, the roster screens show it |
| **Quirks** | EXERCISED except one (**GAP**) | Ten traits are read by `play.ts` / `match.ts`; **BALLHAWK has no simulation reference** — see gaps |
| **Weather** | PARTIAL (**GAP**) | Accuracy, catch and kick modifiers are applied and the renderer paints each state; **`speedMod` (footing) is never read** — see gaps |
| **Halftime reel** | EXERCISED | `film.ts`, `match.startReel` / `reelNext`; `sim.test.ts` *Halftime reel* |
| **Big moments stretch** | EXERCISED | `match.requestSlowmo`; `sim.test.ts` *Slow motion setting* |
| **The market** | EXERCISED | `market.ts`; `sim.test.ts` *The market*; buy/sell wired in `HubScreen` |
| **The drive log** | GAP (unverified) | Rendered from `match.playLog` in the pause panel (`GameScreen`); no automated UI check |
| **Four tapes** | EXERCISED | `save.ts`; `sim.test.ts` *Save slots*; `season.test.ts` weekly round trips |
| **Ages, camp curve, PRODIGY** | EXERCISED | `development.ts`; `sim.test.ts` *age curve*, *prodigy* |
| **Difficulty and settings** | EXERCISED (settings), difficulty wired | `sim.test.ts` *Settings hydration* pins the switches; toggles and difficulty segments live in `HubScreen`. `opponentStrength` applies the difficulty bonus, but no test asserts that difference |
| **A living broadcast** (field, scanlines, grain, timecode, ticker, synthesised audio) | GAP (unverified) | `render.ts` draws the field, CRT, grain, timecode and ticker; `audio.ts` synthesises every sound. No browser or device was available to see or hear it |
| **Landscape broadcast** | GAP (unverified) | `@media (orientation: landscape)` in `styles.css`; no browser in this workspace to confirm the reflow |
| **One-thumb touch controls** | PARTIAL | Tap paths in `GameScreen` and their guards are tested; phone-sized hit areas were not measured on a device |

## Defects fixed in this audit

1. **Playoff games padded the regular-season standings.** `advanceAfterGame`
   called `addStanding` for every filed week, including the semifinal and bowl, so
   a 15-game club read 16–17 games and had its points for/against inflated after
   the bracket was set. Standings now only take regular-season results.
   Pinned by `season.test.ts` *Playoff bracket*: the fixture files a real
   semifinal and asserts our row and the opponent's row are byte-for-byte
   unchanged. Reverting the guard fails the season harness with
   `mia should have played 15 games` (`expected: 15`).
2. **A field tap spent 34 hype mid-carry.** The carry branch of `tapField`
   called `burst()`, so any stray thumb bought a burst with no cost on screen —
   against the UI rule that a cost is printed next to the button that spends it.
   The tap no longer bursts; the `BURST 34` button and `B`/space still do. Pinned
   by `carry-tap.test.tsx`, which drives a real handoff and taps the canvas
   (reverting the fix fails with `expected 46 to be 80`).

## Remaining gaps (not silently dropped)

- **BALLHAWK does nothing in the sim.** The quirk exists in `data.ts`, affects
  market pricing and is displayed on players, but no simulation code reads it.
  Our defense is simulated drive-by-drive at team level, so an individual
  defender's quirk has nowhere to act yet.
- **Weather footing (`speedMod`) is unused.** Rain, snow and fog change accuracy,
  catching and kicking; the footing modifier is defined but never applied to
  movement. The README's "footing" claim is therefore only partly true.
- **Visibility in fog/snow is presentation only.** The renderer dims the field
  and draws weather, but the sim does not restrict which receivers/defenders the
  player can read; the bias comes from accuracy and catch modifiers.
- **No two-point conversions.** A touchdown always attempts a one-point kick.
- **No kickoff or punt returns.** Drives begin at a spot; return yardage and
  return touchdowns are not modelled.
- **No timeouts or hurry-up offense.** The clock runs on a fixed per-play runoff;
  the design document's "two-minute offense" has no dedicated mechanic.
- **Drive log has no automated test.** It is reachable by pausing mid-drive and
  renders `playLog`, but no test asserts the panel or the air-yards row.
- **Landscape and real-device touch layout are unverified here.** The media
  queries and tap zones exist; this workspace has no browser or phone, so the
  layouts were not observed. `DEVICE-CHECK.md` is the manual pass for those.
- **Out of scope by design:** defensive play calls, player-controlled defense,
  trades/bidding, injuries, contracts and multiplayer. See `DESIGN.md` §9.

## How to re-run

```bash
npm ci
npm run build                      # tsc --noEmit + vite build
npm test                           # sim, season playthrough, UI guards, store tooling
npm run release:record:check       # MOBILE.md matches the current dist/
```

`src/game/season.test.ts` is the season-level harness: it plays every scheduled
week as a real `Match`, files the result through `finishGame`, writes and reloads
a save slot between weeks, walks the offseason into a second year, and then plays
a forced-bracket semifinal to pin the standings rule.

# REWIND BOWL '87 — design document

## 1. The pitch

A football game you can finish a season of on the bus. You never control a defense, you never
manage a depth chart of forty men, and you never lose a game to something you did not see happen:
you call a play, you make a throw, you run, and when the tape goes bad you spend a token and
watch it roll backwards.

Retro Bowl proved that football compresses beautifully into one thumb and a hand of play cards.
REWIND BOWL keeps that skeleton and adds the one thing a highlight-reel sport is missing:

> **The broadcast itself is a resource.** You are playing a game that has already been recorded.

Everything in the design follows from that idea.

## 2. Pillars

1. **Every snap is readable in under two seconds.** One hand of play cards, one defense hint, one
   obvious decision.
2. **Mistakes are recoverable, but not free.** The rewind is the safety net, and it is scarce.
3. **The roster is characters, not numbers.** Quirks, egos and morale create stories that show up
   on the field.
4. **Rewind is a verb, not a menu.** The mechanic is presented as tape: tokens, a deck, a
   timecode, a CRT that warps when time runs backwards.

## 3. The rewind (signature system)

- Every game starts with **2 tokens** (upgradeable to 4 by spending tape on the deck).
- **Touchdowns bank another token**, capped at capacity + 2, so a hot offense plays with a longer
  safety net.
- Rewinding restores the entire pre-snap state: score, clock, down, distance, stats, hype, and
  the play call. It also rerolls the card hand, which is what makes it feel like a second chance
  rather than a save scum.
- Only the **last snap** can be rewound. Chains of rewinds are impossible without earning tokens.
- Presentation: the field inverts, scanlines tear, a VHS timecode spins backwards, and the crowd
  noise ducks out. The cost is felt before it is explained.

Why it works: it converts frustration into a decision. A tipped interception is not a punishment,
it is a price. In a game with 8-minute matches, that keeps a bad quarter from ending a session.

## 4. Core loop

```
Title (pick your club) → Hub (locker / schedule / film room / club editor)
      → The market: sign a veteran with tape, or sell a man you can spare
      → Play game: playcall → snap → live → result → next down
      → Postgame report (score, tape, MVP, highlights)
      → Offseason: scouting report + one pick + a cut
      → New season
```

### In-game loop (offense only)

1. **Playcall.** Four cards from the playbook are dealt. Each shows formation, concept and a
   scout hint ("they're showing blitz", "soft shell"). Pressure defense = quick game; deep shell =
   underneath. Audible (22 hype) rerolls the hand.
2. **Snap.** The line sets, routes release, and the pocket forms.
3. **Live.** Tap a receiver to throw with a live catch-percentage badge on each target, or keep the
   ball and run. Drag to steer; hold to sprint (drains stamina); sharp cuts can juke a pursuer.
4. **Result.** Yards, down and distance, and a headline. Hype pays out for first downs, big plays,
   broken tackles and touchdowns.
5. **Fourth down.** Go for it or kick — a two-tap timing meter for the field goal.
6. Your defense is simulated drive-by-drive with an on-screen drive chart, so roster building on
   that side of the ball still shows up in the scoreboard.

### Match shape

- Four quarters of 78 seconds of game clock (roughly 8 real minutes).
- Standard downs, chains, safeties, turnovers on downs, two-minute offense, and overtime.
- Weather is rolled per week and changes the sim, not just the tint.

## 5. Systems

### 5.1 The play simulation

Not an animation of a result — an actual 11-on-11 tick simulation at 30 Hz:

- **Alignment.** Formation-based skill positions, defensive front, man/zone/blitz/run-stuff shells.
- **Routes.** Waypoint route trees with breaks; receivers carry speed and heading through cuts.
- **Hot routes.** Before the snap, any receiver who is actually running a route can be re-routed
  from the line: `SLANT · OUT · CURL · GO · DRAG`. It is the same route a play card would hand him,
  rebuilt off his own alignment, so the defender already matched to him stays matched and the read
  stays honest — `GO` over press, `SLANT` behind a blitz, `CURL` in the soft spot of a zone. The snap
  count holds while the menu is up, and the ghost route drawn on the field redraws as you pick. A man
  staying in to protect is not a receiver on that snap and cannot be made into one.
- **Passing.** Aim is a point, not a receiver. Accuracy is a Gaussian spread driven by arm rating,
  distance, pressure and weather. The catch is contested against the nearest defender's coverage,
  hands and leverage. Leading your man matters.
- **Blocking.** Offensive linemen are assigned to rushers; the spare lineman climbs to the second
  level on runs so the Mike is not a free tackler in the hole. Blockers apply speed drag to
  defenders inside their reach, which is what creates the pocket and the running lane.
- **Pursuit.** Defenders take pursuit angles to an intercept point, with reaction delay, and rally
  to the ball. Broken tackles are a probability roll weighted by power, tackle rating, stamina and
  the burst surge.
- **Scrambling.** The pocket is not a cage: tap the quarterback, push the stick in the pocket or hit
  the gold
  `TAKE OFF` button and he tucks it and runs. The tap zone is sized on screen — a fingertip, not a
  fixed circle of field — and a receiver standing nearer the tap than the quarterback still gets the
  throw. From that frame the snap is a run in everything but the
  play card — same carry, same pursuit, same tackles — so a loss behind the line is a loss on the
  ground rather than a sack, and never a pass attempt. Only a pass play offers the escape; keeping it
  on a run play is the designed handoff.
- **Legibility.** The renderer draws the pocket, pursuit and contact so the player can see *why*
  something worked.

Design rule: when the sim and the fantasy disagree, the sim wins — but the numbers are tuned so the
fantasy is still legible. A good read should look open and *be* open.

### 5.2 Tape economy (the only currency)

| Source | Amount |
| --- | --- |
| Base per game | 32 |
| Win / tie / loss | +58 / +24 / +10 |
| Yards and touchdowns | ~1 per 7.5 yards, +9 per TD |
| Semifinal / Bowl | +60 / +120 |
| Winning the Bowl | +250 |
| Selling a player | 55% of his market price |

| Sink | Cost |
| --- | --- |
| +1 to any rating in training | scales with current rating |
| Team meeting (roster-wide morale) | 50 |
| +1 rewind capacity | scales, max 2 upgrades |
| A free agent veteran | 35–420: grade, position and quirk |

The economy is deliberately tight in year one: you can either patch a weakness or buy a longer
safety net. Both choices are visible on the same screen. The market is a second, sharper lever — a
fixed price list rather than an auction, at a 55% spread, so churning it always costs tape.

### 5.3 Hype, burst and audible

Hype is a 0–100 meter that starts at 24 and is fed by first downs (+16), touchdowns (+26), big
plays (+12), broken tackles (+7), and drained by turnovers (−6).

- **Burst (34)** — a guaranteed broken tackle plus a speed surge and a stamina hit. This is the
  "hero moment" button; it is expensive enough that you save it for third down.
- **Audible (22)** — reroll the hand. It is the check against a bad read, and the reason the
  scout hint matters.

### 5.4 Roster, ego and morale

- Every player has ratings (SPD, ARM, HANDS, BLK, COV, TKL, POW) plus a **quirk**.
- **Stars (ego 2) demand 3+ touches a game.** Feed them and morale climbs; freeze them out and it
  falls, which costs catch chances and blocking.
- Morale also drifts with results and is restored by team meetings and winning.
- Quirks are verbs: CANNON (+8 ARM on deep shots), BALLHAWK, IRON MAN (35% slower stamina drain),
  CLUTCH (+7 to everything in the fourth), SHOWTIME (+50% hype), SNIPER (wide kick window),
  MAGNET, BRUISER, BURNER, SURE HANDS, FIELD GENERAL.
- **Ages 18–40, one birthday per offseason.** The camp curve is the career: about +4 rating points
  at 18, fading every year to nothing by 27, level through the prime at 28, then decline from 29
  that steepens to −6 at 40. Decline hits speed and tackling before arm and hands and stops at a
  floor of 30, so a veteran is diminished rather than ruined. Ages come back on the roster, the
  training card, the market and a winter camp report.
- **PRODIGY, the rare career trait (about 1 in 12).** Separate from quirks: it changes what a
  player becomes, not what he does on a snap. Camp growth is paid at 1.6×, decline at 0.55×, and
  training costs 75% of the tape price. It is derived from the player's own name, position and
  number, so a fixed seed reproduces the same career; the roster, training card, market and camp
  report mark him with a gold star.

### 5.5 Season and offseason

- 8 weeks, 8 teams, top 4 seeds, semifinal, Gridiron Bowl.
- Standings, point differential, seed line, and a "road to the bowl" bracket.
- **Offseason:** every player turns a year older and runs training camp (the age curve above, with
  the biggest movers listed), then a five-prospect scouting report with position-weighted grades
  (a cornerback is not judged on his arm), one signing, and one cut — with roster minimums enforced
  so you cannot cut your way into an illegal lineup. The draft's cut is a straight release; the market is where men
  are bought and sold, and it is open all season.
- **The market:** six veterans on the wire, priced off a position-weighted grade, their position and
  their quirk. A signing goes into the depth chart where his grade says he belongs, so a bought star
  takes the field and a bought body rides the bench. The roster holds fifteen; at the cap you name
  the man who leaves. A sale pays 55% and puts him back on the wire, and the one deal the market
  refuses is a sale that would leave a position empty.
- Season history persists: record, points, playoff berth, bowl result, MVP, best finish, titles.

### 5.6 Weather

Six states: clear, Friday night, rain, wind, snow, fog. Each modifies accuracy, catching, footing
speed and kick difficulty. Snow and fog are the interesting ones: they reduce information
(visibility of the secondary) rather than just adding noise.

### 5.7 Difficulty and settings

Rookie / Pro / Legend adjust opponent ratings. Sound FX, music, CRT scanlines and haptics are all
toggleable, and the save hydrates defensively so an old save keeps working.

### 5.8 Your club

- **You choose who you coach.** Any of the league's sixteen clubs can be yours; each carries its own
  offence, defence and kicking grades, and the schedule is built around the one you pick — you
  never play yourself.
- **The club editor** (hub → `✎ EDIT CLUB`) owns the identity: city, nickname, three-letter
  abbreviation and the five colours the broadcast is painted from — primary (end zone wash, HUD bar,
  crowd), jersey (what your men wear), secondary (the end zone lettering and checker), accent
  (badge tick, film-room leaders) and dark (hero backdrop, badge shadow). Eight palettes are one tap
  away, the shipped colours are always restorable, and an end-zone swatch previews the pairing live.
- **Identity only.** Names and colours are editable; ratings, roster and tape are not. The tape is
  the only way to improve a football team, and a text field that sets ARM to 99 would end the game.
- Nothing here is cosmetic-only: the end zone, jerseys, HUD bar, crowd flecks, badge, hero and box
  score all read from the same five colours, so a repaint is visible on the very next snap.

### 5.9 Four tapes

Four save slots, each a separate `localStorage` key and a complete career: club, season, roster,
history and tape. The title card shows all four, marks the active tape, and can switch, start into an
empty slot or erase one after a confirmation. A single save from the first builds migrates into slot
1 once, and the active slot is restored on launch. The slot picker never hydrates or mutates a tape
it is only displaying.

## 6. Controls and UX

Portrait first, one thumb, tap-first — and the same game re-framed in landscape:

- Play cards are thumb-sized targets in the bottom third.
- Throw targets are the receivers themselves (plus any open spot), with a live catch-% badge.
- Hot routes are that same tap, one beat earlier: a tap on a receiver at the line opens his route
  menu and holds the snap count until you pick or back out. A tap anywhere else still snaps the ball,
  so the line keeps the feel it has always had.
- The count waits for a thumb instead of racing it: 2.8 s, stopped dead while a finger is on the
  field or a menu is open, with a gold bar under the snap row showing what is left. `SNAP ▶`, the
  space bar and a tap on open field still snap immediately, so patience costs a decisive player
  nothing. The old 1.15 s window was shorter than a hand travelling to a receiver.
- The receiver's tap zone is a thumb, not a pointer: 3.2 yards at the line's camera (~35 px radius)
  on top of the camera-sized radius, nearest man wins. A tap that lands merely near the man you meant
  opens him; a tap clear of every receiver still snaps.
- Running is a virtual stick anywhere on the lower screen.
- **Landscape is the wide broadcast.** Turning the phone puts the field on the left and the
  tape deck in a column beside it; the camera widens from a 35×28-yard portrait keyhole to
  roughly 44 yards across and 70 downfield, so a whole route tree is visible. The rotation is
  handled in place: the clock, score, drive and play hand all survive it.
- Scrambling uses that same stick (or a tap on the quarterback, or the pocket's `TAKE OFF` button),
  because a scramble is just running that starts earlier. The tap's zone is measured in screen
  pixels, so it stays a fingertip on a phone, and nearest-wins keeps a checkdown's throw intact.
- Burst, audible, rewind and pause are large, fixed buttons with cost labels.
- Desktop maps the same actions to keys, so the game is playable and testable without a phone.

Interface rules: never more than one primary action per screen; the clock and score always visible;
costs always printed next to the button that spends them.

## 7. Art and audio direction

- **Field:** top-down pixel field rendered to a low-resolution canvas and upscaled with smoothing
  off, so players are chunky and readable at phone size.
- **Broadcast:** CRT scanlines, vignette, film grain, a VHS timecode, channel bug and a commentary
  ticker. Rewinds warp the whole presentation.
- **Audio:** everything synthesized at runtime (no asset pipeline) — crowd bed, organ stings, kick
  thump, whistle, tape-rewind whirr, plus a menu music loop. All mixed low by default.

## 8. Balance targets (measured, not vibes)

The headless suite plays full games and asserts the match and season loops complete. Current
targets from `npm test` plus the run-play harness:

- Game scores in the high teens to low thirties; no shutouts on either side across seeds.
- Pass plays: ~72% completion when the player throws to the best read at the top of the drop
  (measured over 40 scripted attempts), falling off sharply when throwing into pressure or late;
  interceptions come from those late throws, not from random noise.
- Run plays: 2.5–4.5 yards per carry on a correctly followed gap, with occasional 15+ yard
  breakaways, and stuffed runs happening when you run into an unblocked defender.
- Tape earned per game roughly 110–180 (so one upgrade or two trainings a week).

Tuning that mattered most: defensive linemen start on the ball rather than a yard upfield;
man defenders matched to a backfield receiver scrape to the hole instead of chasing into the
backfield; the back taking the handoff is excluded from run blocking; and one lineman climbs to
the second level on runs. Without those four, every handoff died at the line of scrimmage.

## 9. What is intentionally out of scope

- No defense control, no play creator, no trades, no bidding wars — the market is a fixed price
  list, not an auction — and no multiplayer.
- No account, no server, no monetisation loop. Four franchises live in four `localStorage`
  slots; the title card remembers the active tape and can switch or erase any of them.

## 10. Next steps

1. **Defensive play calls** as a light second layer: pick a shell before the opponent's snap and
   watch the same sim resolve it.
2. **More tape verbs**: a "freeze frame" that slows the next snap for one play.
3. **Broadcast season**: the halftime reel already cuts the half's own film; the next step is a
   weekly and season-long cut assembled from stored play outcomes.
4. **Accessibility**: colour-blind-safe team palettes, reduced-motion mode, larger touch targets.
5. **Native packaging**: wrap in Capacitor for App Store / Play Store builds; the game is already
   asset-free and fully offline.

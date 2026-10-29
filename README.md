# REWIND BOWL '87

A tap-first retro football game for phones, played in a VHS broadcast that never quite stops rolling.

You pick one of the Gridiron League's sixteen clubs and call its offense: deal a hand of plays, read
the defense, throw to a receiver or hand it off, then run for your life. When a drive dies on a tipped interception, you
spend a **tape token** and rewind the snap — score, clock, stats and all.

```
CALL THE PLAY. RUN THE ROCK. REWIND THE TAPE.
```

## Play it

```bash
npm install
npm run dev        # http://localhost:3000
```

Then open it on a phone-sized viewport (or your phone on the same network). Portrait is the
one-thumb frame; turn the phone sideways and the field widens, with the tape deck beside it.
Desktop works with the keyboard.

```bash
npm run build      # typecheck + production build
npm test           # headless simulation suite (plays full games, checks the season loop)
```

## Install it on a phone

The game ships as an installable app through [Capacitor](https://capacitorjs.com):
same bundle, wrapped in native Android and iOS projects with a splash screen,
Taptic-style haptics, a portrait/landscape frame and a working Android back button.

```bash
npm run mobile:devices   # what phone / simulator is attached
npm run mobile:preflight # check adb; prints install commands if no phone
npm run mobile:run:android  # build, install and launch on the device
npm run mobile:sync      # build + copy the web bundle into android/ and ios/
npm run mobile:android   # open Android Studio
npm run mobile:ios       # open Xcode (macOS)
npm run mobile:aab       # signed Play bundle
npm run play:assets      # 1080×1920 screenshots, feature graphic and icon
```

Signing keys, version numbers, the App Store privacy manifest and the store
checklists are documented in [MOBILE.md](MOBILE.md). The Play Console sequence,
listing copy, declaration answers and signed bundle are in [PLAY.md](PLAY.md) and
[`store/`](store/README.md). The hardware pass — splash,
haptics, back button, saves, audio — is [DEVICE-CHECK.md](DEVICE-CHECK.md); hold
the build stamp on the title card to open the in-game **DEVICE CHECK** panel that
it refers to. The public privacy policy is
[`docs/privacy.html`](docs/privacy.html); [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
publishes it to GitHub Pages when `main` is pushed.

## What makes it different

| Hook | What it does |
| --- | --- |
| **Your club, your colours** | Start a franchise with any of the sixteen clubs, each with its own offence, defence and kicking grades, then repaint it in the club editor: city, nickname, abbreviation and all five broadcast colours. The end zone, the jerseys, the HUD bar, the crowd and the badge all follow you. |
| **Hot routes at the line** | Before the snap you can re-route any receiver who is actually running one, from a five-route menu — `SLANT · OUT · CURL · GO · DRAG`. The defense is already showing its hand, so the choice is the read: `GO` over the top of press coverage, `SLANT` behind a blitz, `CURL` in the soft spot of a zone. The snap count holds while the menu is up, and the route ghost on the field redraws as you pick. The count is 2.8 s, the gold bar under the snap row shows what is left, and touching the field freezes it — so a thumb is never racing a clock. |
| **The tape deck** | Every game opens with 2–4 rewind tokens. Rewinding undoes the last snap completely. Touchdowns bank another. Running out of tape is the real clock. |
| **Hype + burst** | Big plays fill a hype meter. Spend 34 hype for a guaranteed broken tackle and a speed spike, or 22 to audible into a fresh hand of play cards. || **Ego and morale** | Stars demand 3+ touches a game. Feed them or the locker room sours, and morale quietly moves catch chances, blocking and training. |
| **Quirks** | Eleven traits (CANNON, BALLHAWK, IRON MAN, CLUTCH, SHOWTIME, SNIPER…) bend the sim, not just the numbers. |
| **Weather that bites** | Rain, wind, snow and fog change accuracy, footing, kicking and how far you can see the secondary. |
| **A living broadcast** | Pixel field, CRT scanlines, film-grain vignette, VHS timecode, synthesized crowd, organ stings and a commentary ticker. |
| **The halftime reel** | Every snap is filmed as it happens. At the break the half's three biggest moments — broken tackles, sacks, takeaways, scores from deep — replay in slow motion, captioned like a broadcast. `SLOW MOTION: OFF` or `REDUCED MOTION` runs the tape at full speed. |
| **Big moments stretch** | Break a tackle, get sacked, throw a pick or score from deep and the simulation itself slows for half a second — camera shake, a cool wash and the crowd hanging on the hit — then snaps back. The depth is the size of the moment: a sack for no gain is a nudge, a twelve-yard loss and a pick near your own goal line are the deepest. `SLOW MOTION` cuts the dip to a shorter, shallower beat or turns it off entirely, and `REDUCED MOTION` turns everything off. |
| **The market** | Six veterans sit on the wire every season, priced by grade, position and quirk. Sign one with tape — releasing a man if the roster is at its fifteen-man cap — or sell a body you can spare for 55% of his asking price. Sold players go back on the wire at a markup. |
| **The drive log** | Pause mid-drive for the running log of your own snaps: the down it was run on, what it produced, and how far a throw that never arrived actually travelled. A bomb broken up 24 yards downfield reads as a shot you took, not a down you wasted. |

## The season

Fifteen regular weeks against a fifteen-team league, top four make the playoffs, then a semifinal and
the Gridiron Bowl. Win or lose, the offseason brings a scouting report: five prospects, one pick,
and somebody on your roster has to go. Then training camp, tape upgrades, and a new year.

- **Tape** is the only currency: earned from wins, touchdowns, big plays and awards; spent on
  training (+1 to any rating), team meetings (morale), rewind capacity, and the market.
- **The market is open all year.** Buy a veteran, or sell somebody you can spare — the one deal it
  refuses is a sale that would leave a position empty.
- **The club editor** (hub → `✎ EDIT CLUB`) rewrites your city, nickname, abbreviation and the five
  colours the broadcast paints you in, with an end-zone preview as you go. The roster, the tape and
  the rest of the league are untouched — the tape decides your men.
- **Progression is permanent** across seasons: ratings, quirks, history, titles, and your best finish.

## Controls

**Touch**
- Tap a play card to call it, then — while `DEFENSE SHOWS` is up — tap a receiver to **change his
  route** (`SLANT · OUT · CURL · GO · DRAG`). The count runs 2.8 s and the gold bar under the snap
  row shows it; opening the menu or touching the field freezes it where it stands. A tap anywhere
  that is not a receiver, or `SNAP ▶`, still snaps the ball on the first touch.
- Tap a receiver (or any open spot) to throw.
- Tap the quarterback — or push the stick, or the gold `TAKE OFF` button — to **scramble**. The tap
  zone is a fingertip wide on screen, and a receiver nearer your tap still gets the throw. He tucks
  it and runs: the yards are his rushing yards, a loss behind the line is a loss on the ground (not
  a sack), and there is no throw to regret.
- Drag anywhere to run after the catch or on a handoff.
- `BURST` for a hype burst, `AUDIBLE` to reroll the hand, `◀◀` to rewind, `☰` to pause.
- At halftime, tap the field to jump to the next moment of the reel.

**Keyboard**
- `1`–`5` throw to a receiver, `Q` scramble, arrows/WASD to run, `B` burst, `A` audible, `R` rewind,
  `Esc` pause.

## Project layout

```
src/
  game/
    play.ts      11-on-11 play simulation: routes, coverage, blocking, pursuit, catching, tackling
    match.ts     downs, clock, kicking, opponent drives, rewinds, quarters, final whistle
    season.ts    schedule, standings, playoffs, stats, training, draft, the wire, history
    market.ts    free agent grades and prices, and the buy/sell deals for tape
    club.ts      your club's identity: names, colour palettes and the editor's rules
    playbook.ts  play cards, formations and route trees
    render.ts    canvas renderer: field, players, ball, HUD, VHS presentation
    audio.ts     synthesized SFX, crowd and music (no audio files)
    data.ts      teams, quirks, weather, names
    save.ts      localStorage franchise persistence with defensive hydration
  ui/            React screens: title (club picker), hub (market, club editor), game, offseason
  native.ts      Capacitor bridge: splash, status bar, haptics, back button
  styles.css     the whole broadcast aesthetic
android/         Gradle project: signing config, R8 rules, launcher icons
ios/             Xcode project: Info.plist, privacy manifest, export options
resources/       icon + splash masters (drawn by scripts/make-assets.mjs)
```

No art or audio files beyond three bundled fonts: the field, players, crowd, effects and
soundtrack are drawn and synthesized at runtime, so the game ships as code plus ~90 KB of font.

See [DESIGN.md](DESIGN.md) for the design document.

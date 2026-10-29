# Device check — REWIND BOWL '87

A hardware pass for the Capacitor shell: splash handoff, haptics and the Android
back button, plus the lifecycle checks that only fail on a real phone. Everything
here is pass/fail observable without a debugger — the game ships its own
**DEVICE CHECK** panel (hold the build stamp on the title card).

The Android release bundle has been compiled and validated in this workspace
(target API 36, signed AAB), but no phone was attached. Treat every hardware item
below as unverified until you run it; Xcode is still unavailable here.

---

## 0. Before you start

```bash
npm install
npm run mobile:devices      # what can I install onto?
```

| Need | Android | iOS |
| --- | --- | --- |
| Toolchain | JDK 17 + Android SDK 36 | macOS + Xcode 15, CocoaPods |
| Phone | USB debugging on, "Allow USB debugging" accepted | Developer Mode on, team selected in Xcode |
| Package | `com.rewindbowl.game.debug` (debug), `com.rewindbowl.game` (release) | `com.rewindbowl.game` |

The debug build carries an `applicationIdSuffix`, so it installs **alongside** a
release build. Uninstalling one does not touch the other's saves.

## 1. Get the build onto the phone

### Android over USB

```bash
npm run mobile:preflight                # adb/device check; prints install + launch if none
npm run mobile:run:android              # sync, build, install, launch
npm run mobile:run:android -- --target <id>    # skip the device prompt
```

Or build once and install by hand:

```bash
npm run mobile:apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run mobile:preflight` prints those install and launch lines with the device
serial filled in once a phone is authorised, so the hardware pass does not depend
on remembering the component name.

### iOS

```bash
npm run mobile:run:ios                  # boots the picked simulator/device
```

For a physical iPhone, open `ios/App/App.xcworkspace`, pick your team under
Signing & Capabilities, then Run. First launch on device also needs
Settings → General → VPN & Device Management → trust the developer certificate.

### Live reload (optional, much faster for a checklist pass)

```bash
npm run dev                # terminal 1 — Vite on 3000
npm run mobile:live:android # terminal 2 — installs and points the WebView here
```

`adb reverse` maps the phone's `localhost:3000` to your machine. Cleartext http is
allowed only by the debug manifest overlay (`android/app/src/debug/AndroidManifest.xml`);
release builds still refuse it. Ctrl+C restores the normal config. On iOS, use
`npm run mobile:live:ios` with the simulator (a physical iPhone needs your LAN IP
via `--host`).

### Console output

```bash
npm run mobile:logs        # Android: chromium + Capacitor console
```

## 2. Open DEVICE CHECK

On the title card, **hold the build stamp** (`BUILD 1.0.0 · HOLD FOR DEVICE CHECK`)
for about three-quarters of a second. In a desktop browser, add `?diag` to the
URL. The panel is a normal in-game modal; ✕ or the hardware back closes it.

A dev build also takes **`?block=1`**: the next punt you call is blocked, so the
loose-ball beat can be watched in seconds instead of waiting on a ~2% roll. The
switch is set and read only inside `import.meta.env.DEV` code, so a production
bundle contains no forcing path at all — `.qa/prod-block.mjs` runs a built `dist/`
in a browser to check exactly that. The dev-side pass is `.qa/block.mjs`.

A dev build also hands the QA harness two live handles: `window.__match` (the running
`Match`, for driving phases and reading the simulation) and `window.__rwRenderer` (the
field renderer, which turns a screen pixel into field yards). Both sit behind the same
DEV guard and are absent from a production bundle; `.qa/hot.mjs` uses them to put a
real thumb tap on a real receiver.

| Row | What it proves |
| --- | --- |
| `SHELL` | `ANDROID NATIVE` / `IOS NATIVE`, or `BROWSER` if the bridge did not load |
| `APP VERSION` / `APP ID` | The installed version and build number, straight from the OS |
| `PLUGINS` | `4/4 REGISTERED` — SplashScreen, StatusBar, Haptics, App |
| `SPLASH` | `HANDED OFF @ N MS`, or `STILL SHOWING` / `FAILED — reason` |
| `HAPTICS` | Buzzes sent, buzzes suppressed by the setting, last intensity |
| `HAPTIC SETTING` | The in-game toggle (`ON` / `OFF (IN-GAME)`) |
| `BACK BUTTON` | Press count and the last action the router took |
| `SAFE AREA` | CSS `env(safe-area-inset-*)` in px — all zero means the shell is not padding |
| `CAREER` | Season/week/tape read back out of localStorage |
| `CLUB` | Your club's city, nickname, abbreviation and primary colour, read straight back out of the save |
| `LIGHT` / `MEDIUM` / `HEAVY` | Fire the taptic engine directly, even with in-game haptics off |
| `COPY REPORT` | Whole snapshot as JSON, for a bug report |

`RAW` shows the same JSON if the clipboard is blocked. The snapshot is
session-only: relaunching resets the counters.

**Changed in the 2026-10-26 code audit (still no device run):** back on the final
report no longer opens `PAUSED`; backgrounding a live game now auto-pauses and
stops the crowd loop; the haptics mute counter actually increments; and the back
listener is registered once, so a press during navigation can no longer fire two
handlers. Haptics also moved from three fixed buzz lengths to a cue vocabulary
(selection tick, light snap, success and error patterns, two-stage rewind), with
duplicate sim/match events suppressed within 150 ms. C5–C7, D1, E3 and section B
describe the current behaviour.

---

## 3. Checklist

Record the measured value where asked — "feels fine" hides regressions.

### A. Launch and splash

| # | Do | Expect |
| --- | --- | --- |
| A1 | Force-stop the app, then launch from the home screen | Branded splash (icon + wordmark on `#080b12`) → title card. No white flash, no default Capacitor splash, no half-drawn canvas. |
| A2 | Immediately open DEVICE CHECK | `SPLASH` is green, `HANDED OFF @ … MS`. Write the number down: ______ ms. It is measured from the native splash handoff, so it excludes OS process launch. |
| A3 | Launch warm from the recents screen | No splash replay; the game returns to the screen you left. |
| A4 | Cold launch in airplane mode | Splash and title still appear — the app is fully offline. |
| A5 | Rotate the phone sideways | The app follows the rotation without a reload or splash. On the title and hub nothing clips or scrolls sideways; in a game the field moves to the left and the tape deck becomes a column beside it, with the drive's score, clock and down intact. Rotate back: the one-thumb stack returns. |
| A6 | Look at the notch and the home indicator | Title, hub header, buttons and the game HUD are clear of both. `SAFE AREA` shows non-zero top/bottom on a notched device. |
| A7 | Check the status bar over the title card | Light glyphs on the dark game, no opaque bar strip, no content hidden under the clock. |

### B. Haptics

Play speaks in a cue vocabulary, not one buzz:

| Moment | Cue |
| --- | --- |
| Any menu button, hub tab, settings toggle or list row | selection tick |
| Picking a play card or a fourth-down call | selection tick |
| SNAP, kickoff, kick ready | light tap |
| Throw | light tap |
| Quarterback takes off (scramble) | light tap |
| Catch | medium |
| Tackle | medium, firmer |
| Broken tackle | medium then light |
| First down, field goal | light · light |
| Touchdown / extra point | success pattern |
| Interception, turnover, safety, opponent touchdown | error pattern |
| Rewind | heavy, then medium 110 ms later |
| Blocked punt | heavy thud, then the error pattern 120 ms later |
| End of quarter | light · light |
| Final whistle won / lost | success / error pattern |

The sim and the match both announce snap, throw and scores, so cues are ignored
if the identical cue fired within 150 ms — you should hear and feel one hit, not
two. A take-off carries its own cue name (`TAKEOFF`) so the `HAPTICS` row can tell
it apart from a hype burst.

| # | Do | Expect |
| --- | --- | --- |
| B1 | Tap `LIGHT`, `MEDIUM`, `HEAVY` | Three clearly different impacts; `HAPTICS` count climbs; no `HAPTIC ERROR` row. |
| B2 | Tap a play card, then a different one | A soft selection tick each time — noticeably finer than a snap. |
| B2a | From the title card: `NEW CAREER` → tap through the club picker's cards; then switch hub tabs; tap a player; open the club editor and tap a palette and `RESTORE ORIGINAL`; open and close a panel | One tick per press, on the downbeat of the button, all the way through the menus — the same fine tick as a play card. The colour swatches and the text fields deliberately do not tick: they hand the press to the system colour dialog and the keyboard. |
| B2b | Tap `REWIND` on a result, and tap `LIGHT`/`MEDIUM`/`HEAVY` in DEVICE CHECK | No menu tick: those deliberately hand straight over to the rewind and test cues, so you feel one pattern, not a tick plus a pattern. |
| B3 | Press `SNAP` | One light tap, crisp, not a thud. |
| B4 | Tap a receiver to throw | A light tap as the ball leaves, then a medium one on the catch. |
| B5 | Take a tackle, then a broken tackle | Firmer medium for the tackle; broken tackle adds a light follow-up. |
| B6 | Convert a first down, then score | Two quick light ticks for the first down; the success pattern for points. |
| B7 | Throw an interception, then watch the opponent score | Error pattern both times — not a success buzz. |
| B8 | Rewind a snap | Heavy thud with a second, softer hit about a tenth of a second later. |
| B9 | Play through a quarter break | Two light ticks, distinct from the first-down ticks by rhythm alone. |
| B10 | Hub → settings → `HAPTICS` off, then play | No taps during play; panel still fires; `HAPTIC SETTING` reads `OFF (IN-GAME)`; the muted counter rises on each event that would have buzzed. |
| B11 | Turn haptics back on and replay | Cues return without a relaunch. |
| B12 | iPhone: flip the ringer switch to silent, replay B1 | Taptic impacts still fire (they follow Settings → Sounds & Haptics → System Haptics, not the ringer). If nothing fires, check that system toggle. |
| B13 | iPhone in Low Power Mode, replay B1 | Record whether impacts weaken or stop — Low Power Mode may suppress them. It is a legitimate observation, not a shell failure. |
| B14 | Play for two minutes with haptics on | No stutter on the cue frames; the phone does not heat noticeably. |

### C. Back button (Android; iOS has none — mark N/A)

| # | Do | Expect |
| --- | --- | --- |
| C1 | On the title card, press back | App exits to the home screen. Reopen: the career is intact. |
| C2 | In the hub, press back | Returns to the title card. `BACK BUTTON` → `LAST BACK TO TITLE`. |
| C3 | Press back again without touching anything | Exits. One press never does both. |
| C4 | Open a hub panel (player card, settings, how to play), press back | Panel closes, you stay in the hub. `LAST CLOSED A PANEL`. |
| C5 | During a game, press back | `PAUSED` modal; `LAST PAUSED THE GAME`. Press back again: resumes (`LAST RESUMED THE GAME`). Again: pauses. |
| C6 | Paused → `QUIT GAME` → `FORFEIT & EXIT`, press back while the quit prompt is up | Prompt closes, game stays paused. `LAST CLOSED QUIT PROMPT`. |
| C7 | On the final report, press back | Nothing happens — no pause overlay over a finished game. `LAST REPORT — NO ACTION`. |
| C8 | In the offseason screen, press back | Returns to the title card (previously a dead press). |
| C9 | Switch to gesture navigation, edge-swipe back | Same results as C1–C5. Predictive back is disabled in the manifest so the WebView receives the gesture. |
| C10 | Open DEVICE CHECK, press back | Panel closes, press count +1, no navigation behind it. |
| C11 | Mash back three times | No crash; ends on the title card or the home screen, never mid-transition. |

### D. Saves and lifecycle

| # | Do | Expect |
| --- | --- | --- |
| D1 | Start a franchise, play a live snap, background the app for five minutes, return | The game comes back on the `PAUSED` modal with score, down, clock and tape preserved — never mid-play with the ball in the air. |
| D1a | Start a drive, call a play and get to the line, then rest a thumb on open field so the 2.8 s snap count freezes (the gold bar under the snap row stops). Without lifting, background the app — home/overview on Android, swipe up or the app switcher on iOS; ten seconds is enough. Return and tap `RESUME ▶` | The game comes back on the `PAUSED` modal, the ball still unsnapped, and the gold bar at the same remaining count it held when you left — going hidden never snaps it. `RESUME ▶` starts the bar moving again from that same value; it must not restart at 2.8 s, jump to empty, or stay frozen. Let it run out: the line snaps on schedule. `SNAP ▶` still snaps on the very first tap. Record the bar before hiding and just after resuming in §4 — a screenshot of each is enough. |
| D2 | Swipe the app out of recents, cold launch | `CONTINUE FRANCHISE`, correct season/week/tape; `CAREER` row agrees. |
| D3 | Install a new debug build over the old one, launch | Save survives an upgrade. |
| D4 | Reinstall (uninstall first) | Save is gone — expected: localStorage dies with the app. Confirm the title offers `START FRANCHISE`. |
| D5 | Compare `APP VERSION` with the build you installed | Matches `versionName`/`versionCode` (Android) or `CFBundleShortVersionString`/`CFBundleVersion` (iOS). |
| D6 | Start four franchises in the four slots, then switch between them from `SAVE SLOTS` | Every slot keeps its own club, season, week and tape; `CONTINUE FRANCHISE` opens the active one after a cold launch. Erasing one slot leaves the other three intact, and erasing the active one returns to the title without touching them. |

Saves are keyed by WebView origin. Changing `server.androidScheme` (currently
`https`) in `capacitor.config.ts` moves the origin and silently orphans every
save — do not change it in a shipped build.

### E. Audio

| # | Do | Expect |
| --- | --- | --- |
| E1 | Cold launch, wait, tap `START FRANCHISE` | Audio starts on that first tap (browsers and WebViews require an interaction), not before. |
| E2 | Toggle `SOUND` off and on | Crowd and effects silence, then return; `MUSIC` is independent. |
| E3 | Background during a game for a minute, return | The crowd stops while backgrounded (listen with the phone at your ear), then resumes once, with no doubled music or stuck loop. |
| E4 | iPhone: ringer switch on silent, play a snap | Record whether effects are muted. WKWebView-default behaviour is acceptable here; note it in §4 rather than "fixing" it blindly. |
| E5 | Take a call or trigger Siri, then resume | Audio recovers without restarting the app. |
| E6 | Plug in and pull out headphones mid-play | No permanent silence. |

### F. Feel and layout

| # | Do | Expect |
| --- | --- | --- |
| F1 | Play a full quarter | Steady frame rate; field fills the frame without stretching; scanlines and grain still visible. |
| F2 | Tap a receiver, drag to run, long-press the field | Throws and runs register; no page scroll, no zoom, no text selection, no long-press callout. |
| F3 | Play ten minutes | Phone warm but not hot; battery drain plausible for a canvas game. |
| F4 | Repeat A6 on the smallest phone you have (iPhone SE 375×667 / Android 360×640) | No clipped buttons; modals scroll instead of overflowing. |
| F5 | Launch on a tablet if you keep iPad support | Record the layout; `TARGETED_DEVICE_FAMILY` is `"1,2"`. Set it to `1` if portrait iPad looks wrong. |
| F6 | Take a solid tackle, then score a touchdown from deep | The frame nudges on contact and moves a little more on the score; a routine hit is a nudge, not a jolt. Only the field moves — the HUD, scoreboard and play cards stay still. |
| F7 | SYSTEM → turn `REDUCED MOTION` on, then replay a tackle and a touchdown | The frame does not move at all. Haptics, audio and gameplay are unchanged; the switch survives a relaunch. With the phone's own reduce-motion setting on, a new career defaults to ON. |
| F8 | Break a tackle, take a sack, throw an interception, then later score from 25+ yards out | Time thins out for roughly half a second on each: the action runs slow, a cool wash and one drifting band of light cross the frame, and it eases back to full speed on its own. The depth follows the size of the moment — a sack for no gain is a nudge, a twelve-yard sack and a pick near your own goal line are the deepest, and a pick at midfield sits between them. A short score, a stuffed run, an incomplete pass and a routine tackle all play at normal speed. |
| F9 | SYSTEM → `REDUCED MOTION` on, then repeat F8 | No slowdown and no wash — the play runs at full speed. Haptics, audio and gameplay are unchanged. |
| F10 | Play a half that produces a broken tackle, a sack, a takeaway or a score from deep, then reach halftime | The field cuts to a slow-motion tape of the half's best three moments, oldest first: each replays around the hit or the goal line at half speed with a cool wash, a `◀◀ TAPE 1/3` tag and a caption naming the play. Moments follow one another on their own; `NEXT` and tapping the field skip forward, `REPLAY` runs it again, `SKIP` drops back to the panel. Only your own snaps are filmed — opponent drives stay on the wire. A quiet half with no big play skips the tape entirely and shows the plain halftime panel. |
| F11 | SYSTEM → `REDUCED MOTION` on, then repeat F10 | The same three moments play at full speed with no wash and no dilation; the deck says so. The reel still plays. |
| F12 | SYSTEM → `SLOW MOTION` → `SHORT`, then repeat F8 | The same four moments still dip, at roughly half the depth and for less time, with a fainter wash. Then set it to `OFF`: nothing slows down and no wash crosses the frame, but the camera still moves on hits and scores — shake is its own switch. Haptics, audio and gameplay are unchanged, and the setting survives a relaunch. |
| F13 | Throw a deep ball into tight coverage, or lob one to a receiver with a defender on top of him, until the deck reports `BROKEN UP` | The deck reads `BROKEN UP` with `NO GAIN`, and the air tag still names the throw (`24 AIR`). The ball comes back to the previous spot: the down & distance pill in the field bar advances one down and keeps the same distance, the spot label (`OWN 24` / `OPP 31`) does not move, and the ball is spotted where it was snapped — never where the pass came down. `DROPPED` and a plain overthrow read the same way. `PAUSE` during the drive shows the same snap in the DRIVE LOG as `24 AIR` — the throw stays on the record even though the down is gone. A broken-up pass never turns up in the halftime tape (F10). |
| F14 | Punt until the rush gets home — about 1 in 50 punts, so keep punting from your own half — or rehearse it first with `?block=1` in a desktop dev build (§2), or set `window.__rwForceBlock = true` in the inspector console of a live-reload build to force the next one | The snap is replaced by the loose-ball beat: the ball squirts backwards off the block with a trail, dying hops and a red pulse ring, the camera follows it into your own backfield, and `PUNT BLOCKED · LOOSE BALL` blinks red where `TAP TO SNAP` sits. It runs about 1.35 s on its own; tapping the field, the card's `WHISTLE ▶` (or SPACE on a desktop) cuts it short, and either way the deck that follows is the one the block earned. That deck is the red `SPECIAL TEAMS · PUNT BLOCKED` card — `LOOSE BALL — THE KICKING TEAM HAS TO FALL ON IT.` on the beat, then — the moment the beat ends, or as soon as you whistle — the result deck reading `PUNT BLOCKED` with `KICK` and the yards lost behind the line, where `NEXT` hands them the ball. You should hear a low thud with the crowd's gasp under it — heavier than an ordinary punt — and feel a heavy impact, then the error pattern a heartbeat later; DEVICE CHECK's `HAPTICS` row reads `LAST BLOCK · HEAVY·ERROR` afterwards, or the muted counter climbs instead with haptics off. Nothing is paid twice: the spot and the score on the deck are the ones decided when the punt was blocked, and a block that dies behind your own goal line is a safety exactly once — 2 points to them, free kick from your 40. REDUCED MOTION changes none of it, since this beat is not a shake or a dip. |
| F15 | Call a pass play and take off with your quarterback while the pocket is live — tap **him** on the field, drag the field once the drop is past its first half-second, or hit the gold **`TAKE OFF`** button beside `PRESSURE n%`. Every pass play offers it, so there is nothing to wait on | The tap zone is sized on screen, not on the field: about 26 px of radius around him — roughly two and a half yards at phone zoom, where the old fixed circle was 1.8 — so a thumb-wide miss still takes off, while a tap on a receiver, or anywhere else, still throws. A receiver standing nearer the tap than the quarterback keeps the throw, so the wider zone never swallows a checkdown. **Record whether you miss him on a phone:** if you do, write it in §4, because the gold button is the intended route and this is the tie-break. He tucks it and runs — the ball stays in his hands, nothing is thrown, and `SCRAMBLE!` flashes across the upper field for about a second in the same cream pixel type as `HYPE BURST!`. The yards are his own: the stat strip and the postgame sheet read `N CAR · N YDS · N TD` while he has no pass attempts on the day, his total moves in the hub's `RUSHING` leaders once the game is finished, and `passAtt` never moves. `PAUSE` mid-drive shows the snap in the DRIVE LOG as an ordinary ground entry (`+7`), never with the `N AIR` tag a broken-up throw gets (F13). A take-off killed behind the line is charged as a loss on the ground — the deck prints the negative yards and never says `SACK`; the tackle line reads "after 0 yards" exactly as every other run does, because the chip is the authority on yardage. You should feel one light tap as he goes — not the firmer medium of a tackle, and not the two-stage `MEDIUM·LIGHT` of a hype burst; DEVICE CHECK's `HAPTICS` row reads `LAST TAKEOFF · LIGHT` afterwards, or the muted counter climbs instead with haptics off. `REDUCED MOTION` changes none of it, since a take-off is neither a shake nor a dip, and the stick route is deliberately inert for the first half-second of the drop so that a direction held from the snap is not an accidental take-off. |
| F16 | From the title card: `NEW FRANCHISE` → `CHOOSE YOUR CLUB`. Tap through all eight cards, then `COACH THE <NICKNAME> ▶` | Eight cards in two columns, each showing its badge, city, nickname and `OFF`/`DEF`/`KICK` grades, with the current pick outlined in gold. Each tap moves the outline, fires one selection tick and a select blip; the gold button carries the highlighted nickname. `BACK` leaves the picker with your existing career untouched — nothing is erased until the gold button is pressed. Starting lands you in that club: the hub hero's title and badge are the club you picked, and DEVICE CHECK's `CLUB` row reads it back out of the save (`SEATTLE SQUALL · SEA · #4ADE80`). Relaunch, and both `CONTINUE FRANCHISE` and the title card name it. **On the smallest phone you have (360×640), check that no card clips its nickname or its grades and that the two-column grid still fits without sideways scrolling** — if a card is cramped, write it in §4. |
| F17 | Hub → `✎ EDIT CLUB`. Rename the club in all three fields, tap each of the five colour swatches (46×34 px), try a palette, then `RESTORE ORIGINAL`, `CANCEL`, and finally a real edit with `SAVE CLUB ▶` | The preview at the top repaints as you type: the end-zone swatch in `PRIMARY` with the city across it, the badge beside it, and `CITY NICKNAME` over `ABBR · END ZONE, BADGE, HUD AND JERSEYS ALL FOLLOW THIS` underneath. **The swatches should open the platform's own colour dialog** — Android: the OS picker; iOS: the colour sheet. Pick something loud and confirm the swatch, the `#rrggbb` readout and the preview all follow it, and that the readout (9 px) is legible at arm's length — it is how you check a value on a screen you cannot eyedropper. If your WebView shows a plain text box instead of a dialog, write the OS and WebView version in §4: the field only accepts a real `#rrggbb` and anything else changes nothing (tested). Palettes repaint in one tap (`VHS TEAL`, `MIDNIGHT`, `EMBER` …), `RESTORE ORIGINAL` puts the shipped colours back, `CANCEL` closes with nothing written, and `SAVE CLUB ▶` is dead until something has actually changed. Paint `SECONDARY` the same as `PRIMARY` and read the warning: `PRIMARY AND SECONDARY ARE THE SAME — YOUR NAME WILL VANISH INTO THE END ZONE`. **At 360×640 the thing to judge is the 8 px hint under each label** — it is the smallest type in the app's menus — plus that all five colour rows fit the width without clipping the hex or the swatch, and that the keyboard never covers the field you are typing in. Name anything that fails in §4. |
| F18 | Save a repaint, then play a home snap and look around the field; afterwards read the box score and the hub | Your club plays in the colours you just chose: the end zone wash and its lettering, the jerseys on your men, the HUD bar, the crowd flecks, the hub's hero backdrop and the badge all follow the same five values, and the box score and the film room name the club you typed. The opponent keeps its own colours in the same frame — check one of their jerseys beside yours, because a patch that leaked into the rest of the league would show up here and nowhere else. DEVICE CHECK's `CLUB` row agrees with the field. `REDUCED MOTION` changes none of it. |
| F19 | Call a pass play and, while `DEFENSE SHOWS` is on screen, tap a receiver at the line | He opens his own five-route menu — `SLANT · OUT · CURL · GO · DRAG` and `CANCEL` — and the snap count stops while it is up: the eyebrow changes from `DEFENSE SHOWS` to `CHANGE HIS ROUTE`, naming the man (`WR1 · #11`), and the count resumes the moment you pick. The dashed route ghost on the field redraws as you choose: put `GO` on a man who was running a `CURL` and the line now runs 38 yards downfield instead of sitting at ten. `SNAP ▶` still snaps immediately, `CANCEL` backs out with the route he already had, a tap on the field snaps the ball there and then (the line's own `TAP TO SNAP` hint still means what it says, menu or no menu), and running the count out snaps with whatever is on the board. A tap anywhere that is not a receiver still snaps the ball exactly as it always did, so the line keeps the feel it has always had — and a man staying in to protect (the back on `DEEP POST`, anyone on a run) opens nothing, because he is not running a route to change. Each tap fires one selection tick (the `HAPTICS` row counts it, or the muted counter climbs with haptics off), and the snap itself is untouched: the same `N AIR` drive-log entry, the same stats, the same rewind. **The count is 2.8 s and the gold bar under the snap row shows it.** Rest a thumb on the field mid-count: the bar stops where it stands and starts again when you lift — that freeze is the whole feel of the change, so watch for it on the first snap. §4 wants one answer: with the bar in view, can you pick the man and the route one-handed without hurrying, **and does `SNAP ▶` or a tap on open field still snap on the first touch with no wait?** The tap zone around a receiver is a thumb (about 35 px at this zoom), so a tap that lands near the man counts as him; if that ever steals a snap you meant to take, say where. The chips are at least 64 px wide and 40 px tall; check them at 360×640 that the row wraps instead of clipping. `REDUCED MOTION` changes none of it. |
| F20 | Rotate the phone to landscape on the title card, then in the hub, then mid-drive with a play called and the snap count running | The whole app follows the rotation without a reload or a splash: the title still offers the same CTA and save line (no clipped buttons, no scrolling), the hub keeps its week, record and tape, and the game keeps its score, clock, down and play hand. In the game the field takes the left of the frame and the tape deck becomes a column beside it; the camera widens to show most of the field's 53-yard width and about twice the downfield stretch of portrait, so a full route tree fits. Play cards, receiver chips and `SNAP ▶` stay thumb-sized, the deck scrolls instead of clipping, and the rail's pause button is not under the notch. Rotate back to portrait mid-drive: the same drive continues, the snap count picks up from where it stood, and nothing restarts. Record the device and the exact before/after bar value in §4. |

### G. Release-build sanity

Everything above runs on a debug build. Two things only break when R8 and the
release signing config are in play:

| # | Do | Expect |
| --- | --- | --- |
| G1 | `npm run mobile:aab`, install the release build (bundletool or `bundletool build-apks --local-testing`), launch | Same splash, haptics and back behaviour as debug — a minified bridge that broke would show up as a blank screen or dead plugins. |
| G2 | Open DEVICE CHECK on the release build | `4/4 REGISTERED`, `SHELL … NATIVE`. Remote debugging is deliberately off in release. |
| G3 | Check the installed version in system settings | `versionName` from `package.json`, `versionCode` bumped past the last upload. |

---

## 4. Results

Copy this into the release ticket and fill it in.

| Area | Result (pass / fail / n/a) | Notes (splash ms, device, build) |
| --- | --- | --- |
| A. Launch and splash | | |
| B. Haptics (cue vocabulary) | | |
| C. Back button (Android) | | |
| D. Saves and lifecycle | | |
| E. Audio | | |
| F. Feel and layout | | |
| G. Release build | | |

```
Device:            (model, OS version)
Build:             (debug / release, version, build number)
Splash handoff:    ____ ms
Tester / date:     ____________________
```

### D1a evidence — backgrounding mid-hold

Run D1a above twice. For both runs, call a play, let the count start, then rest a
thumb on open field until the gold bar freezes. Without lifting, background the
app for ten seconds, return to the `PAUSED` modal, and tap `RESUME ▶`.

- **Run 1 — let it run out:** record the frozen value before hiding, the value
  on return, and the value immediately after `RESUME ▶`. Then leave it alone so
  the line snaps on schedule.
- **Run 2 — first tap:** repeat the hold and background, then tap `SNAP ▶`
  immediately after resuming to prove the snap still takes the first tap.

| Run | Bar before hiding | Bar on return (PAUSED) | Bar after `RESUME ▶` | Restarted at 2.8 s? | Ball snapped while hidden? | `SNAP ▶` first tap? | Result |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 — let it run out | ____ s | ____ s | ____ s | yes / no | yes / no | n/a | pass / fail |
| 2 — snap on return | ____ s | ____ s | ____ s | yes / no | yes / no | yes / no | pass / fail |

**Pass** when the return value equals the value before hiding, the bar after
`RESUME ▶` is that same remaining value or lower by the time you read it — never
`2.8 s` and never empty — the ball did not snap while hidden, and run 2's first
`SNAP ▶` works. **Fail** if the bar restarts, jumps to empty, or stays frozen,
if the ball snaps while hidden or on return, or if the first tap does nothing.
Note the failing run and attach `npm run mobile:logs` output if the console threw.

**Screenshots** — keep the gold bar and the `PAUSED` modal in frame, then attach
them to the release ticket:

- `D1a-before-<device>.png` — count frozen before hiding: ____________________
- `D1a-after-resume-<device>.png` — immediately after `RESUME ▶`: ____________________

**Notes:** ______________________________________________________________

## 5. Triage

| Symptom | Likely cause | Look at |
| --- | --- | --- |
| White or unstyled flash before the title | Splash hidden too early, or `webDir` not synced | `capacitor.config.ts` (SplashScreen), `npm run mobile:sync` |
| Splash never lifts | Plugin missing (`PLUGINS` row) or a JS error before `bootNative` | `npm run mobile:logs`, `src/native.ts` |
| `SHELL BROWSER` inside the app | Bridge script did not load — usually a stale `dist` or a bad `webDir` | `npx cap copy`, console log |
| No haptics on iOS | System haptics off, or the plugin is missing from `PLUGINS` | Settings → Sounds & Haptics, `npx cap sync ios` |
| Back exits the app from the hub | Back listener not attached, or the App plugin missing | `src/App.tsx`, `src/native.ts` |
| Back does nothing on one screen | No handler and no modal registered | `closeTopModal` in `src/ui/components.tsx` |
| Content under the notch | `viewport-fit=cover` or safe-area padding missing | `index.html`, `src/styles.css` |
| Layout jumps when the keyboard opens | `captureInput` / resize mode | `capacitor.config.ts`, Android `windowSoftInputMode` |
| Saves vanish after an update | WebView origin changed (`androidScheme`, app id) | `capacitor.config.ts` |
| Live reload shows a blank page | Dev server not running, cleartext blocked, or wrong host | §1, `adb reverse --list` |

## 6. What this pass cannot prove

- Taptic quality, audio mix and frame pacing are subjective — the panel proves
  wiring, not feel.
- The panel's counters reset on relaunch and are never uploaded; nothing in this
  app talks to a network.
- Store review, screenshots and listings are separate tasks (see `MOBILE.md`).

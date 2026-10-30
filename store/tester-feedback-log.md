# Closed-test feedback log — Rewind Bowl '87 1.0.0 (1)

**Status:** template. No testers have been recruited, no invitations sent and no
reports collected from this workspace. Every table below is empty on purpose; fill
it from real messages only.

This log exists so the 14-day closed test produces two things at once: the
evidence Play needs for production access, and a triaged list of what to fix
before 1.0.1. It pairs with [`closed-test-invite.md`](closed-test-invite.md)
(what testers are asked to do) and
[`PLAY_CONSOLE_RUNBOOK.md`](PLAY_CONSOLE_RUNBOOK.md) (what the console needs).

## Build under test

| Field | Value |
| --- | --- |
| Version | `1.0.0 (1)` |
| Package | `com.rewindbowl.game` |
| Bundle | [`store/rewind-bowl-1.0.0-v1.aab`](rewind-bowl-1.0.0-v1.aab) |
| AAB SHA-256 | `3747fa0d9f858ffdfbd9f8ba5286dc23932434ed7b4fcea74a0626303dccc51a` |
| Min / target SDK | 22 / 36 |
| Track | Closed testing → `closed-1.0.0` |

Pin every report to this SHA. A report against a different build is a different
bug until proven otherwise.

## Before the clock starts

- [ ] The closed release is live and the **opt-in URL** is pasted into
      [`closed-test-invite.md`](closed-test-invite.md).
- [ ] The privacy policy URL loads the policy in a browser. **Verified 2026-10-30:
      it returns 200 and serves the committed page byte-for-byte**, so this box is
      done; re-check it if `docs/` changes.
- [ ] At least 12 accounts are on the tester list; 14 is the working target.
- [ ] This file is where reports land, so testers are told one channel only.

## Roster

Twelve testers plus two spares. A spare only counts toward the 14-day requirement
if they are opted in, installed and playing.

| # | Tester | Google account | Device | Android | Invited | Opted in | Day 14 | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |
| 13 (spare) |  |  |  |  |  |  |  |  |
| 14 (spare) |  |  |  |  |  |  |  |  |

**Status values:** `invited` · `opted in` · `installed` · `active` · `quiet` (no
report yet) · `dropped` · `replaced`.

## 14-day opt-in grid

Production access needs **12 accounts opted in continuously for 14 days**, and an
opt-out restarts that tester's clock. Tick a box only when the account was opted
in that day; leave it blank when it was not. `✗` means a break — restart their
Day 1.

| Tester | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 | D12 | D13 | D14 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

**Running count opted in:** `__ / 12` · **Earliest production-access date:** `__`

Take a Console screenshot of the tester list on the last day. The grid is the
audit trail; the screenshot is the proof.

## Severity scale

| Level | Meaning | Examples in this game | Response |
| --- | --- | --- | --- |
| **S1 — blocker** | The tester cannot play, or loses data. | Crash or freeze mid-drive; save wiped after backgrounding; install or launch fails; anything that leaks data. | Same day. Fix or block the release. |
| **S2 — major** | Playable, but the game is wrong or a core control is dead. | Score, record or standings miscount; week does not advance; tape reward not added; hot-route tap does nothing; landscape drops the drive; SNAP unresponsive. | Acknowledge in 1 day, triage within 3. |
| **S3 — minor** | Wrong-looking but not wrong-playing. | Overlap at a large font size; clipped label; audio pop; a catch that reads oddly; sluggish rotate. | Triage in the weekly pass. |
| **S4 — polish** | Opinion, wish, tone. | “The halftime reel is too long”; “I want a second camera”. | Log, answer, do not promise. |

A report that cannot be reproduced from its steps is **`unreproduced`**, not
`fixed`. Ask the tester for the device model, the build SHA they had, and whether
it happened again before closing it.

## Report log

One row per report, newest last. Keep quotes verbatim in *What happened*; edit
only for length.

| ID | Date | Tester | Area | Sev | What happened | Steps to reproduce | Expected | Actual | Evidence | Repro | Status | Fix / build |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-001 *(example — not a real report)* | 2026-10-30 | 3 | Snap count | S2 | “The count kept going while I had my thumb down.” | Start a drive, hold a finger on the field before the snap. | Count freezes while the thumb is down. | Count reached zero and snapped. | screen recording | once | open | — |
|  |  |  |  |  |  |  |  |  |  |  |  |  |

**Status values:** `new` · `triaged` · `fixing` · `fixed in 1.0.1` · `accepted`
(known, shipping) · `unreproduced` · `duplicate` · `not a bug`.

## Area tags

Use exactly these so the roll-up counts mean something:

`install/launch` · `title` · `club pick` · `club editor` · `hub/season` ·
`play call` · `snap count` · `hot route` · `passing` · `catching` · `running` ·
`scramble` · `defense` · `rewind/tape` · `halftime reel` · `quarter break` ·
`file the report` · `market` · `draft/offseason` · `landscape` ·
`background/resume` · `save/persistence` · `audio/haptics` · `tap targets` ·
`performance/battery` · `copy/text`

`landscape` and `background/resume` carry extra weight: both were fixed late in
the 1.0.0 cycle, and both are on the hardware checklist in
[`../DEVICE-CHECK.md`](../DEVICE-CHECK.md).

## What each tester must actually cover

The invitation asks for one full game plus a season start. Check that each tester
touched these, because a “no bugs” report that never rotated the phone proves
nothing:

| Coverage | Asked in the invite | Testers who confirmed |
| --- | --- | --- |
| One complete game to the final whistle | yes |  |
| Season started, at least two weeks | “if you have time” |  |
| Landscape drive | yes |  |
| Hot route before the snap | yes |  |
| Quarterback scramble | yes |  |
| The market | yes |  |
| Club editor | yes |  |
| Backgrounded mid-drive and resumed | not asked — ask follow-up |  |

## Roll-up

Fill this at the end of the 14 days, not during; it is the summary that goes into
the production-access form and the 1.0.1 plan.

| Severity | Open | Fixed | Accepted | Unreproduced |
| --- | --- | --- | --- | --- |
| S1 |  |  |  |  |
| S2 |  |  |  |  |
| S3 |  |  |  |  |
| S4 |  |  |  |  |

| Question | Answer |
| --- | --- |
| Testers opted in continuously for 14 days | `__ / 12` |
| Testers who played a full game | `__ / 12` |
| Testers who played a drive in landscape | `__ / 12` |
| Crashes reported (all severities) |  |
| Open S1 at day 14 |  |
| Most-reported area |  |

## Exit criteria

Production access is requested when all of these are true — not when the 14 days
elapse:

- 12 or more accounts opted in continuously for 14 days, proven by the grid and a
  Console screenshot.
- Zero open **S1**; every **S2** fixed or explicitly accepted with a sentence in
  this file saying why.
- Every tester who reported an S1 or S2 has been told what happened to it. Silence
  is how a closed test loses its testers.
- The privacy policy URL returns 200 in a browser.
- The regression passes on the final build are green: `npm test`, the four
  `.qa/*.mjs` browser harnesses, and the hardware rows in
  [`../DEVICE-CHECK.md`](../DEVICE-CHECK.md).

## Debrief questions

Ask these in the day-14 follow-up, one message, not a survey link:

1. Did anything make you put the phone down and stop playing? What was it?
2. Was the snap count ever unfair — did it snap before you were ready?
3. Did the field make sense in landscape, or did you rotate back?
4. Did you ever lose progress? What were you doing?
5. What is the one thing you would fix first?

Their first answer is the most valuable data in this file. Write it down before
you defend anything.

## Sign-off

| Field | Value |
| --- | --- |
| Test window | `__` → `__` (14 continuous days) |
| Tester count at day 14 | `__` |
| Open S1 / S2 at close | `__` / `__` |
| Build shipped to testers | `1.0.0 (1)`, SHA-256 `3747fa0d…ccc51a` |
| Next build | `__` |
| Production access requested | `__` |

No entry above is filled until a real tester writes in. This file is a log, not a
results page.

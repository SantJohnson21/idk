# Closed test — Rewind Bowl '87 1.0.0 (1)

**Status:** ready to send once the closed release is live and the opt-in URL is
pasted. No testers have been recruited from this workspace; this is the invitation
copy, not a claim that a test has run.

## Before you send

- [ ] The closed-testing release `1.0.0 (1)` is live.
- [ ] At least 12 Google accounts are on the tester list; 14 is better.
- [ ] The Play Console **opt-in URL** is pasted below.
- [ ] `https://santjohnson21.github.io/idk/privacy.html` returns HTTP 200.
      **Verified 2026-10-30: 200, `text/html`, the committed policy page.** This
      box is done; re-check it if `docs/` changes.
- [ ] The message goes out from `tronjohnson57@gmail.com` or a monitored address.
- [ ] Testers are asked to stay opted in for 14 continuous days.

The 14-day clock starts when a tester accepts the invite. A tester who opts out
and back in restarts their own clock, so keep 12+ people opted in the whole time.

## Copy-paste invitation

**Subject:** Help test Rewind Bowl '87 — 12 Android testers

Hi [name],

I’m recruiting 12 Android testers, plus a couple of spares, for **Rewind Bowl '87**,
a retro football game built for one thumb. It’s a closed test, so the Play Store
link only works for the Google account you give me.

**What to do**

1. Open this link on your Android phone, signed in to the Google account you gave
   me: `<PASTE PLAY CONSOLE OPT-IN URL>`
2. Accept the invite and install the app.
3. Play at least one full game. If you have time, start a season.
4. Turn the phone sideways and play a drive in landscape.
5. Try a hot route, a quarterback scramble, the market and the club editor.
6. Keep the app installed and stay opted in for **14 continuous days**.

**What to send back**

- Phone model and Android version.
- One thing that felt good.
- One thing that felt wrong, confusing or broken.
- A screenshot if something looks off.
- For a crash: what you were doing and whether it happened again.

No account, no ads and no in-app purchases. The game works offline. The career
save is local; uninstalling erases it. Privacy policy:
<https://santjohnson21.github.io/idk/privacy.html>. Questions:
<tronjohnson57@gmail.com>.

Thanks,
[your name]

## Short version — text or chat

> I’m testing Rewind Bowl '87, a retro football game for Android. Can you be one
> of 12 testers? Open `<PASTE PLAY CONSOLE OPT-IN URL>` on your Android phone,
> signed in to the Google account you give me, then accept and install. Keep it
> for 14 continuous days. Play a game, rotate the phone, and tell me one thing
> that felt good and one that felt wrong. No account, no ads, works offline.

## Release notes — Play Console

Use this exact block for the first closed release. It is **251 characters**
(Play’s limit is 500), including the spaces and punctuation:

```text
First release. Sixteen clubs, a full fifteen-week season and playoffs, hot routes at the line, quarterback scrambles, tape rewinds, the market, the club editor, and a field that turns sideways with the phone. Offline: no ads, no purchases, no account.
```

The same block is in [`listing.md`](listing.md). If it changes, update both files
and the measured count in [`PLAY_CONSOLE_RUNBOOK.md`](PLAY_CONSOLE_RUNBOOK.md).

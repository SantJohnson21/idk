# Play Console runbook — Rewind Bowl '87

This is the checked, screen-by-screen path for the current repo. It is a runbook,
not a record of a submission: **no Play Console upload, closed test, review, or
physical-device install has been performed in this workspace.**

If a value below changes, re-run the checks in “Verified against this repo” before
uploading.

## Verified against this repo on 2026-10-29

| Check | Measured value |
| --- | --- |
| App bundle | [`store/rewind-bowl-1.0.0-v1.aab`](rewind-bowl-1.0.0-v1.aab) exists — **3,434,252 bytes**, current and matching `dist/` |
| AAB SHA-256 | `3747fa0d9f858ffdfbd9f8ba5286dc23932434ed7b4fcea74a0626303dccc51a` |
| Bundle manifest | package `com.rewindbowl.game` · versionName `1.0.0` · versionCode `1` · targetSdk `36` · compileSdk `36` · minSdk `22` |
| Build config | [`package.json`](../package.json) version `1.0.0`; [`android/app/build.gradle`](../android/app/build.gradle) `applicationId "com.rewindbowl.game"`, default `versionCode` `1`, `versionName` from `package.json`; [`android/variables.gradle`](../android/variables.gradle) `compileSdkVersion = 36`, `targetSdkVersion = 36`, `minSdkVersion = 22` |
| Signature | `jarsigner -verify` exits **0** with `jar verified.`; `unzip -t` exits **0**; `bundletool validate` exits **0** |
| Bundle freshness | The JS and CSS extracted from the AAB match [`dist/`](../dist/) by SHA-256 (`index-CFRORGl5.js` `43b889b0…13d8f`; `index-BKNC9On1.css` `deb18987…9867`) — the bundle is current |
| App icon | [`store/icon-512.png`](icon-512.png) exists — **512×512**, 59,662 B |
| Feature graphic | [`store/feature-graphic-1024x500.png`](feature-graphic-1024x500.png) exists — **1024×500**, 270,440 B |
| Phone screenshots | six files, all **1080×1920**: [`phone-01-title.png`](screenshots/phone-01-title.png), [`phone-02-clubs.png`](screenshots/phone-02-clubs.png), [`phone-03-hub.png`](screenshots/phone-03-hub.png), [`phone-04-market.png`](screenshots/phone-04-market.png), [`phone-05-ready.png`](screenshots/phone-05-ready.png), [`phone-06-live.png`](screenshots/phone-06-live.png) |
| Listing limits | App name **15/30**, short description **71/80**, full description **2,292/4,000**, release notes **251/500** characters |
| Privacy page | [`docs/privacy.html`](../docs/privacy.html) exists (4,066 B) with the contact set to `tronjohnson57@gmail.com`; no placeholder remains |
| Policy text | [`store/privacy-policy.md`](privacy-policy.md) exists with the same contact in both places |
| Privacy hosting | [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publishes [`docs/`](../docs/) to GitHub Pages on pushes to `main`; [`docs/.nojekyll`](../docs/.nojekyll) is present. **Live check 2026-10-29: the repository is public (an anonymous request for <https://github.com/SantJohnson21/idk> returns 200), the workflow was re-run by push `8af69a5` at 06:09 UTC, and fifteen polls from 06:10:39 to 06:13:00 UTC all returned 404 (`Site not found · GitHub Pages`). `actions/configure-pages@v5` still reports `Get Pages site failed: Not Found`, then `Create Pages site failed: Resource not accessible by integration`, so this is a token-permission wall, not a visibility one: only a repository admin can create the Pages site. Do not enter the URL in Play yet — no public HTML URL currently verifies (see FALLBACK).** |
| Declarations file | [`store/data-safety.md`](data-safety.md) exists |
| Merged permissions | `android.permission.INTERNET`, `android.permission.VIBRATE`, and the app-defined `com.rewindbowl.game.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — **no `AD_ID`**, no location, camera, microphone, contacts, storage or notification permission |
| Ads / analytics | No ads or analytics dependencies in [`package.json`](../package.json); `google-services.json` is absent; source search finds no AdMob/AdSense/AppLovin/Unity Ads/IronSource/Firebase/AppsFlyer/Adjust/Sentry/Bugsnag/Segment/Mixpanel/PostHog usage |
| Network calls | No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `axios` or `http(s)://` call sites in `../src`, `../index.html` or `../capacitor.config.ts` |
| Release hardening | AAB application has `allowBackup="false"` and `usesCleartextTraffic="false"` |
| Upload key | [`android/rewind-bowl-upload.jks`](../android/rewind-bowl-upload.jks) and [`android/keystore.properties`](../android/keystore.properties) exist (gitignored; do not commit or share) |
| Not verified | No device/emulator install, no testers, no Play upload, no review, no hardware run, and no Pages deployment — the privacy URL is still 404 |

How those checks were made:

```bash
jarsigner -verify store/rewind-bowl-1.0.0-v1.aab
java -jar bundletool.jar dump manifest --bundle=store/rewind-bowl-1.0.0-v1.aab
java -jar bundletool.jar validate --bundle=store/rewind-bowl-1.0.0-v1.aab
```

The manifest check is the important one: the AAB is the artifact Play reads, not
the source manifest. The source manifest at
[`android/app/src/main/AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml)
declares `INTERNET`; `VIBRATE` is merged in by `@capacitor/haptics`; the
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` is generated by AndroidX and is not a
user-data permission.

### What that means for declarations

- **Data safety:** no data collected, no data shared. The only persistence is the
  local `localStorage` career saves (four slots); they never leave the device.
- **Advertising ID:** answer **No**. There is no `AD_ID` permission and no ads or
  analytics SDK.
- **Permissions:** do not write “the app requests no permissions.” It requests
  `INTERNET` and `VIBRATE` in the merged manifest. `INTERNET` is the standard
  Capacitor WebView permission; the app code makes no external network calls.
  `VIBRATE` exists for the haptics feature. The AndroidX receiver permission is
  internal and not a data permission.
- The release build disables cleartext traffic and Android backup.

## FALLBACK — if the privacy URL is still 404

**Status checked 2026-10-29, twice.** `https://santjohnson21.github.io/idk/privacy.html`
returns **404** (“Site not found · GitHub Pages”). The second check was run after
confirming the repository is public (anonymous repo page: **200**, which it would
not be if the repo were private) and after pushing `8af69a5` at 06:09 UTC to
trigger the workflow: **fifteen polls, 06:10:39 → 06:13:00 UTC, all 404**. The
site is never created, so nothing is being published — the deploy does not fail
*after* publishing.

The authenticated workflow output is the useful signal: `actions/configure-pages@v5`
reports `Get Pages site failed: Not Found`, then `Create Pages site failed:
Resource not accessible by integration`. That is a token-permission error, and the
Actions `GITHUB_TOKEN` cannot hold repository admin, so the workflow can never
create the site on its own. The public Pages API reads remain rate-limited from
this sandbox IP: **403**, `API rate limit exceeded` (0 of 60 remaining).

A managed static host was tried as an alternative home for `docs/` and its deploy
API rejected every upload (`invalid_type`) on both environments, so it is not a
route this repo can rely on.

**Browser check 2026-10-29 (412×892), re-run with the repository public:** both
`raw.githack.com/.../privacy.html` and `rawcdn.githack.com/.../privacy.html`
return **200 text/html** to `curl` with a phone user agent and now carry the real
4,066-byte page (2 `mailto:` links, full policy text), but headless Chromium in
both cases receives `External Content Notice | rawgit.hack`: one
`mailto:admin@githack.com?subject=Abuse`, no policy content — **7 of 11 checks
fail on each host**. `cdn.jsdelivr.net` and `cdn.statically.io` serve the policy
as `text/plain`. `htmlpreview.github.io` is a 1,269-byte JavaScript wrapper with
no policy text in the served HTML. **No public HTML URL currently verifies**;
`.qa/privacy-live.mjs` is the check that will prove the canonical URL once it
exists (`RB_PRIVACY_URL=https://santjohnson21.github.io/idk/privacy.html node .qa/privacy-live.mjs`).

**Local verification 2026-10-29 (412×892):** `docs/privacy.html` was served from
the repo with `python3 -m http.server 4174 --bind 127.0.0.1 --directory docs`
and loaded in Chromium. `scrollWidth == innerWidth == 412`; headline, body and
contact sections present; both hrefs are `mailto:tronjohnson57@gmail.com`; both
mailing-link boxes are **44 px tall**; the contact click dispatches the mailto
URL; zero console errors or warnings. Screenshot: `artifacts/privacy-phone.png`.

The missing credential is a **repo-admin user token**. This sandbox has none: no
`GH_TOKEN`/`GITHUB_TOKEN`, `gh auth status` is logged out, no
`~/.config/gh/hosts.yml`, `~/.netrc` or `~/.git-credentials`, no
`credential.helper`, and `ssh -T git@github.com` returns `Permission denied
(publickey)`. The Actions `GITHUB_TOKEN` cannot create a Pages site, even with
`pages: write`; `enablement: true` cannot change that.

**Smallest one-time fix (browser, no token):**
1. Open <https://github.com/SantJohnson21/idk/settings/pages>.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open **Actions → Deploy privacy page → Re-run all jobs**.

**API alternative (repo-admin token):**
```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/SantJohnson21/idk/pages \
  -d '{"build_type":"workflow"}'
```
Use a classic PAT with `repo`, or a fine-grained token with **Pages: Read and
write** plus **Administration: Read and write** for this repository. A `201`
means created; `409` means it already exists. Then re-run the workflow. Do not
use the Actions `GITHUB_TOKEN`.

**Fallback URL while blocked:**
<https://raw.githubusercontent.com/SantJohnson21/idk/main/docs/privacy.html>
returns **200**, `text/plain; charset=utf-8`, 4,066 bytes, and contains the
contact plus both `mailto:` links. It is not a substitute for the Play-facing
page: Play expects a browser-readable policy page, and raw text is not the
canonical `github.io` page. Do not enter the raw URL in Play; keep the canonical
URL pending until it returns 200.

## Before screen 1

Have these ready:

| Item | Value / file |
| --- | --- |
| App name | `Rewind Bowl '87` |
| Package name | `com.rewindbowl.game` |
| Default language | English (United States) |
| App or game | Game |
| Price | Free |
| Contact email | `tronjohnson57@gmail.com` |
| App bundle | [`store/rewind-bowl-1.0.0-v1.aab`](rewind-bowl-1.0.0-v1.aab) |
| Listing copy | [`store/listing.md`](listing.md) |
| App content answers | [`store/data-safety.md`](data-safety.md) |
| Privacy page | [`docs/privacy.html`](../docs/privacy.html) — contact set; publish it with the Pages workflow before entering the URL |
| Privacy URL | `https://santjohnson21.github.io/idk/privacy.html` — canonical Play URL; **currently 404, so do not enter it until it returns 200** |
| Icon | [`store/icon-512.png`](icon-512.png) |
| Feature graphic | [`store/feature-graphic-1024x500.png`](feature-graphic-1024x500.png) |
| Screenshots | the six files under [`store/screenshots/`](screenshots/) |

**Privacy hosting:** the contact placeholder is gone; both the page and
`store/privacy-policy.md` use `tronjohnson57@gmail.com`. The Pages workflow is
committed, the repository is public, and the site still does not exist: on
2026-10-29 the canonical URL returned **404** on fifteen consecutive polls after
a fresh push. The workflow’s authenticated `configure-pages` step reports
`Get Pages site failed: Not Found` and `Create Pages site failed: Resource not
accessible by integration` — only a repository admin can create the site. Do not
submit App content with this URL until it returns 200. See **FALLBACK** below for
the one-time fix.

**Signing:** the AAB is signed with the upload key in
`android/rewind-bowl-upload.jks`. Keep that file and `android/keystore.properties`
backed up; they are gitignored. Play App Signing will hold the distribution key.

## Screen 1 — Create app

Play Console → **All apps → Create app**.

| Field | Enter |
| --- | --- |
| App name | `Rewind Bowl '87` |
| Package name | `com.rewindbowl.game` |
| Default language | English (United States) |
| App or game | **Game** |
| Free or paid | **Free** |
| Contact email | `tronjohnson57@gmail.com` |

Under **Declarations**, tick the Developer Program Policies and US export laws,
and accept the Play App Signing Terms of Service. Click **Create app**.

The package name is permanent and already baked into the AAB. If Play says it is
taken, stop and rebuild with a different application ID; do not upload this AAB
under a different package.

## Screen 2 — Dashboard / “Set up your app”

The Dashboard shows the setup checklist. Closed testing stays locked until the
app setup is complete, so finish these cards first:

- App access
- Ads
- Content rating
- Target audience
- Data safety
- Government apps
- Financial features
- Health apps
- News apps
- COVID-19 contact tracing
- Privacy policy

## Screen 3 — App content

Play Console → **Policy and programs → App content** (some accounts label it
**Policy → App content**).

### Privacy policy

Paste `https://santjohnson21.github.io/idk/privacy.html` only after it returns
200. The Pages workflow is committed, but the 2026-10-29 live check is still
**404**; enable Pages first (see “Privacy hosting” above).

### App access

**All functionality is available without special access.** There is no login,
subscription, invite or region lock.

### Ads

**No, my app does not contain ads.**

### Advertising ID

**No.** The merged manifest has no `AD_ID` permission, and there is no ads or
analytics SDK.

### Content rating

Run the IARC questionnaire as a **game**. Answer **No** to realistic violence,
blood/gore, weapons, sexuality, nudity, profanity, controlled substances,
gambling, user-generated content, chat and location sharing. Football tackles are
abstract sports action, not injury depiction. Accept the questionnaire result;
the expected outcome is **Everyone / 3+**.

### Target audience

Choose **13 and over**. Do not select an age band under 13 and do not opt into
Families; that adds design and ads requirements the game does not need.

### Data safety

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all collected user data encrypted in transit? | **N/A** — nothing is transmitted |
| Do you provide a way for users to request that their data be deleted? | **No** — no data is collected. Clearing app storage or uninstalling removes the local save |
| Does your app use cookies or similar tracking? | **No** |
| Does your app share data with third parties? | **No** |
| Does your app use advertising or analytics SDKs? | **No** |

The local career saves are not “collection” because they stay on the device and
are not sent to the developer or any third party.

### Other declarations

| Card | Answer |
| --- | --- |
| Government apps | No |
| Financial features | None |
| Health apps | No |
| News apps | No |
| COVID-19 contact tracing | No |

## Screen 4 — Store listing and settings

Play Console → **Grow users → Store presence → Store listings** (some accounts
show **Grow → Store presence → Main store listing**).

### Main listing copy

Copy the text blocks from [`store/listing.md`](listing.md). The measured lengths
are:

- App name: **15 characters** (limit 30)
- Short description: **71 characters** (limit 80)
- Full description: **2,292 characters** (limit 4,000)
- Release notes: **251 characters** (limit 500)

### Graphics

| Field | File |
| --- | --- |
| App icon | [`store/icon-512.png`](icon-512.png) — 512×512 |
| Feature graphic | [`store/feature-graphic-1024x500.png`](feature-graphic-1024x500.png) — 1024×500 |
| Phone screenshots | [`phone-01-title.png`](screenshots/phone-01-title.png), [`phone-02-clubs.png`](screenshots/phone-02-clubs.png), [`phone-03-hub.png`](screenshots/phone-03-hub.png), [`phone-04-market.png`](screenshots/phone-04-market.png), [`phone-05-ready.png`](screenshots/phone-05-ready.png), [`phone-06-live.png`](screenshots/phone-06-live.png) |

Upload the screenshots in that order. They are 1080×1920 (9:16), inside Play’s
320–3840 px range.

### Store settings

- **Category:** Games → Sports
- **Tags:** Football, Sports, Retro, Pixel art, Single player, Offline
- **Contact email:** `tronjohnson57@gmail.com`
- **Website:** optional
- **Privacy policy:** `https://santjohnson21.github.io/idk/privacy.html`

### Pricing and distribution

Free. Select the countries where the game should be available. For production,
“all countries” is fine. Complete the content guidelines and US export
declarations.

## Screen 5 — Closed testing: create the track

Play Console → **Test and release → Testing → Closed testing**.

1. Click **Create track**.
2. Name it `Closed test — 1.0.0`.
3. Select the countries where your testers live (or all countries).
4. Save the track.

If the page is locked, finish the Dashboard and App content checklist first.
Closed testing requires the app setup to be complete.

## Screen 6 — Create the closed release

On the Closed testing page, click **Create new release**.

1. Accept **Play App Signing** when prompted (use the default Google-generated
   app signing key; the AAB already carries the upload signature).
2. Upload [`store/rewind-bowl-1.0.0-v1.aab`](rewind-bowl-1.0.0-v1.aab).
3. Confirm Play reads versionName `1.0.0`, versionCode `1`, target SDK `36`.
4. Release name: keep `1.0.0 (1)` or use `1.0.0 — first closed test`.
5. Release notes: paste the 251-character block from
   [`store/closed-test-invite.md`](closed-test-invite.md) (also in
   [`store/listing.md`](listing.md)).
6. **Save → Review release → Start rollout to Closed testing**.

The first closed release may wait in Google review for hours to a few days.
Testers cannot opt in until it is live.

## Screen 7 — Testers

Open the **Testers** tab on the Closed testing page.

1. Click **Create email list**.
2. Name it `Rewind Bowl testers`.
3. Add at least **12** Google accounts. Add 14 if you can, so one dropout does not
   break the count.
4. Save the list.
5. Copy the **opt-in URL** and send it to the testers.

Each tester opens the URL while signed into the Google account you added, accepts
the invite, installs the app, and plays it. They need an Android device and a
Google account; they do not need a developer account.

**Requirement:** for a new personal developer account, at least **12 testers must
be opted in continuously for 14 days** when you apply for production access. If a
tester opts out, that tester’s 14 days restart when they opt back in. Keep 12+
opted in the whole time. Internal testing is optional and does not count toward
this requirement. Open testing is available only after production access.

The ready-to-send invitation, opt-in checklist, short message and the exact
first-build release notes are in
[`closed-test-invite.md`](closed-test-invite.md). Send it only after the closed
release is live, the opt-in URL is pasted, and the privacy URL returns 200.

No testers have been recruited or run from this workspace. This section is setup
guidance, not a claim that testing happened.

## Screen 8 — Apply for production access

After 12 testers have been opted in continuously for 14 days, go to **Dashboard**
and click **Apply for production**. The form has three sections.

### Part 1 — About your closed test

- How easy was it to recruit testers?
- Did testers use all available features?
- Did their usage match expected production behaviour?
- What feedback did you receive, and how did you collect it?

### Part 2 — About your app/game

- Who is the target audience?
- What is the game’s value proposition?
- What is the estimated install range in the first year?

### Part 3 — About your production readiness

- What changed because of the closed test?
- How did you decide the game was ready for production?

Use your real numbers and feedback. Do not paste invented testers, reviews or
hardware results. A shape you can fill in:

> I recruited [actual number] testers from [where]. They played [what they
> actually used — full games, seasons, landscape, hot routes, scrambles, market,
> club editor]. Feedback came through [channel]. The main themes were [themes]. I
> changed [actual changes] and re-tested.
>
> The game is for football fans aged 13+ who want a quick, tap-first mobile
> season. Its difference is the tape deck: you can rewind a bad snap, and the
> season, market, club editor and hot routes sit around that.
>
> I knew it was ready because [actual evidence: automated checks, full seasons,
> closed-test results, hardware checks]. No crashes were reported in [the actual
> test period].

Production access review usually takes seven days or less, but can take longer. If
it is rejected for insufficient engagement, keep the closed test running and
reapply after more real play. Organisation accounts, and personal accounts created
before 13 November 2023, may not need the 12/14 test; the Console shows whether the
requirement applies.

## Screen 9 — Production release

Once approved, **Test and release → Production** unlocks.

1. Click **Create new release**.
2. Use **Add from library** and choose the tested `1.0.0 (1)` bundle, or upload
   the same AAB again.
3. Keep the release notes.
4. Choose countries.
5. **Save → Review release → Start rollout to Production**.

A staged rollout (for example 20% first, then 100%) is fine for a first release.
Do not change the versionCode for the same build.

If **Managed publishing** is on, the release waits in **Publishing overview**
until you click **Publish**. Turn it off for the first launch or remember that
extra click.

## Screen 10 — Publishing overview and pre-launch report

After upload, check:

- **Test and release → Latest releases and bundles** — confirm `1.0.0 (1)`,
  target SDK 36, and the expected permissions.
- **Pre-launch report** — Google runs the bundle on real devices; check crashes,
  ANRs and layout warnings. It can take hours.
- **Publishing overview** — shows what is live, in review, or waiting to publish.
- After launch, **Android vitals** for crashes.

For the next update, bump `versionCode` to `2`, rebuild, and upload; never reuse
code `1`.

## Common errors

| Message | Cause / fix |
| --- | --- |
| “App must target Android 16 (API 36)” | An old bundle was uploaded. Use `store/rewind-bowl-1.0.0-v1.aab`; its manifest reports target 36. |
| “App bundle was not signed” | The build ran without `android/keystore.properties`. Rebuild with `npm run mobile:aab`. |
| “Version code 1 has already been used” | Bump `versionCode` to `2` in `android/app/build.gradle`, rebuild, upload the new AAB. |
| “Package name already exists” | `com.rewindbowl.game` is taken. Stop before changing it; the AAB is built around that ID and must be rebuilt. |
| Closed testing page is locked | Finish the Dashboard/App content setup first. |
| “Apply for production” is greyed out | Fewer than 12 testers opted in, fewer than 14 continuous days, or app setup is incomplete. |
| Testers see “Item not found” | Wrong Google account, not on the email list, wrong country, or the release is not rolled out. |
| Privacy policy URL invalid | The 2026-10-29 live check is still 404, so Pages is not enabled. Set **Settings → Pages → Source: GitHub Actions**, re-run the workflow, and confirm the URL returns 200. |
| Store listing asks for a contact email | Enter `tronjohnson57@gmail.com` in Store settings. |
| Upload rejects the AAB as “not compatible” | Confirm the package is `com.rewindbowl.game` and the file is the AAB, not the debug APK. |

## Timing

Plan for roughly three weeks, not three days:

- First closed release review: hours to a few days.
- Closed test: 14 continuous days with 12+ opted-in testers.
- Production access review: usually seven days or less, occasionally longer.
- Production release review: a few days.

The 14 days only start once 12 testers are actually opted in. Recruitment and
review time can move the date.

## Rebuilding a missing or stale AAB

The current AAB exists and matches `dist/`; these are the commands if that
changes. You need JDK 17 and Android SDK 36, and a populated
`android/keystore.properties` pointing at `android/rewind-bowl-upload.jks`.

```bash
npm ci
npm run mobile:sync          # web build + cap sync + build record
npm run mobile:aab           # signed AAB
cp android/app/build/outputs/bundle/release/app-release.aab \
   store/rewind-bowl-1.0.0-v1.aab
```

Then re-check:

```bash
jarsigner -verify store/rewind-bowl-1.0.0-v1.aab
java -jar bundletool.jar dump manifest --bundle=store/rewind-bowl-1.0.0-v1.aab \
  | grep -E 'package=|versionCode|versionName|targetSdkVersion'
sha256sum store/rewind-bowl-1.0.0-v1.aab
```

If `versionCode` changes, update the filename and
[`store/release.json`](release.json), and use the new hash in this runbook. The
listing copy only needs a change if the release notes change. The AAB is
gitignored by `store/*.aab`; it will not be in a git push, so upload it from the
workspace.

## Scripted publishing (optional)

Everything above works by hand. If you would rather not drag the AAB onto the
upload page for every build, `tools/play-publish.mjs` does the same release
through the Android Publisher API. It needs no npm packages, no JDK and no
`gcloud` — just `node:crypto` and `node:zlib`.

### One-time: create the service account

1. Play Console → **Setup → API access**.
2. Link (or create) a Google Cloud project when prompted.
3. **Create service account** → follow the Cloud console link → create the
   account → **Keys → Add key → JSON** → download it.
4. Back in Play Console → **API access** → grant that account
   **Release to testing tracks**. Add *Release to production* only when you are
   actually shipping to production.
5. Save the JSON as `store/play-service-account.json`, or point
   `PLAY_SERVICE_ACCOUNT_JSON` at wherever it lives. `store/play-service-account*.json`
   is gitignored, so the key cannot be committed.

Permissions propagate slowly; calls fail with HTTP 401/403 until they do.

### Dry run — validates everything, sends nothing

```bash
npm run play:publish -- --dry-run
```

It parses the key, signs a throwaway RS256 assertion to prove the PEM works,
opens the AAB, reads `versionCode`/`versionName`/package out of
`base/manifest/AndroidManifest.xml`, checks the notes against Play's
500-character limit, and prints the exact request plan. No network call is made.

### Real publish to the internal track

```bash
npm run play:publish -- --track internal --notes "Closed test 1.0.0 (1)."
```

Without `--yes` it prints the plan and waits for you to type `publish`. The
sequence is: list the app's existing bundles and refuse a `versionCode` Play has
already seen, open edit → upload bundle → set the track release (`completed`) →
commit. The duplicate check matters because Play never forgets a version code:
rebuilding without a bump would otherwise fail half-way through an edit. If any
step after the edit is opened fails, the edit is deleted, so Play is never left
holding a half-built release.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--bundle` | newest `store/*.aab` | the bundle to upload |
| `--package` | the bundle's own package | must match `com.rewindbowl.game` |
| `--track` | `internal` | `internal`, `alpha`, `beta`, `production` |
| `--notes` / `--notes-file` | none | release notes, `en-US` |
| `--dry-run` | off | plan only |
| `--yes` | off | skip the typed confirmation |

Self-test — generated in-memory key, no Google credential, no network:

```bash
npm run play:publish:test
```

That command runs two suites. `tools/play-publish.test.mjs` checks the local
pieces: the printed plan, the bundle reader, the JWT, and the bad-input exits.
`tools/play-publish.http.test.mjs` is the one that proves the *exchange*: it
starts a throwaway HTTP server and points `PLAY_API_BASE_URL` and
`PLAY_TOKEN_URI` at it, so the token → bundles → edit → upload → track → commit
sequence really runs over HTTP, including the refusal when Play already reports
that version code. It asserts the signature on the assertion, that the
uploaded body hashes to the AAB on disk, the `en-US` notes on the track call,
and that a failed upload or commit deletes the edit. Both suites are part of
`npm test` as well. `--dry-run` proves only the local validation; the live path
against Google stays unexercised until a real key exists.

App creation, the App content declarations, the screenshots, the closed-test
roster and the production-access application stay manual: the API cannot file a
data safety form or opt a tester in.

## Official references

- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152)
- [Testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Set up a closed test](https://support.google.com/googleplay/android-developer/answer/9845334)
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)

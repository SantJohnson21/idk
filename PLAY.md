# Publishing REWIND BOWL '87 on Google Play

**Status:** the signed Play bundle is built and validated. The remaining steps are
in the Play Console under your Google account — this workspace cannot sign in,
accept the Developer Distribution Agreement, or upload on your behalf.

## The upload package

| Item | Value |
| --- | --- |
| Package name | `com.rewindbowl.game` |
| Version | `1.0.0` (versionCode `1`) |
| Target / compile SDK | **36** (Android 16) |
| Minimum SDK | 22 |
| AAB | [`store/rewind-bowl-1.0.0-v1.aab`](store/rewind-bowl-1.0.0-v1.aab) |
| Size | 3,430,033 bytes (3.43 MB) |
| SHA-256 | `41a73d0ec07c44e79a715174c8cae141a08fc47593503528c054cb6935cba48e` |
| Upload key | `android/rewind-bowl-upload.jks` (gitignored) |
| Key config | `android/keystore.properties` (gitignored) |
| Listing copy | [`store/listing.md`](store/listing.md) |
| Declarations | [`store/data-safety.md`](store/data-safety.md) |
| Policy text | [`store/privacy-policy.md`](store/privacy-policy.md) |
| Graphics | [`store/README.md`](store/README.md) |

Play requires new apps and updates to target API 36 as of 31 August 2026. The
project was on 34; `android/variables.gradle`, AGP and the Gradle wrapper are now
on 36 / 8.10.1 / 8.11.1.

The AAB is signed with an upload key generated in this workspace. **Back up
`android/rewind-bowl-upload.jks` and `android/keystore.properties` now.** They are
gitignored and are not in the repository. If the upload key is lost, Play Console
offers an upload-key reset, but keeping the pair avoids the wait. The distribution
key itself is held by Play App Signing, not in this repo.

## Only you can do these

1. **Create or open the developer account** at
   <https://play.google.com/console>. There is a one-time US$25 registration fee
   and identity verification. If the account is a **personal** account created
   after 13 November 2023, Play requires a closed test with **at least 12 opted-in
   testers for 14 continuous days** before you can apply for production access.
   Organisation accounts are exempt; the Console tells you which rule applies.
2. **Publish the privacy policy** at a public URL. The page is ready at
   [`docs/privacy.html`](docs/privacy.html), with the developer contact set to
   `tronjohnson57@gmail.com`. [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
   publishes `docs/` to GitHub Pages on every push to `main`. To turn it on once:
   push this repository, open **Settings → Pages → Build and deployment**, and set
   **Source** to **GitHub Actions**; then run the workflow (or push a change under
   `docs/`). Once deployed, the URL is
   `https://santjohnson21.github.io/idk/privacy.html`.
   If the repository is private, Pages for a private repository needs a plan that
   includes it (Pro, Team or Enterprise); otherwise make the repository public.
3. **Use the same contact email** in Play Console. It is already set in the listing
   and policy; Play will not accept a placeholder.
4. **Accept the Developer Distribution Agreement** and complete the payments/
   tax profile if the Console asks for it (free apps do not need a merchant
   account, but the developer profile still has to be complete).

## 1. Create the app

Play Console → **All apps → Create app**.

| Field | Value |
| --- | --- |
| App name | `Rewind Bowl '87` |
| Default language | English (United States) |
| App or game | **Game** |
| Free or paid | **Free** |
| Declarations | Tick the Play policy and US export declarations |

The package name becomes permanent on the first upload. It is already
`com.rewindbowl.game`; do not change it.

## 2. Complete App content

Play Console → **Policy → App content**. Work through every card; the answers are
in [`store/data-safety.md`](store/data-safety.md).

| Card | Answer |
| --- | --- |
| Privacy policy | `https://santjohnson21.github.io/idk/privacy.html` |
| App access | All functionality is available without special access |
| Ads | No ads |
| Content rating | Questionnaire: No to every content category; expected Everyone / 3+ |
| Target audience | 13 and over |
| Data safety | No data collected, no data shared |
| Government apps | No |
| Financial features | None |
| Health apps | No |
| News apps | No |
| COVID-19 contact tracing | No |

The game's tape currency is earned by playing. There are no real-money purchases,
subscriptions, loot boxes or ads.

## 3. Store listing

Play Console → **Grow → Store presence → Main store listing**.

- **App name / short description / full description:** copy from
  [`store/listing.md`](store/listing.md).
- **App icon:** `store/icon-512.png`
- **Feature graphic:** `store/feature-graphic-1024x500.png`
- **Phone screenshots:** upload `store/screenshots/phone-01-title.png` through
  `phone-05-ready.png`, then `phone-06-live.png`, in order.
- **Category:** Sports. **Tags:** Football, Sports, Retro, Pixel art, Single
  player, Offline.
- **Contact email:** `tronjohnson57@gmail.com`.

The graphics are generated from the production build by `npm run play:assets`.
`store/assets.json` records their dimensions and SHA-256.

## 4. Closed testing

This is the step that catches most new personal accounts.

1. **Test and release → Testing → Closed testing → Create track.**
2. **Create new release**, upload `store/rewind-bowl-1.0.0-v1.aab`.
3. Accept **Play App Signing** when prompted. The AAB already carries the upload
   signature; Google re-signs the distributed APKs with the app-signing key.
4. Add the release notes from
   [`store/closed-test-invite.md`](store/closed-test-invite.md), save, review and
   **Start rollout to Closed testing**.
5. Open the **Testers** tab → **Create email list** → add at least 12 Google
   accounts (your own plus testers). Save, copy the **opt-in URL**, and send the
   invitation from [`store/closed-test-invite.md`](store/closed-test-invite.md).
   Each tester must open it, accept, and install the build.
6. Keep at least 12 testers opted in for **14 consecutive days**. Removing one
   drops the count; add a spare if you are close to the line.

The first closed release may take Google a few days to review. The 14-day clock is
about testers being opted in, not about you waiting after the review.

## 5. Production

After the closed test qualifies:

1. **Production → Apply for production access** (personal accounts). Answer the
   questions about the test, the feedback and the changes you made.
2. **Production → Create new release.** You can promote the tested bundle or upload
   the same AAB again. Do not change the versionCode for the same build.
3. Choose countries/regions, review the **pre-launch report**, then roll out. A
   staged rollout (for example 20%) is fine for a first release.
4. Google reviews the production release. New apps often take several days.

## 6. After it is live

- Watch **Pre-launch report** and **Android vitals** for crashes and ANRs.
- The game has no server and no analytics, so there is no backend to monitor.
- For the next release, bump `versionCode` (currently `1`) and, if the marketing
  version changes, `version` in `package.json`. Never reuse a versionCode.
- Rebuild with `npm run mobile:aab`, copy the new `.aab` to `store/`, update
  `store/release.json`, and re-run the closed test if Play requires it for that
  release.

## Rebuilding the bundle

Prerequisites: JDK 17 and Android SDK 36 (`ANDROID_HOME` or
`android/local.properties`).

```bash
npm ci
npm run mobile:sync          # web build + cap sync + build record
npm run mobile:aab           # signed AAB
cp android/app/build/outputs/bundle/release/app-release.aab \
   store/rewind-bowl-1.0.0-v1.aab
```

`npm run mobile:aab` uses `android/keystore.properties`. Without it the release
build is unsigned and Play will reject it.

Validate a bundle before upload:

```bash
java -jar bundletool.jar validate --bundle=store/rewind-bowl-1.0.0-v1.aab
jarsigner -verify store/rewind-bowl-1.0.0-v1.aab
```

## What was verified in this workspace

- `npm run mobile:sync` — web bundle built, copied into both shells, build record
  stamped (`399,373 B → 125,179 B` gzip).
- `./gradlew bundleRelease` — **BUILD SUCCESSFUL**, 239 tasks, 1m 35s.
- `jarsigner -verify` — exit 0, `jar verified.`
- `bundletool validate` — exit 0.
- `bundletool build-apks --mode=universal` — exit 0; the generated APK reports
  `versionCode='1'`, `versionName='1.0.0'`, `targetSdkVersion:'36'`,
  `minSdkVersion:'22'`, label `Rewind Bowl '87`.
- `npm run play:assets` — six 1080×1920 phone screenshots, 1024×500 feature
  graphic and 512×512 icon generated from the production UI; every file's
  dimensions and SHA-256 are in `store/assets.json`.
- The landscape browser pass (`.qa/landscape.mjs`) — 24 checks, 0 console errors,
  field 615×386 at 892×412 and 380×334 at 640×360, drive preserved through both
  rotations.

## What is not verified

- **No phone or emulator was attached to this workspace.** The AAB is valid and
  contains the API 36 manifest and the latest web bundle, but it has not been
  installed or launched on hardware. The hardware checklist is
  [DEVICE-CHECK.md](DEVICE-CHECK.md).
- **No Play Console upload has happened.** The app record, testers, declarations
  and rollout require your account.
- The privacy page is prepared and a Pages workflow is in place, but it has not
  been deployed from this workspace. Confirm the URL returns 200 before entering
  it in Play.

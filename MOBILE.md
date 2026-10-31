# Shipping REWIND BOWL '87 as an app

The game is a Vite bundle wrapped in [Capacitor 6](https://capacitorjs.com). One
web build (`dist/`) is copied into `android/` and `ios/`, so the browser version,
the preview panel and the store builds are the same code.

```
src/            the game (unchanged by the native shell)
capacitor.config.ts   app id, splash, status bar, web dir
android/        Gradle project, signing config, R8 rules, launcher icons
ios/            Xcode project, Info.plist, privacy manifest, export options
resources/      icon + splash masters used to generate both platforms
scripts/make-assets.mjs  draws the icon/splash artwork
scripts/release-record.mjs  stamps the generated build record in this file
```

## What the shell adds

| Piece | Behaviour |
| --- | --- |
| Splash screen | Held until React paints the title card, then fades in 220 ms. |
| Status bar | Transparent overlay; the game pads itself with `env(safe-area-inset-*)`. |
| Orientation | Portrait and landscape on both platforms. The game re-frames the field and tape deck in place; rotation never reloads a drive. |
| Haptics | `src/native.ts` maps play events to cues — selection tick for every menu button, tab and list row as well as play cards; light taps for the snap, the throw and the quarterback's take-off; medium for a catch and a tackle; a two-stage burst on a broken tackle; success and error patterns for points and turnovers; a heavy thud on a blocked punt; two-stage heavy rewind — via Taptic Engine impacts and notifications (iOS included), with `navigator.vibrate` patterns as the browser fallback. The full vocabulary and what each cue should feel like on hardware is DEVICE-CHECK.md §B. |
| Back button | Android back steps title ⇄ hub, pauses a live game, and quits from the title screen. |
| Saves | Four `localStorage` slots, each with its own career and an active-slot key. Persists across launches, dies on uninstall. |
| Network | None. The app is fully offline. |

## Prerequisites

- Node 20+ and `npm install`.
- **Android**: JDK 17 and Android Studio with SDK 36 (`ANDROID_HOME` set). Play requires new apps and updates to target API 36 (Android 16) as of 2026-08-31.
- **iOS**: macOS with Xcode 15+, plus `sudo gem install cocoapods` (or `brew install cocoapods`).

Nothing in the repo is machine-specific, so either platform can be built on its own.

## Everyday loop

```bash
npm run mobile:sync      # build the web bundle, copy it in, update plugins
npm run mobile:android   # sync + open Android Studio
npm run mobile:ios       # sync + open Xcode (runs pod install via cap sync)
```

Then hit Run in the IDE. Change any file in `src/`, re-run `npm run mobile:sync`,
and re-run the app — unless you are on live reload, below. Every sync also
refreshes the generated [build record](#build-record) with the bundle's hashes
and gzip sizes.

### On a phone

```bash
npm run mobile:devices       # connected phones / booted simulators
npm run mobile:preflight     # adb check; prints install/launch commands if no phone
npm run mobile:run:android   # sync, build, install, launch (debug build)
npm run mobile:run:ios       # same, through Xcode
npm run mobile:logs          # Android Chromium + Capacitor console
```

For a faster loop, run the dev server and point a debug install at it:

```bash
npm run dev                 # terminal 1
npm run mobile:live:android # terminal 2 — adb reverse + reload on save
```

Live reload needs cleartext http, so it is enabled by a **debug-only manifest
overlay** (`android/app/src/debug/AndroidManifest.xml`). Release builds keep
`android:usesCleartextTraffic="false"`. Ctrl+C restores the normal config.

Then work through **[DEVICE-CHECK.md](DEVICE-CHECK.md)** — the hardware checklist.
It is driven by the in-game **DEVICE CHECK** panel: hold the build stamp on the
title card to see the splash handoff time in milliseconds, haptic counts per
intensity, plugin registration, safe-area insets, and what the last hardware back
press did. `COPY REPORT` puts the snapshot on the clipboard for a ticket.

| Script | Does |
| --- | --- |
| `npm run mobile:devices` | Lists Android devices and iOS simulators/devices. |
| `npm run mobile:preflight` | Checks adb; prints the exact install and launch commands when no phone is attached. |
| `npm run mobile:run:android` | Sync + build + install + launch; add `-- --target <id>` to skip the prompt. |
| `npm run mobile:run:ios` | Same for iOS. |
| `npm run mobile:live:android` | Live reload over `adb reverse` against `npm run dev`. |
| `npm run mobile:live:ios` | Live reload in the simulator. |
| `npm run mobile:logs` | `adb logcat` filtered to the WebView console. |
| `npm run mobile:assets` | Redraw `resources/*` and regenerate every icon/splash size. |
| `npm run mobile:apk` | Debug APK at `android/app/build/outputs/apk/debug/`. |
| `npm run mobile:aab` | Signed Play bundle at `android/app/build/outputs/bundle/release/`. |
| `npm run mobile:ipa` | Archive + export the App Store IPA to `ios/App/build/export/`. |
| `npm run release:record` | Stamp [Build record](#build-record) from `dist/`; add `-- --artifact <path> --label <text>` to include a native build. |
| `npm run release:record:check` | Fail if the stamped record no longer matches `dist/`. |

The web scripts (`dev`, `build`, `test`) are unchanged.

## Versioning

`versionName` on Android and `MARKETING_VERSION` on iOS both read `1.0.0` from
`package.json`… almost: Android reads it at build time, so **iOS needs the value
edited by hand in Xcode → App target → General → Version** (`MARKETING_VERSION`
in `project.pbxproj`). Keep the two in step.

Build numbers are separate and must increase with every upload:

- Android: `versionCode 1` in `android/app/build.gradle` — edit it, or pass
  `./gradlew bundleRelease -PversionCode=7`.
- iOS: `CURRENT_PROJECT_VERSION = 1` in `project.pbxproj`, or set it in Xcode.

## Android release signing

1. Create the upload key (back it up; losing it locks the listing's updates):

   ```bash
   keytool -genkeypair -v \
     -keystore android/rewind-bowl-upload.jks \
     -alias rewind-bowl -keyalg RSA -keysize 4096 -validity 10000
   ```

2. `cp android/keystore.properties.example android/keystore.properties` and fill
   in `storeFile` (relative to `android/`), `storePassword`, `keyAlias`,
   `keyPassword`.

3. `npm run mobile:aab`.

`android/keystore.properties`, `*.jks` and `*.keystore` are gitignored. Without
the properties file, `assembleRelease` still runs but produces an **unsigned**
artifact that Play will reject — the Gradle script only attaches a signing config
when `keystore.properties` exists.

Release builds run R8 (`minifyEnabled true`, `shrinkResources true`) with keep
rules for the Capacitor bridge in `android/app/proguard-rules.pro`. Language and
density splits are disabled in the bundle so the single AAB behaves like the APK.

## iOS archive

1. Open `ios/App/App.xcworkspace`.
2. App target → Signing & Capabilities → pick your team (bundle id
   `com.rewindbowl.game`; change it in `capacitor.config.ts` **and** Xcode if the
   identifier is taken).
3. `npm run mobile:ipa`, or Product → Archive → Distribute App.

`ios/ExportOptions.plist` drives `-exportArchive`. Replace `YOUR_TEAM_ID` with
your 10-character team id, or delete that key if a matching profile is already
installed.

## Orientation

Both shells allow portrait and landscape. Portrait is the one-thumb frame;
turning the phone puts the field on the left of the screen and the tape deck
beside it, with the camera widened to show most of the field's width and about
twice the downfield stretch. The rotation is handled in place — `configChanges`
on Android, the plist masks and `supportedInterfaceOrientationsFor` on iOS — so
a live drive keeps its clock, score and down instead of restarting. The manifest
uses `fullUser`, which still respects a player's system rotation lock.

Included and required for submission:

- `ios/App/App/PrivacyInfo.xcprivacy` — no tracking, no collected data,
  `UserDefaults` and file-timestamp API reasons declared.
- `ITSAppUsesNonExemptEncryption = false` — the game ships no cryptography.
- Portrait and landscape orientations — the field re-frames itself, and rotation
  never reloads the game — dark interface style, hidden status bar.
- 1024 px opaque app icon, generated splash art.

## Store checklist

**Play Console**
- Target API 36 (`compileSdk`/`targetSdk` in `android/variables.gradle`), version 1.0.0 / code 1.
- App content → Data safety: no data collected, no data shared (nothing leaves
  the device; there are no analytics or ad SDKs).
- Ads: no. Target audience: 13+. Content rating: fill the questionnaire.
- After `npm run mobile:aab`, upload the signed `.aab` from `store/`, review the pre-launch report, then roll out.
- Keep the upload key (`android/rewind-bowl-upload.jks`) and its `keystore.properties`
  safe; Play App Signing will hold the distribution key. Losing the upload key is
  recoverable through a Play upload-key reset, but a backup saves the wait.
- New personal developer accounts must run a closed test with at least 12 opted-in
  testers for 14 continuous days before production access. The full click path,
  listing copy and declaration answers are in
  [store/PLAY_CONSOLE_RUNBOOK.md](store/PLAY_CONSOLE_RUNBOOK.md);
  [PLAY.md](PLAY.md) is the earlier manual pass.

**App Store Connect**
- Create the app record with bundle id `com.rewindbowl.game`.
- Screenshots: 6.7" and 6.5" iPhone (portrait, plus landscape if you show the
  wide frame), plus iPad if you keep iPad support (`TARGETED_DEVICE_FAMILY =
  "1,2"`; set it to `1` to ship iPhone-only).
- Age rating 4+, "no" to encryption, no in-app purchases or accounts.
- `npm run mobile:ipa`, then upload with Transporter or Xcode Organizer.

**Both**
- Saves are local only: reinstalling wipes a career. Say so in the listing.
- The game is a single static build; no server, no login, no third-party SDKs.

## Artwork

The launcher icon and splash screens are drawn from inline SVG, not binary art:

```bash
npm run mobile:assets
```

This rewrites `resources/icon.png`, `icon-foreground.png`,
`icon-background.png`, `splash.png`, `splash-dark.png` and then regenerates every
Android mipmap/drawable and the iOS asset catalog entries. Edit the SVG in
`scripts/make-assets.mjs` and rerun to change the branding.

## Identity to change before publishing

| Value | Where |
| --- | --- |
| `com.rewindbowl.game` | `capacitor.config.ts`, `android/app/build.gradle` (`namespace` + `applicationId`), Xcode target bundle id |
| Display name | `android/app/src/main/res/values/strings.xml`, `ios/App/App/Info.plist`, `capacitor.config.ts` |
| Version / build numbers | `package.json`, `android/app/build.gradle`, `ios/App/App.xcodeproj/project.pbxproj` |
| Team id | `ios/ExportOptions.plist`, Xcode signing |

## Hardware checklist

[DEVICE-CHECK.md](DEVICE-CHECK.md) is the device pass: install routes, how to read
the DEVICE CHECK panel, and pass/fail tables for splash, safe area, haptics (light
/ medium / heavy, setting off, silent switch, low power mode), the Android back
button (title, hub, modals, in-game pause, offseason, gesture navigation),
saves across backgrounding and upgrades, audio, small-screen layout, and a
release-build sanity pass. Fill in §4 and keep it with the build.

## Build record

Traceability for the current web payload and native shells. Do not hand-edit
between the markers: `npm run release:record` rewrites that block from the files
on disk. `npm run mobile:sync` does it after `cap sync`, and the APK, AAB and IPA
scripts stamp the same record with their native artifact.

The table lists every file in `dist/`, its raw and gzip sizes (zlib default,
matching Vite's `gzip:` figures; 1 kB = 1000 bytes), and its SHA-256. Fonts are
already compressed, so their gzip cell says so rather than reporting a larger
number. The version comes from `package.json`. `npm run release:record:check`
fails when the record no longer matches `dist/`.

<!-- release-record:start -->
### 2026-10-31 · 1.0.0

| Artifact | Raw | Gzip (text) | SHA-256 |
| --- | ---: | ---: | --- |
| `dist/assets/index-D6uxrjkH.js` | 364,296 B | 118,215 B · 118.22 kB | `e2ca653896ce2dffd0390897c28e81f128b3c19bcbd82d2a086d206443163d6f` |
| `dist/assets/web-DDDY5alv.js` | 674 B | 332 B · 0.33 kB | `9cd0587524db7da521fc9e2e28c4b6ff360e87ea882bf1e9119385744ef32f9b` |
| `dist/assets/web-DWWEbyGI.js` | 119 B | 125 B · 0.13 kB | `089279a40560f22753fcd2d50229f1d1989fd77f3efaef1d7ba291a721526b2f` |
| `dist/assets/web-Naj4gFKW.js` | 896 B | 454 B · 0.45 kB | `8b738b4df2e9471492a1a7d5321e29c349fe21158ac76f589d7bbf98b586e805` |
| `dist/assets/index-Cwx5ExvI.css` | 50,249 B | 10,945 B · 10.95 kB | `69cbdc9e829032df4c99e233a9dd8e4baef52d000e541d825dbacdfe567b063f` |
| `dist/index.html` | 905 B | 498 B · 0.50 kB | `5fafe53086986fe587bef22519e162ee99ea20f9b66f48345a7bf9a60eb297a7` |
| `dist/fonts/press-start-2p.woff2` | 12,512 B | _already compressed_ | `afec86997fdaf54af1f59358fa2c1e2a0f1d04146edad18e5cd141d0384a7548` |
| `dist/fonts/silkscreen-400.woff2` | 8,404 B | _already compressed_ | `e6c72ea4702249202bcdd79d3343057e4e25ef1f04e3fcffd8602ab53b40b4cc` |
| `dist/fonts/silkscreen-700.woff2` | 7,524 B | _already compressed_ | `5741b7f01a127f40ed70281fa2f686e8fc2cfe241930a120e4d1a1cebe78f995` |
| `dist/favicon.svg` | 799 B | 283 B · 0.28 kB | `6e4259fa462c07ccd9e6be8b1a3741682374a4da374c7b1da23288a70cf7b21b` |

**JS/CSS/HTML payload:** 417,139 B raw → 130,569 B gzip (130.57 kB).
**All shipped files:** 446,378 B raw; 130,852 B with the text files above gzipped (fonts are served as-is).
**Native shells:** `android/app/src/main/assets/public/assets/index-D6uxrjkH.js` missing; `ios/App/App/public/assets/index-D6uxrjkH.js` missing — `e2ca6538…63d6f` in `dist`.
_No native artifact was stamped for this web-only record._
<!-- release-record:end -->

## What was verified here

Verified in this workspace:

- `npm run build` (typecheck + bundle) passes and produced the payload above.
- `npx cap sync` copies that payload into both shells and registers all four
  plugins; `capacitor.config.json` and `capacitor.plugins.json` contain the
  expected app id, splash and status-bar settings.
- `./gradlew bundleRelease` succeeds with JDK 17 and Android SDK 36 (AGP 8.10.1,
  Gradle 8.11.1); the AAB is signed, targets API 36 and contains the same JS hash
  as `dist`.
- `jarsigner -verify` exits 0 (`jar verified.`); `unzip -t` exits 0;
  `bundletool validate` exits 0, and `bundletool build-apks --mode=universal`
  exits 0. The bundle manifest reports `versionCode 1`, `versionName 1.0.0`,
  `targetSdkVersion 36`, `minSdkVersion 22`.
- `npm run play:assets` produces six 1080×1920 phone screenshots, a 1024×500
  feature graphic and a 512×512 icon from the production UI; `store/assets.json`
  records their dimensions and SHA-256.
- `store/rewind-bowl-1.0.0-v1.aab` is a byte-for-byte copy of the signed release
  bundle (`3747fa0d…ccc51a`, 3,434,252 B); its embedded JS and CSS match
  `dist/` by SHA-256.
- The generated resolutions exist for both platforms (136 Android assets,
  13 iOS assets), and the Gradle/Xcode configuration files parse as written.
- The browser build still runs with the native bridge imported (it no-ops on web).
- The DEVICE CHECK panel builds and reports browser-mode values (splash `N/A`,
  `SHELL BROWSER`); the debug cleartext overlay and `scripts/devices.mjs` parse
  and run on a machine without a device.
- The landscape pass (`.qa/landscape.mjs`) is 24 checks, 0 console issues, and
  keeps the live drive through portrait → landscape → portrait and a 640×360
  small-phone rotation.

Still to do on hardware: install and launch the AAB (`adb devices` had no
attached phone or emulator in this workspace), run the
[D1a backgrounding check](DEVICE-CHECK.md#L204), and confirm splash, haptics,
safe-area layout and Android back behaviour. The iOS archive also remains.
DEVICE-CHECK.md is the script for that pass.

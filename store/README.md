# Play Store upload package

Everything here is generated from the production bundle in `dist/` and the 1024 px
art master in `resources/`. Regenerate the graphics with:

```bash
npm run build
npm run preview -- --port 4173 --strictPort   # another shell
npm run play:assets
```

`assets.json` records each file's dimensions, byte size and SHA-256, so an upload
can be matched to a build.

| File | Play Console field | Requirement |
| --- | --- | --- |
| `icon-512.png` | App icon | 512×512, 32-bit PNG |
| `feature-graphic-1024x500.png` | Feature graphic | 1024×500, no alpha |
| `screenshots/phone-01-title.png` | Phone screenshot 1 | 1080×1920 |
| `screenshots/phone-02-clubs.png` | Phone screenshot 2 | 1080×1920 |
| `screenshots/phone-03-hub.png` | Phone screenshot 3 | 1080×1920 |
| `screenshots/phone-04-market.png` | Phone screenshot 4 | 1080×1920 |
| `screenshots/phone-05-ready.png` | Phone screenshot 5 | 1080×1920 |
| `screenshots/phone-06-live.png` | Phone screenshot 6 | 1080×1920 |
| `source/landscape-gameplay.png` | Full landscape frame (reference) | not uploaded |
| `source/landscape-field.png` | Field-only source for the feature graphic | not uploaded |

The signed App Bundle is copied here as `rewind-bowl-1.0.0-v1.aab` after a build.
Do not edit it; rebuild with `npm run mobile:aab` (or `./gradlew bundleRelease`)
and re-copy.

Copy lives in [`listing.md`](listing.md), declarations in
[`data-safety.md`](data-safety.md), and the policy in
[`privacy-policy.md`](privacy-policy.md); the public HTML page is
[`../docs/privacy.html`](../docs/privacy.html). The click-by-click console
sequence is in [`../PLAY.md`](../PLAY.md).

# Play Console declarations

Answer these in **Policy → App content**. They match the shipped `1.0.0 (1)`
build: no network calls, no analytics, no ad SDK, no account, no purchases.

Verified on 2026-10-29 against the release merged manifest, `package-lock.json`
and `src/`: the merged manifest declares `INTERNET`, `VIBRATE` and the app-defined
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; it has no `AD_ID`, location, camera,
microphone, contacts, storage or notification permission. `package-lock.json`
and the app source contain no ads/analytics SDK and no `fetch`, `XMLHttpRequest`,
`WebSocket`, `sendBeacon` or `axios` calls. The only persistence is the local
`localStorage` career save. `INTERNET` is the Capacitor WebView default; no app
code makes an external request, so it does not change the Data safety answer.

## Data safety

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | **N/A** — nothing is transmitted |
| Do you provide a way for users to request that their data be deleted? | **No** — no data is collected. Local save data is removed by clearing app storage or uninstalling |
| Does your app use cookies or similar tracking? | **No** |
| Does your app share data with third parties? | **No** |
| Does your app use advertising or analytics SDKs? | **No** |

Why: the game is a static web bundle in a WebView. The career is a single
`localStorage` key on the device. There are no network requests after the bundle
loads, no accounts, no crash reporter, no attribution SDK and no ads.

## Ads

**No ads.** Do not select "Contains ads".

## App access

**All functionality is available without special access.** There is no login,
subscription, invite or region lock.

## Content rating questionnaire

Answer **No** to every content category:

- Violence, blood, gore, or weapons: no
- Sexuality or nudity: no
- Profanity or crude humour: no
- Controlled substances: no
- Gambling, simulated gambling or loot boxes: no
- User-generated content, chat, or user-to-user interaction: no
- Location sharing: no
- Purchases or real-money trading: no
- Ads: no
- Privacy policy: `https://santjohnson21.github.io/idk/privacy.html` — must return HTTP 200 before submission; the 2026-10-29 live check is still 404

The expected outcome is **Everyone / 3+**. The game is football; tackles are
abstract pixel collisions and there is no injury depiction.

## Target audience

**13 and over.** This is the simplest declaration for a sports game with no
child-directed features. It avoids the Families policy requirements, which would
add design, ads and data rules that the game does not need.

Do **not** select an age band under 13 unless you intend to comply with the
Families policy.

## Other declarations

| Section | Answer |
| --- | --- |
| Government app | No |
| Financial features | None |
| Health apps | No |
| News app | No |
| COVID-19 contact tracing | No |
| Data deletion request URL | Not applicable — no data collected |
| Play App Signing | Yes — use it (recommended) |
| US export compliance | The app uses only standard HTTPS/WebView APIs and no cryptography; answer the questionnaire accordingly |

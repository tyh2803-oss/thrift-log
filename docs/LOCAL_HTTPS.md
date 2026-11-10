# Private Wi-Fi HTTPS testing

Open **https://192.168.18.125:3000/login** on the iPhone after installing the local CA below. The Mac must stay running on the same Wi-Fi. This is a local Next.js development server, with no public tunnel, repository push or hosting deployment.

## One-time iPhone setup

1. On the Mac, AirDrop `~/Downloads/Thrift-Log-Local-CA.cer` to your own iPhone. This is the **public root certificate**, not a private key.
2. Install the downloaded certificate profile in iPhone Settings. It may appear as **Profile Downloaded**, or under **General → VPN & Device Management**. Identify the mkcert development CA you just received.
3. Enable its SSL trust under **Settings → General → About → Certificate Trust Settings → Enable full trust for root certificates**. Installing the profile alone does not enable SSL trust. See [Apple's instructions](https://support.apple.com/en-us/102390).
4. Open the HTTPS URL above and sign in again. Do not proceed past a certificate warning; verify that the correct CA profile is installed and trusted instead.

CA SHA-256 fingerprint: `E1:52:F9:8E:A3:38:C8:18:83:C3:3E:9A:FC:1B:05:52:39:0A:5F:CC:17:32:14:F6:50:A2:6F:A1:D9:A2:D4:64`.

The certificate and keys live outside the repository at `~/Library/Application Support/Thrift Log HTTPS/`. Both private keys have mode 0600 inside an owner-only directory. Never transfer `rootCA-key.pem` or `lan-key.pem` to another device. No Mac system/keychain trust settings were changed. Remove the CA profile from the iPhone when you no longer need local testing.

## Starting again

The HTTPS server is already running for this session. To restart it later, stop any other Next.js dev process for this checkout, then run:

```bash
npm run dev:https
```

For a new setup, install the official Homebrew `mkcert` package, then generate certificates:

```bash
brew install mkcert
npm run https:setup -- 192.168.18.125
npm run dev:https
```

The helper uses Next.js's native `--experimental-https` key/certificate options. It does not disable certificate validation or install a CA into the Mac's trust store. If the Mac's Wi-Fi IP changes, rerun setup for the new private IPv4 address and update the exact host in `allowedDevOrigins` in `next.config.ts`. The same CA is reused, but the server certificate needs the new IP in its SAN. The startup helper checks that the configured IP is still assigned to the Mac.

For normal Mac Safari/Chrome use over this HTTPS address, the Mac also needs to trust this CA. This was intentionally not changed automatically. If desired, install it yourself using `CAROOT="$HOME/Library/Application Support/Thrift Log HTTPS/ca" mkcert -install` and review the local OS prompts. Automated verification below uses isolated certificate trust instead.

HTTPS has a different browser-storage origin from HTTP. Sign in over HTTPS to obtain Secure cookies; saved private records remain in Supabase. Old HTTP demo storage and unsaved tab drafts are not automatically migrated.

## Why HTTP failed

A private-IP HTTP origin is not a secure context. Inspection of the actual HTTP page confirmed `isSecureContext=false`, no `crypto.randomUUID`, and no `crypto.subtle.digest`. Localhost can work over HTTP because browsers treat loopback as potentially trustworthy; that exception does not extend to the Mac's LAN address on an iPhone.

The editor, timer, CSV imports, inventory duplication, fulfillment/ledger dialogs and assistant drafts create IDs with native `crypto.randomUUID`. Screenshot attachments use native SHA-256 through Web Crypto. Those calls are unchanged. There are no Math.random identifiers, weak hashes, or insecure-origin browser flags.

A workspace-level support check now shows HTTPS/update guidance before these components mount when required browser security APIs are missing. It prevents the original unhandled crashes without bypassing the browser's restrictions.

## Secure-context API audit

| API in this application | Usage and handling |
| --- | --- |
| `crypto.randomUUID` | Required for record/draft identifiers; secure connection and native API availability checked before mounting the workspace. |
| `crypto.subtle.digest` | Required for screenshot SHA-256; same support check, no fallback hash. |
| Service workers | PWA/offline public assets; existing feature detection and caught registration failures. HTTPS and trusted certificates are required. |
| `navigator.locks` | Optional demo-tab serialization; existing availability check remains. Private writes use server transactions/revisions. |
| Geolocation | Optional foreground nearby locations; HTTPS and explicit location permission are required. Existing denial handling remains; no location was requested in this verification. |
| File input, File/Blob, image/canvas compression, drag/drop and paste events | Not the restricted async Clipboard or live camera/microphone APIs. Screenshot hashing still requires HTTPS. |

No async Clipboard, live camera/microphone, notification-permission, voice or background-location API was found in the implemented flows. The notification bell is in-app UI. Server-side Node cryptography is unaffected by browser secure-context restrictions.

## Verification

`HOSTED_CHROMIUM_EXECUTABLE=/path/to/chrome node --env-file=.env.local --experimental-strip-types scripts/verify-https.mjs` is an opt-in test with a **real billable OpenAI request**. It uses a disposable Supabase account and an isolated HTTPS fixture server on port 3156; it never changes the normal owner's credentials or business records. Run it after a production build while no other production process is serving stale build files.

The test validates the TLS chain and IP SAN against the generated CA with certificate validation enabled. Its isolated Chromium profile trusts only the generated leaf key via an SPKI pin; Node's API client adds the local CA through `NODE_EXTRA_CA_CERTS` in the test process. `ignoreHTTPSErrors` remains false; there is no global certificate-error bypass, insecure-origin exception or Mac trust-store change.

Actually verified: native UUID and SHA-256 test vector on HTTPS; real Secure/HttpOnly/SameSite=Lax host-scoped Auth cookies; UI inventory and timer creation; Supabase persistence after reload; multiple image attachments/removal and native hashing; one unmocked OpenAI extraction of a clearly labeled fictional receipt; exact inventory/cost lookup and a $26 profit preview; no business writes or screenshot uploads during preparation; sign-out and complete disposable-data cleanup. No sale was approved.

Desktop/iPhone-sized Chromium regressions pass separately. **No physical iPhone, certificate-profile installation, camera, geolocation, Safari PWA installation or offline-device test has been performed.** See `PROJECT_STATUS.md` for exact checks and continuation state.

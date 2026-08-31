# Wi-Fi File Transfer — version 3.1

[Open the app](https://dng0101.github.io/wifi-file-transfer-web/)

## Send a file

1. Open the website on both devices.
2. Choose **Send Files** on one device and **Receive Files** on the other. Both sides show a QR, scanner, code and link. Either side can scan the other.
3. Connect, then tap the receiver in **Available devices**. The app opens the file channel before showing the file picker.
4. Select files or a folder. The transfer request is sent automatically—there is no separate upload or Send step. The receiver chooses a device folder and accepts.
5. Wait for **Verified complete**. Files are already saved in the chosen device folder; there is no second download step.

After connecting, **Remember device** asks for approval on both devices. On future visits, open the website on both devices and choose Send/Receive: remembered receivers appear without another code. Settings provides rename and forget.

## Large files, including 10 GB

Files are read in 8 MiB blocks and transported in frames of at most 64 KiB (16 KiB fallback when the negotiated maximum is unknown). The receiver writes blocks to persistent storage before acknowledging them. Neither side intentionally loads a complete large file into JavaScript memory. File size counters use safe JavaScript integers, not 32-bit offsets.

New receives require **Choose device folder** in a browser supporting showDirectoryPicker (desktop Chrome/Edge). File payloads and temporary blocks go into that folder, never OPFS or IndexedDB. Only recovery metadata, hashes and permission handles remain in browser storage. Allow roughly twice the file size free during verification; folder free space cannot be measured reliably. Browsers without this API can send but cannot receive in direct-save mode. Existing v3 browser-stored downloads can still be recovered/deleted, but an old browser-storage transfer must be restarted into a device folder. See [browser API restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker) and [test evidence](TEST_REPORT.md).

Each 8 MiB block has SHA-256 verification. Corrupt transport blocks are retried up to three times. Whole-file SHA-256 is computed incrementally in a worker on the sender and checked again from persisted blocks on the receiver. Completion requires the receiver's final acknowledgement.

## Startup and transfer timing

Available devices are checked automatically at startup and refreshed for remembered private pairs; Check again triggers another check. This is not unrestricted LAN scanning and does not prove devices share a Wi-Fi network. Diagnostic events are enabled and shown by default; they can be disabled or collapsed.

Selecting a file reads metadata only, then sends the offer on the already-open channel. File bytes are read in blocks after receiver consent, without pre-uploading or pre-hashing the entire file. Transfer duration still depends on file size, disk speed, network bandwidth, permission prompts and verification. Instant completion is not promised. Idle prepared channels expire after five minutes.

## Pause, interruption, and recovery

Pause stops sending new frames; a block already in flight may finish. Resume continues. Both devices can pause, so both must resume if each paused.

A disconnected transfer preserves verified blocks. Automatic reconnect uses bounded backoff. After those attempts stop, reconnect the receiver and tap Resume. If an invitation expired or the receiver reloaded, create a new invitation and connect the sender to it, then Resume.

After the sender reloads, use **Saved progress → Reselect files & resume** after reconnecting the original receiver. Select the same original files or folder. Names, sizes, modification times, and already acknowledged content are checked. Browser permissions do not allow silently reopening arbitrary source files. On receiver reload, permit the original destination folder when requested. Accepted transfer tokens bind resume requests to saved metadata and application device identities.

Browser storage can be cleared or evicted. Keep original files until delivery is verified. Remove saved data deliberately to free space; already saved destination-folder copies remain. Cancel removes temporary data. History contains metadata, not a substitute for saved files.

## Connection and privacy

GitHub Pages serves static assets only. PeerJS Cloud handles signaling; file bytes use encrypted WebRTC data channels, directly where possible or through a TURN relay where available. Two STUN providers support direct connection setup. PeerJS discontinued its free TURN service; its retired relay endpoints are intentionally removed. Networks requiring a relay need an operator-configured TURN service. See the [PeerJS announcement](https://github.com/orgs/peers/discussions/1172). Pairing needs internet even on the same Wi-Fi.

Invitations use random 12-character codes (~58 bits), expire for new peer connections after ten minutes, and require receiver approval. Six-digit codes were not used: a static public site cannot enforce a global guessing limit. Local connection limits and timeouts reduce resource abuse but are not a service-wide rate limiter.

Discovery is limited to invited peers and explicitly remembered devices. There is no global directory or unrestricted LAN scanning. Device names are self-declared. Local identities are random UUIDs, not fingerprints. Remembered pairs store a random secret locally and use a secret-derived private rendezvous; no account is needed. Compromised site scripts, browser storage, or signaling infrastructure remain trust boundaries. Do not share invitations publicly.

The site does not interoperate with the reference Send Files to TV APK. Both endpoints use this website. See [APK mapping](APK_TO_WEB_MAPPING.md), [architecture](ARCHITECTURE.md), and [browser limits](BROWSER_COMPATIBILITY.md).

## Optional managed relay

Basic static hosting works without an additional backend. Operators may set `turnCredentialsUrl` in `connection-config.json` to their HTTPS credential service. It must return `{iceServers:[{urls:["turns:relay.example:5349"],username:"temporary-user",credential:"temporary-secret"}],expiresAt:unixMilliseconds}`. Credentials must have 1 minute–24 hours remaining; this endpoint is fetched on app startup. Renew before starting new sessions if the page remains open past credential expiry.

The service must issue short-lived credentials, enforce appropriate access/rate limits and CORS, and protect its long-term TURN secret. Never put a private long-term credential in this repository. The pinned PeerJS dependency contains historical public relay defaults, but the app filters these retired endpoints out of the runtime configuration.

## Development

Requires Node.js 20+ and npm. Dependencies are pinned and bundled locally.

```sh
npm ci
npm test
npm run build
npm run dev
node tests/ui-browser.mjs
node tests/browser-integration.mjs
node tests/large-browser.mjs
```

Browser tests require installed Google Chrome and internet access. The large test transfers an actual 10 GiB generated file between two normal Chrome profiles through WebRTC and verifies source/destination hashes. It writes substantial temporary data under ignored `test-results/`; allow at least 40 GB free and sufficient time. Set `TEST_BYTES` for a smaller run. Do not run multiple large tests concurrently against the same test directory.

## GitHub Pages

Publish main, root directory. Commit source, lockfile, `assets/app.js`, and `assets/hash-worker.js` together after building. Relative URLs support repository subpaths. The service worker caches an offline app shell; it does not provide offline signaling. See [deployment](DEPLOYMENT.md).

The original static application remains at `legacy.html` for reference. Version 2's transfer module and regression tests remain during migration; the current interface uses the version 3 block protocol. Reload both devices after upgrading. One active transfer per tab is intentional to prevent conflicting destination writes; a batch can contain up to 200 files.

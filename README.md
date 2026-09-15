# Wi-Fi File Transfer — version 4.12.0

[Open the app](https://dng0101.github.io/wifi-file-transfer-web/)

## Send a file

1. Open the website on both devices. On the first visit, enter a device name in any language. Returning users keep their saved name; change it in Settings.
2. Choose **Transfer** on either device. Both sides can use a QR, scanner, code or link to connect; no Send/Receive mode selection is needed.
3. Connect, then choose **Send** beside the intended peer in **Available devices**. This opens **Choose files and send** for that peer. The app confirms that the other device can answer before showing the file picker. Either device can send and receive simultaneously. Choose Send beside another connected device to send to multiple peers at once. Use each transfer card’s controls to pause, resume or cancel that transfer.
4. Select files or a folder. The transfer request is sent automatically—there is no separate upload or Send step. The receiver accepts; no destination-folder picker is required.
5. Wait for **Verified complete**. Verified files trigger normal browser downloads. If the browser blocks an automatic download, use the visible **Download** link. Your browser controls its Downloads folder, save prompts, and permission for multiple downloads.

After connecting, **Remember device** asks for approval on both devices. On future visits, open the website on both devices and choose Transfer: remembered receivers appear without another code. Settings provides rename and forget.

## Large files, including 10 GB

Files are read in 8 MiB blocks and transported in frames of at most 64 KiB (16 KiB fallback when the negotiated maximum is unknown). The receiver writes blocks to persistent storage before acknowledging them. Neither side intentionally loads a complete large file into JavaScript memory. File size counters use safe JavaScript integers, not 32-bit offsets.

New receives temporarily stage verified blocks in OPFS, then produce a verified file for the browser download manager. Browsers without OPFS use an IndexedDB fallback only for batches up to 256 MiB. Temporary staging and final verification can require roughly twice the batch size in browser storage, plus space for the downloaded copy. Browser quotas and download limits apply; successful receipt does not prove the browser finished saving the download. Existing direct-folder transfers remain recoverable using their original permission handles.

Each 8 MiB block has SHA-256 verification. Corrupt transport blocks are retried up to three times. Whole-file SHA-256 is computed incrementally in a worker on the sender and checked again from persisted blocks on the receiver. Completion requires the receiver's final acknowledgement.

## Startup and transfer timing

Available devices are checked automatically at startup and refreshed for remembered private pairs; Check again triggers another check. This is not unrestricted LAN scanning and does not prove devices share a Wi-Fi network. Diagnostic events are enabled and shown by default; they can be disabled or collapsed.

Selecting a file reads metadata only, then opens a transfer channel to the confirmed device and sends the offer. File bytes are read in blocks after receiver consent, without pre-uploading or pre-hashing the entire file. Transfer duration still depends on file size, disk speed, network bandwidth, permission prompts and verification. Instant completion is not promised.

## Pause, interruption, and recovery

Pause stops sending new frames; a block already in flight may finish. Resume continues. Both devices can pause, so both must resume if each paused.

A disconnected transfer preserves verified blocks. Automatic reconnect uses bounded backoff. After those attempts stop, reconnect the receiver and tap Resume. If an invitation expired or the receiver reloaded, create a new invitation and connect the sender to it, then Resume.

After the sender reloads, use **Saved progress → Reselect files & resume** after reconnecting the original receiver. Select the same original files or folder. Names, sizes, modification times, and already acknowledged content are checked. Browser permissions do not allow silently reopening arbitrary source files. On receiver reload, **Show received files** restores verified download links. Legacy direct-folder transfers may still request their original folder permission. Accepted transfer tokens bind resume requests to saved metadata and application device identities.

Browser storage can be cleared or evicted. Keep original files until delivery is verified. After checking that downloads finished, choose **Downloads saved — clear temporary copies**. This deletes completed receiver staging, verified temporary files, recovery records and active download links. Incomplete transfers are preserved, and downloaded device files are unaffected. You can also remove one saved transfer in Saved progress. The app no longer runs destructive periodic startup cleanup. Remove saved data deliberately to free space; copies already downloaded to your device remain. Cancel removes temporary data. History contains metadata, not a substitute for saved files.

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

The original static application remains at `legacy.html` for reference. Version 2's transfer module and regression tests remain during migration; the current interface uses the version 3 block protocol. Reload both devices after upgrading; version 4.7.0 uses a confirmed connection handshake for online pairing. One active transfer per tab is intentional to prevent conflicting destination writes; the picker accepts large selections without a fixed total-count limit. The app queues protocol batches of at most 200 files (smaller when UTF-8 metadata requires it). Each batch requires receiver acceptance; keep the sender page open for the remaining queue.

### QR connection help (3.2)

Open this site on both devices. Choose Send on one and Receive on the other. Keep one QR visible and scan it with the other device’s in-app scanner; scanning both ways is unnecessary. Allow camera permission and fit the whole QR in view. You can also paste the invitation link or code. If an invitation expired, its creator should choose New invitation. Keep both pages open during pairing.

QR regressions: npm run test:qr exercises actual QR decoding from synthetic camera video and real browser pairing. It does not substitute for physical phone camera tests.

## Optional Online discovery

Discovery starts **Off on every page visit**, including reloads and returning users. Its setting is not persisted or mirrored to other tabs. Turn **Online** on to advertise a small presence record while this page is running and list other active installations. This creates a separate presence-only Peer 2. QR codes, connection codes, transfer approval, direct folder saving, and all file bytes continue through the existing Peer 1 flow.

Presence records live in IndexedDB and synchronize through browser peers every 20 seconds. They contain a persistent installation UUID, display name, current peer IDs, revision, heartbeat sequence, and timestamps. They do not contain files. Records older than five minutes are deleted and rejected if another peer later sends the stale copy.

Online discovery excludes this device's own identity. Tap **Connect** and wait for approval and confirmation on both sides, or use a QR/code invitation. A separate persistent connection carries that confirmation. Either side can then send and receive; each file batch still requires approval. Turning discovery off does not disconnect accepted devices. Closing the connection removes authorization. Online discovery works only while participating pages are running; GitHub Pages does not keep browser peers alive after a browser or device closes. It still relies on PeerJS signaling and WebRTC reachability. A configured TURN service may be needed on restrictive networks.

## International names and display

Names accept Unicode, normalize to NFC, and use automatic text direction for right-to-left scripts. Number formatting follows the browser locale. The interface text is currently English; this release does not add a full translation catalog. Browsers remember names per site/profile; clearing site storage causes the first-visit prompt to return.

## Folders, large selections, and cleanup (4.8.0)

Select a folder to send a single uncompressed ZIP64 download that preserves relative paths and UTF-8 filenames. Archive payloads are read on demand in blocks of at most 8 MiB; the sender does not create a complete temporary ZIP or load the entire folder into memory. ZIP64 supports size fields beyond 4 GiB. Browser file pickers do not expose empty subfolders. Resume an interrupted folder by reselecting the same original folder. Archive entry ordering and timestamps are deterministic.

The code validates a maximum of 1 TiB for each transferred file or generated archive. That is a protocol limit, not a tested browser capacity guarantee. Receiver quota, free device space, download behavior, and keeping both devices awake still constrain actual transfers. The receiver removes temporary block fragments after verification, retaining only the verified temporary download copy until page refresh or manual cleanup. Finish browser downloads before refreshing; the website cannot confirm final download success.

A large plain-file selection becomes a queue. Successful batches advance automatically; a decline or error pauses that peer's remaining batches. Cancelling drops the remaining batches for that outgoing peer; choose new files to send again. Use Continue queue or Clear queued files. Queued source-file selections are held only while the sender page is open.

## Refresh and temporary copies (4.9.0)

Refreshing the page automatically deletes completed receiver temporary copies and their recovery records before connections restart. Incomplete transfers remain resumable, and files already saved in your device Downloads are unaffected. Finish browser downloads before refreshing: the website cannot verify whether a normal download has finished saving. Normal navigation or opening another page does not trigger this refresh cleanup. The manual Downloads saved cleanup button is also available.

The home page has one Transfer entry point. Available devices show a distinct Send action; it checks the selected peer, opens the file-selection section, and sends the attachment to that peer after receiver approval.

## Simultaneous peers and cancellation (4.10.0)

Each connected peer has an independent outgoing queue. Different peers run simultaneously; batches for the same peer run in order. Incoming transfers have separate approval requests, and both sides can send and receive at the same time. Pause, Resume and Cancel controls belong to individual transfer cards.

Cancellation stops work locally immediately and sends a cancellation request over the file channel plus the approved connection (or authenticated remembered/room message path). Confirmation is awaited before closing the local channel. If the peer is unreachable, the interface reports cancellation as local only after 15 seconds. Cancelling does not remove the underlying approved peer connection. New files selected for that peer wait for confirmation or timeout, then start a fresh transfer ID.

Cancellation cleanup waits for outstanding receive, storage-opening, and sender-record operations before removing data. Delayed writes cannot recreate a cancelled record. Late channels for cancelled transfer IDs are rejected for the current page session.

The sender avoids a redundant copy for each network frame and overlaps incremental whole-file hashing with block hashing and transport. Frame-size negotiation, native backpressure, per-block verification, durable acknowledgements, and final SHA-256 verification remain enabled. Actual throughput depends on the network route, storage, CPU and browser; no speed multiplier or physical 1 TiB transfer has been verified.

See [4.10 validation](docs/validation-4.10.md) for the tested scenarios and execution limits.

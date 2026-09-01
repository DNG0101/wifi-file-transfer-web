## Version 4.0 online presence validation

- 52 automated tests pass, including all prior QR/code, consent, block transfer, recovery, direct-folder output, backpressure, integrity, and 10 GB metadata tests.
- Three in-memory Peer 2 nodes converge, propagate name/Peer 1 ID changes, reject malformed/oversized messages, avoid duplicate timers, publish offline, and re-elect a missing rendezvous holder.
- Three isolated Chrome contexts converge through real PeerJS/WebRTC into distinct IndexedDB rows.
- Browser tests verify UUID persistence after reload, presence store indexes, stale resurrection rejection, a returning UUID, one leader for shared-origin tabs, and standby takeover after leader closure.
- The existing UI integration suite still transfers binary and empty files byte-for-byte after QR/code pairing and writes no received payload blocks to IndexedDB.
- Hardware/router limitations remain: the tests cannot prove every NAT path, mobile background timer behavior, camera autofocus, or an unconfigured TURN route.

## Version 3.2 QR pairing fixes

- QR scanning, pasted invites, and shared links use the same validated parser. The directory and index.html forms of the same Pages app are accepted; unrelated origins and paths are rejected.
- Scanning a new invitation supersedes an unfinished local pairing attempt. Stale attempts cannot open a peer after network configuration resolves.
- Self-scans and repeated scans preserve the current room and roles. A disconnected guest can scan again to reconnect.
- Camera requests and video playback are generation-guarded; cancelled or late requests cannot revive scanning or stop a newer session. Frame-read errors release the camera and show recovery guidance.
- Camera frames retain up to 1280px width; generated QRs have a full four-module quiet zone. Invites omit irrelevant query parameters.
- Expired invitations explain how to obtain a fresh QR. Offline creators fail promptly rather than waiting out the join timeout.
- 41 automated tests passed. New QR browser regression uses synthetic camera video containing actual generated QR pixels through the production scanner, with real PeerJS/WebRTC pairing in both directions. It checks repeated/self scans, role selection, opening the file channel, and invitation arrival during startup.
- Physical phone-camera autofocus, permissions, glare, and separate-device/router behavior still require hardware testing. No relay was added; networks blocking direct WebRTC may need a configured TURN service.

# Test report — version 3.1

## Connection-first / direct-save update

- 33 unit/regression tests passed, including the new direct-save policy rejecting OPFS before accepting payload bytes.
- Two independent Chromium contexts passed the full UI suite: startup discovery visible, diagnostics enabled, QR/scanner available in both modes, sender-generated and receiver-generated invitations, mutual remembered-device approval and rediscovery after reload.
- File selection stayed hidden until the sender explicitly selected a receiver and its data channel opened. Selection then sent the offer automatically; in the latest local run, the receiver offer was observed 131 ms after the browser file-selection event. This excludes fixture construction and is not a promise of instant completion on other networks.
- New receiving remained blocked until a destination folder was selected. A 10 MiB + 17 byte binary APK and empty file were saved through the directory-output path, with exact payload bytes, no extra Save/download action, and zero payload records in the IndexedDB blocks store.
- The test substitutes the native folder picker with a real browser FileSystemDirectoryHandle backed by a dedicated OPFS test folder. It exercises directory writes and metadata recovery, but does not automate the native OS picker or claim the test fixture itself is outside OPFS. Production calls showDirectoryPicker; there is no injected test hook or OPFS fallback in the app UI.
- Unsupported direct-folder browsers show an explicit receive limitation, retain sending, and are never silently switched to browser-payload storage.
- Subpath assets/worker, 360 px overflow check, metadata recovery and browser console checks passed.
- The 10 GiB transfer-engine evidence below is from version 3.0. This update preserves its block size, streaming, verification and recovery engine; it was not rerun as a new 10 GiB native-folder UI benchmark.

## Previous version 3.0 large-file validation

Validation performed on Windows with Node 24 and installed Google Chrome. These are actual results, not a certification of every browser/network.

## Automated checks

- 32 unit/regression tests passed: block framing, large counters, SHA checkpoints, binary/empty files, consent, corruption retry, resumed block offsets, pause, quota failure, changed source rejection, native backpressure, expired invitations, room lifecycle, QR roundtrip and prior v2 regressions.
- UI browser suite passed using two independent browser contexts and public PeerJS signaling: invitation auto-join (including hash changes), mutual remembered-device approval, rediscovery after reloading both pages, binary APK + empty file, consent, verified completion, actual browser download, persisted download recovery, 360 px overflow check, repository subpath and no page errors.
- Actual downloaded 10 MiB + 17 byte binary fixture SHA-256: `68080891e86c3d9d7fb1addecd3a087726e8f10cb6673075e115414805d4daec`.
- Recovery browser suite passed: 24 MiB + 117 bytes, close after the first durable 8 MiB block, reload BOTH pages, reselect the original file, reconnect, recover OPFS metadata and send only blocks 1, 2, 3. Block 0 was not resent. Final SHA-256 on both sides: `0b7e0fec23d5c1bf6032c37ae29bc61e8837eec4afc217bace1b34c989d03a9c`.
- Directory-output branch passed with actual browser FileSystemDirectoryHandle APIs backed by OPFS: folder path preserved, existing report.pdf unchanged, output named report (1).pdf, bytes [0,128,255] verified. This does not automate the native OS folder-picker dialog.
- Retained v2 browser regression passed: real WebRTC binary + empty transfer, consent and departure cleanup.
- Build succeeded and diff whitespace checks passed.

## Actual 10 GiB transfer

`node tests/large-browser.mjs` created a 10 GiB file (zero-filled fixture with start/end markers). All bytes traversed a real WebRTC data channel between two separate normal persistent Chrome profiles. The receiver progressively wrote OPFS blocks and reconstructed a disk-backed File. No synthetic progress or size-only pass was used.

| Measurement | Result |
|---|---|
| File size | 10,737,418,240 bytes (10 GiB, larger than decimal 10 GB) |
| Source SHA-256, calculated independently in Node | 2a1e7045060ed14435598a623c3732280efe1935568d8e29059e6556feb48ca0 |
| Receiver SHA-256 from saved blocks during final reconstruction | Same |
| Reconstructed receiver File size | 10,737,418,240 bytes |
| Sender / receiver final state | complete / complete |
| Transfer plus verification duration | 1,553.654 seconds (~25.9 minutes), excluding source generation/hash |
| Largest sampled per-page usedJSHeapSize | 77,730,983 bytes (~74.1 MiB) |
| Largest sampled native bufferedAmount | 1,108,896 bytes (~1.06 MiB) |

Heap and buffer measurements were sampled every ten seconds. They are not exact transient peaks and exclude worker heaps, native browser allocations and OS filesystem cache. The test demonstrates bounded application buffering and observed page heap; it does not claim total browser RAM stayed below 75 MiB. The receiver's final hash was computed while reading persisted blocks and writing the final file, followed by writer close and receipt. The produced File's full size was checked.

An initial **incognito** run ran out of browser quota around 1 GiB. The receiver propagated the storage-full error; neither side claimed completion. This is why the UI checks capacity and recommends a selected folder for 10 GB.

## Network limitation discovered

A relay-only test using the dependency's historical public TURN endpoints failed to establish the peer connection. PeerJS [officially discontinued its free TURN service](https://github.com/orgs/peers/discussions/1172). The final runtime removes those retired endpoints, retains two STUN providers, and supports an optional HTTPS service issuing short-lived managed TURN credentials. A working managed relay was not available for validation here.

The successful browser transfers were on one physical machine, using separate browser contexts/profiles and real WebRTC/PeerJS signaling. They do not establish performance on two physical Wi-Fi devices or across mobile carriers.

## Not claimed as tested

Physical Android/iOS/Safari/Firefox; camera hardware permission/scanning on a phone (QR encode/decode was tested); real packet loss/latency shaping; changing Wi-Fi/mobile networks; operating-system sleep; a working managed TURN service; 10 GB through every browser's native Downloads UI; malicious signaling server resistance; total process RSS/worker-memory profiling.

## Reproduce

```sh
npm ci
npm test
npm run build
node tests/ui-browser.mjs
node tests/recovery-browser.mjs
node tests/browser-integration.mjs
node tests/large-browser.mjs
```

Browser tests require installed Chrome and internet. Large-test artifacts are ignored under test-results/. Allow at least 40 GB free; never run concurrent large tests against that shared fixture path. TEST_BYTES selects a smaller size. RELAY_ONLY=1 forces relay-only ICE for the network suite and is expected to fail until a working relay is supplied to its test configuration.


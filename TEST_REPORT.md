# Test report — version 3

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

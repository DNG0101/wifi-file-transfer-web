# Architecture — version 3

```text
GitHub Pages → HTML/CSS + local JavaScript bundles
                          │
              PeerJS Cloud signaling
                   ┌──────┴──────┐
                 Sender      Receiver
                   └── WebRTC ──┘
                direct or encrypted TURN relay

File selection → consent manifest → 8 MiB logical block
 → SHA-256 → small binary frames → native backpressure
 → receiver block hash → persistent write → durable metadata → ACK
 → sender hash checkpoint → next block
 → final receiver reconstruction and SHA-256 → file receipt → transfer receipt
```

## Modules

- `app.js`: user workflow, explicit consent, progress/history, recovery, wake lock, diagnostic view.
- `room.js`: PeerJS registration, expiring invitation roster, private control messages, reconnect, separate file data channels.
- `devices.js`: random identity/name and mutually approved private remembered pairs (maximum eight).
- `qr.js`: locally bundled QR decoding; camera tracks stop when dismissed or hidden.
- `block-transfer.js`: protocol v3, state machine, bounded buffering, durable block offsets, ACK/NACK, pause, recovery.
- `storage.js`: IndexedDB metadata; destination directory / OPFS / bounded IndexedDB fallback; safe filenames and verification.
- `integrity.js`, `hash-worker.js`: incremental SHA-256 and versioned checkpoints for the pinned noble implementation.
- `network.js`: optional short-lived TURN credential retrieval; redundant public STUN remains; retired PeerJS TURN endpoints are filtered out.
- `transfer.js`: retained v2 compatibility module, regression-tested separately.

## Sessions and trusted devices

A new Receive action creates a private invitation. Twelve random characters are easier to type than a peer ID and provide materially more guessing resistance than six digits. New peer admission expires after ten minutes; current admitted peers can reconnect and finish. Peer IDs are not displayed in the ordinary UI. Roster membership does not prove a physical network location.

Remembering sends a random 256-bit pair secret over an existing encrypted control connection and requires approval on both devices. Each side stores the other random application identity and a friendly name in IndexedDB. The lexicographically smaller identity hosts a private rendezvous whose address is SHA-256 of the secret; the other joins and proves possession through the encrypted join. Each pair is isolated. Forget closes the pair and deletes the local secret. This is bearer-secret pairing, not independently verified device certificates; signaling and application delivery are trusted.

## Transfer protocol

Every message contains a protocol version and UUID transfer ID. Hello includes a random resume token, manifest and both application device IDs. Previously accepted records must match the token, identities and manifest. The UI passes identities from the selected member. Connection context supplies session membership; resume intentionally survives a new invitation session for the same devices.

The 36-byte binary header contains magic, transfer UUID, file index, block index, offset within block and payload length. File size itself is not encoded as a 32-bit integer. Frames are limited to the negotiated SCTP maximum and at most 64 KiB. One 8 MiB block is outstanding, with about 1 MiB native send-buffer threshold. The sender listens for bufferedamountlow at 256 KiB and checks closure/pause while waiting. Processing is serialized and receiver queued bytes are bounded.

The receiver sends a block ACK only after hash validation, storage close/transaction completion and metadata persistence. NACK retries the same block, up to three attempts. Receiver progress reports acknowledged full blocks; final completion additionally requires checking the reconstructed persisted file. Empty files follow the same receipt path.

Hash checkpoints include internal chaining words, safe-integer byte count, partial buffer and version; source re-selection rebuilds and checks the acknowledged prefix. Receiver recovery scans saved blocks and truncates progress at the first missing/corrupt block. Verified blocks may be re-read for integrity without being resent. Metadata grows with block count, not file bytes.

States include connecting, waiting, offered, preparing, transferring, paused, reconnecting, verifying and terminal states. Epoch guards prevent abandoned asynchronous connections from continuing a newer session. Keepalives detect inactive peers; approval/storage operations have longer timeouts. Reconnect attempts are bounded. One active batch per tab avoids shared-writer conflicts.

## Storage and memory

8 MiB part files live in a transfer-specific staging folder, or blocks are blobs in IndexedDB. Directory outputs receive collision-safe names; path traversal is rejected. Reconstruction reads/writes one block at a time and rechecks the whole-file hash. Until commit, roughly twice file size may be needed. Directory staging blocks are removed after verified output; OPFS blocks/output remain for recovery until the user removes saved data.

OPFS File objects back download URLs without an application-created full-file byte array. Without OPFS/directory, final fallback reconstruction is capped at 256 MiB. The browser may impose additional internal download memory/space limits. Directory permissions can require a fresh user gesture after reload. Browser eviction, actual disk failure and system suspension cannot be prevented by the app.

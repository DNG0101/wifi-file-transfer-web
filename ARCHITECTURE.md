# Architecture — version 3.1

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

Either Send or Receive creates a private invitation. Both screens share QR generation and scanning; invitations encode the opposite mode. Startup discovery loads remembered pairs. Choosing a receiver opens a raw file channel before exposing the file picker. Receiver transfer construction waits for the first hello (bounded to five minutes), so an idle file picker does not start the transfer heartbeat. Selection sends the manifest on that prepared channel. Consent remains mandatory. Twelve random characters are easier to type than a peer ID and provide materially more guessing resistance than six digits. New peer admission expires after ten minutes; current admitted peers can reconnect and finish. Peer IDs are not displayed in the ordinary UI. Roster membership does not prove a physical network location.

Remembering sends a random 256-bit pair secret over an existing encrypted control connection and requires approval on both devices. Each side stores the other random application identity and a friendly name in IndexedDB. The lexicographically smaller identity hosts a private rendezvous whose address is SHA-256 of the secret; the other joins and proves possession through the encrypted join. Each pair is isolated. Forget closes the pair and deletes the local secret. This is bearer-secret pairing, not independently verified device certificates; signaling and application delivery are trusted.

## Transfer protocol

Every message contains a protocol version and UUID transfer ID. Hello includes a random resume token, manifest and both application device IDs. Previously accepted records must match the token, identities and manifest. The UI passes identities from the selected member. Connection context supplies session membership; resume intentionally survives a new invitation session for the same devices.

The 36-byte binary header contains magic, transfer UUID, file index, block index, offset within block and payload length. File size itself is not encoded as a 32-bit integer. Frames are limited to the negotiated SCTP maximum and at most 64 KiB. One 8 MiB block is outstanding, with about 1 MiB native send-buffer threshold. The sender listens for bufferedamountlow at 256 KiB and checks closure/pause while waiting. Processing is serialized and receiver queued bytes are bounded.

The receiver sends a block ACK only after hash validation, storage close/transaction completion and metadata persistence. NACK retries the same block, up to three attempts. Receiver progress reports acknowledged full blocks; final completion additionally requires checking the reconstructed persisted file. Empty files follow the same receipt path.

Hash checkpoints include internal chaining words, safe-integer byte count, partial buffer and version; source re-selection rebuilds and checks the acknowledged prefix. Receiver recovery scans saved blocks and truncates progress at the first missing/corrupt block. Verified blocks may be re-read for integrity without being resent. Metadata grows with block count, not file bytes.

States include connecting, waiting, offered, preparing, transferring, paused, reconnecting, verifying and terminal states. Epoch guards prevent abandoned asynchronous connections from continuing a newer session. Keepalives detect inactive peers; approval/storage operations have longer timeouts. Reconnect attempts are bounded. One active batch per tab avoids shared-writer conflicts.

## Storage and memory

New UI receives enforce requireDirectory: 8 MiB part files live in a transfer-specific staging folder under the selected device folder. Browser databases retain recovery metadata and handles, not received payloads. The retained protocol/storage modules can still read historical OPFS/IndexedDB records, but the current UI rejects new or resumed browser-payload receives. Directory outputs receive collision-safe names; path traversal is rejected. Reconstruction reads/writes one block at a time and rechecks the whole-file hash. Until commit, roughly twice file size may be needed. Directory staging blocks are removed after verified output; OPFS blocks/output remain for recovery until the user removes saved data.

OPFS File objects back download URLs without an application-created full-file byte array. The old internal IndexedDB reconstruction path is capped at 256 MiB and retained for historical recovery only; it is not offered for new receives. The browser may impose additional internal download memory/space limits. Directory permissions can require a fresh user gesture after reload. Browser eviction, actual disk failure and system suspension cannot be prevented by the app.

## Optional online-presence layer (version 4.0)

The transfer layer remains Peer 1: Room owns QR/code admission, rosters, trusted-device rooms, and raw file channels. Presence never opens a file channel and an online-list entry does not bypass QR/code consent.

PresencePeerManager owns the optional Peer 2. Each active browser identity maps deterministically to one of four rendezvous slots scoped to this deployed origin/path. A Peer 2 first attempts to hold its slot; if occupied, it uses a unique PeerJS runtime ID and connects to the holder. Slot holders form a bounded mesh by connecting only toward lower-numbered slots. This gives every running node a route into the small distributed registry without an N×N connection graph or a cloud database. A client re-runs slot election after repeated holder failures.

The persistent installation UUID comes from identity(). It reconciles the supported local identity keys by version, update time, and a deterministic tie break, then removes the obsolete candidate list. The UUID survives while site storage remains intact. A Web Lock permits one tab per browser identity to own Peer 2; BroadcastChannel shares the visible user list. Standby tabs retry the lock every five seconds and take over if the leader closes.

PresenceDB uses the separate wft-presence-v1 IndexedDB database and presenceRecords store keyed by UUID, with peerId, status, lastSeen, and updatedAt indexes. It stores records only, never file bytes. Read/compare/write merges occur inside one read-write transaction. A record contains UUID, name, Peer 1 ID, Peer 2 ID, status, version/revision, heartbeat sequence, lastSeen, and updatedAt.

Conflict order is revision, heartbeat sequence, updatedAt, then deterministic content. Merge is idempotent, keeps one row per UUID, strips undeclared properties, caps the table and messages at 256 records, and rejects invalid or over-age records. The 20-second loop updates only heartbeatSeq for an unchanged identity, removes records older than five minutes, and exchanges summaries. Peers request or send only missing/newer rows. Messages have UUID message IDs and a ten-minute deduplication window; records are not blindly gossiped with an unbounded TTL.

Turning Online off sends a newer offline record, stops heartbeat and sync, closes Peer 2 connections, releases tab leadership, and leaves Peer 1 untouched. Abruptly closing a page may prevent that final message; other peers then remove its row after five minutes. A fresh session reuses the UUID and advances the revision, so it can return without an expired copy winning.

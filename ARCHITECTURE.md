# End-to-end architecture and lifecycle

## 1. System architecture and workflow

### Invariants

1. Each installation has one reconciled UUID and one UUID-derived Main Peer 1 ID.
2. Main Peer 1 starts before discovery and carries connection requests, approvals, transfer offers, approvals, frames, acknowledgements, cancellation and recovery.
3. Peer 2 is discovery only. It never carries file data, approvals, secrets or transfer history.
4. Peer 2 stores one bounded presence row per UUID: name, Main Peer 1 ID, runtime Peer 2 ID, status, revision, heartbeat and timestamps.
5. A destination must accept a connection before either peer is connected.
6. Accepted connections are bidirectional; sender and receiver are roles of one transfer.
7. Every transfer requires a separate destination Accept/Reject.
8. No payload is read or sent before transfer acceptance.
9. New receives require a selected device folder. Browser databases retain metadata, never new payloads.
10. ACK means a block was validated and durably written; completion additionally requires the final file hash.

```text
                         PeerJS signaling
                               |
              +----------------+----------------+
              |                                 |
       User A single tab                 User B single tab
       Main Peer 1 (A)                   Main Peer 1 (B)
       Peer 2 client/host                Peer 2 client/host
              |                                 |
              +---- fixed logical Peer 2 -------+
                    presence directory only

       Main Peer 1 (A) <==== WebRTC ====> Main Peer 1 (B)
          connection consent, transfer consent and all file traffic
```

PeerJS permits only one active owner of a peer ID. Therefore one logical fixed Peer 2 requires an elected browser to own the fixed ID while other browsers use unique runtime IDs to connect to it. If the owner leaves, another browser must claim the same fixed ID. Multiple browsers cannot concurrently own one identical PeerJS ID.

Presence is a bounded `Map<UUID, LatestPresenceRecord>`. Identity reconciliation keeps the highest valid local version, newest update time and deterministic tie winner, then removes obsolete candidates. Presence conflict order is revision, heartbeat, updated time and deterministic content. Newer offline rows hide older online rows; expired rows cannot be resurrected. Input is schema/size validated and capped at 256 distinct rows.

Trust boundaries: GitHub Pages distributes static code; PeerJS provides signaling; WebRTC carries application traffic; TURN may relay encrypted packets. A discovery route is not authorization. Remembered-device secrets remain pair-specific and never enter Peer 2.

## 2. Complete phase-by-phase lifecycle

### Startup

1. Reconcile installation UUID and device name.
2. Run bounded cleanup while preserving identity and Online preference.
3. Start Main Peer 1.
4. Only after Main Peer 1 is ready, start Peer 2 when Online is enabled.
5. Publish Main Peer 1 ID and status; load remembered pairs and recovery metadata.
6. Run non-blocking route diagnostics.

Peer 2 must not publish or show Connect when Main Peer 1 is unavailable. Transient failures retry with backoff and must not erase the Online preference.

### Discovery and connection

Peer 2, QR/code and remembered pairs all produce an unconnected candidate containing UUID, name and Main Peer 1 route. Selecting it opens a Main Peer 1 `connection-request`. The destination validates it and displays Accept/Reject. Before acceptance, neither side appears connected and file selection is unavailable. Reject stores nothing. Accept authorizes both directions for that session.

### Transfer offer and consent

Either connected peer selects files. Selection builds bounded metadata only—no upload or whole-file read. The sender creates a transfer UUID/token and sends the manifest over Main Peer 1. The destination sees sender, names and sizes, selects a device folder, then Accepts or Rejects. Reject sends no bytes. Accept prepares directory staging and returns verified resume offsets.

### Streaming

The sender reads one 8 MiB block at a time and emits frames no larger than 64 KiB or the SCTP limit. Native buffered-amount backpressure bounds memory. The receiver bounds queued bytes, reconstructs one block, verifies SHA-256, writes it into directory staging, persists metadata and only then ACKs. Bad blocks receive NACK and retry up to three times. Pause stops new frames; cancel removes partial data; interruption preserves acknowledged offsets. UI updates are throttled and transfer startup is deferred beyond the picker event.

### Verification and commit

The receiver reconstructs output in the selected folder, recalculates the whole-file hash and resolves collision-safe names. It sends `file-complete`, then batch `complete`. Only then may the sender show Verified complete. Staging and terminal metadata are removed; completed device files remain.

### Repeated/reverse/switch/recovery

After a terminal transfer, either accepted peer may initiate another, with new transfer approval. Destination switching is allowed only when no transfer owns a writer. Reload restores UUID, remembered pairs and acknowledged metadata. Sender reselects identical files; receiver regrants the original folder. Online-off publishes a newer offline row and stops Peer 2 without stopping Main Peer 1; abrupt closure is handled by expiry.

## 3. Critical dependencies and bottlenecks

| Dependency | Purpose | Bottleneck and mitigation |
|---|---|---|
| PeerJS signaling | Peer registration | Availability/timeouts; retry and optional self-hosting |
| ICE/STUN/TURN | Network route | Restrictive NAT needs TURN; diagnostics must distinguish routes |
| File System Access API | Direct receive | Unsupported browsers may send but cannot receive |
| IndexedDB | Presence/recovery metadata | Never store new payloads or block offer delivery on irrelevant writes |
| Web Locks/BroadcastChannel | Per-profile ownership | Avoid split Main/Peer 2 ownership across tabs |
| Hash worker | Responsive integrity | Bound messages and fail transfer safely if worker stops |
| Device disk | Staging/output | May need near twice file size; never ACK failed writes |
| Page lifecycle | Long transfers | Wake lock is advisory; resumability is mandatory |

Primary bottlenecks are Peer 2 host failover, TURN absence, folder API support, mobile suspension and competing tabs using a stable Main Peer ID.

## 4. Technical risks and release gates

- Fixed Peer 2 can become a single point of failure: require deterministic election, heartbeat and takeover tests.
- Split tab ownership can advertise unusable Main Peer routes: co-locate Main Peer 1 and Peer 2 ownership.
- Authorization can be confused: connection and transfer consent must remain separate message/state types.
- Stale presence can resurrect: merge monotonically and reject expired rows.
- Page freezes can occur: never buffer whole files, apply backpressure and throttle UI work.
- False completion can occur: ACK after durable write; complete after final hash.
- Browser payload retention violates policy: enforce directory-only receives.
- Cached protocol mismatch can break peers: bump app and service-worker cache versions together.

Release requires: connection accept/reject; transfer accept/reject; A→B and B→A without reconnecting; repeated batches; destination switching; multiple/empty/large files; corruption/NACK; pause/resume; cancellation during writer creation/commit; resume from ACK; remembered reload; QR/code/link; Peer 2 dedupe/offline expiry/owner failover; directory output with zero IndexedDB payload blocks; mobile layout; service-worker subpath loading; and zero page/console errors.

Run build, unit tests, protocol browser integration, full UI flow, large-file, QR, presence, recovery and live two-browser diagnostics. Commit/push `main` only when all pass. Then bump the visible version and cache, deploy, and verify GitHub Pages serves matching HTML, bundle and worker.

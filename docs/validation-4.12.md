# Validation 4.12

## Scope

Version 4.12 adds an optional multi-lane WebRTC fast path for large transfers without adding runtime dependencies. The existing primary PeerJS DataConnection remains the control lane. Files of at least 16 MiB may open two additional independent PeerConnections (three total lanes by default). Binary frames are assigned to the currently least-buffered open lane.

The receiver now accepts non-overlapping frame ranges arriving out of order across those independent SCTP associations. `block-end` may arrive before the final secondary-lane frame; block verification is deferred until every byte in the block has arrived. SHA-256 verification, durable 8 MiB block checkpoints, block ACK/NACK retry, pause/resume, cancellation, and verified-block reconnect behavior remain mandatory.

If a secondary lane fails while a receive block is incomplete, the primary connection is closed deliberately so the existing reconnect logic resumes from the last verified block rather than guessing whether queued secondary-lane bytes arrived. Small transfers stay on one connection to avoid setup overhead.

## Performance work

- Up to 3 independent PeerConnections by default for large files (hard maximum 4).
- Least-buffered-lane scheduling using each lane's negotiated SCTP `maxMessageSize` and adaptive buffer plan.
- Next-block disk read and SHA-256 block digest preparation overlap the current block's network transmission.
- Out-of-order, overlap-protected receiver assembly for striped frames.
- No external service or runtime dependency added.

## Safety expectations

The multi-lane path is an optimization, not a fixed speed multiplier. Multiple connections still share the same physical Wi-Fi/Internet link and may be slower on constrained devices. The code therefore keeps the normal single primary lane, uses only a small bounded lane count, and preserves the previous resumable integrity protocol.

## Automated checks

The release workflow runs `npm ci`, the complete Node test suite, `npm run build`, and `node --check assets/app.js`. New regression tests verify that a large transfer actually uses secondary lanes and that the receiver correctly assembles non-overlapping frames received out of order.

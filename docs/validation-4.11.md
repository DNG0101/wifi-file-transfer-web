# Version 4.11.0 validation

Automated validation ran on GitHub Actions after applying the per-device disconnect and transfer-throughput patch.

## Changes validated

- Explicit disconnect revokes the selected online device on both endpoints without forgetting it permanently.
- Active transfers to a deliberately disconnected device retain verified progress and stop automatic reconnect attempts until the user resumes.
- WebRTC file frames use the negotiated SCTP message size up to a 1 MiB safety cap instead of a fixed 64 KiB cap.
- Data-channel backpressure uses an adaptive 8–32 MiB send window instead of the previous 1 MiB window.
- The next 8 MiB source block is prefetched while the current block is hashed/transferred.
- SHA-256 block verification, final whole-file verification, pause/resume, cancellation, and verified-block reconnect semantics remain enabled.
- No new runtime dependency was added.

## Automated checks

- `npm test` passed.
- `npm run build` passed.
- `node --check assets/app.js` passed.
- Added deterministic tests for explicit disconnect, adaptive transport sizing, deeper backpressure, and reduced frame count when SCTP supports larger messages.

Actual throughput remains bounded by Wi-Fi link quality, browser WebRTC/SCTP implementation, CPU, and storage speed; the optimization removes application-side under-filling but does not promise a fixed speed multiplier on every device.

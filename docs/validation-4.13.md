# v4.13.0 validation

## Performance architecture

- Protocol v5 keeps up to four 8 MiB blocks in flight instead of stop-and-wait per block.
- Block acknowledgements are matched by file/block so out-of-order ACKs cannot complete the wrong request.
- Receiver accepts a bounded six-block horizon and assembles frames with 64 KiB range buckets rather than scanning every prior range.
- Transport plans refresh after SCTP opens, so an early 16 KiB fallback does not permanently cap frame size.
- New OPFS/directory staging uses one packed file per source file with positioned writes; legacy saved transfers retain the old block-file layout.
- Receiver maintains an incremental whole-file SHA-256 checkpoint from verified durable blocks. New packed transfers can verify the final digest without rereading and rehashing the entire file.
- Packed OPFS downloads expose the already-verified staging file instead of rewriting a second complete copy.
- Multi-lane WebRTC, pause/resume, cancellation, per-block SHA-256, NACK retry, reconnect from verified progress, and final whole-file integrity remain enabled.

## Required validation

The release workflow runs `npm ci`, the full Node test suite, `npm run build`, and `node --check assets/app.js`. It also adds a regression proving that multiple blocks are simultaneously in flight and keeps the existing corruption, interruption, pause, quota, multi-lane, and out-of-order tests.

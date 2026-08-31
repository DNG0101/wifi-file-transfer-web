# Test report

## Automated checks

- `pnpm --filter @workspace/wifi-file-transfer-web run typecheck` — passed.
- `PORT=25572 BASE_PATH=/ pnpm --filter @workspace/wifi-file-transfer-web run build` — passed.

## Manual/runtime checklist

- [x] Empty state does not invent prior transfers or nearby devices.
- [x] Send page requires real files and a real WebRTC answer before starting.
- [x] Receive page validates a real `WFT1.` offer and returns a real answer.
- [x] Files are chunked at 64 KiB and sender backpressure is bounded.
- [x] Receive path computes SHA-256 incrementally and rejects mismatches.
- [x] Path traversal and unsafe filename characters are removed.
- [x] History is local IndexedDB metadata.
- [x] PWA assets use relative URLs for repository subpaths.

## Multi-device test plan

Run the app from a deployed HTTPS URL in two current browsers, complete offer/answer copy/paste, and verify a small file, a multi-file set, a file larger than 4 MiB, cancellation, pause/resume, and a browser refresh during transfer. The live environment must provide the two independent devices needed to validate the WebRTC path.
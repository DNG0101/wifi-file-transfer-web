# Feature matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Send one or more local files | Implemented | File picker and drag/drop |
| Receive one or more files | Implemented | Offer review, verified file list, download actions |
| Manual pairing | Implemented | Offer/answer copy/paste |
| QR pairing | Supported as workflow | Codes are compact text and can be rendered by a QR layer; no QR dependency is required for the core app |
| Progress | Implemented | Aggregate and per-file events |
| Pause/resume | Implemented | Cooperative control frame; sender loop pauses between chunks |
| Cancel/disconnect | Implemented | Both peers receive local/remote cancellation state |
| Large-file streaming | Implemented | Slice-based reading, bounded DataChannel buffering, incremental receiver write/hash |
| Integrity check | Implemented | Incremental SHA-256 per file |
| Safe filenames | Implemented | Unicode normalization, path stripping, control and reserved-character replacement |
| Local transfer history | Implemented | IndexedDB metadata only |
| PWA shell | Implemented | Manifest, service worker, subpath-safe links |
| Hotspot creation | Not possible on ordinary web | Explicitly not simulated |
| Automatic LAN device discovery | Not possible portably | Explicitly not simulated |
| Background transfers after tab close | Not guaranteed | Browser lifecycle limitation |
| Native Android receive directory defaults | Not portable | Uses user-selected folder or downloads |
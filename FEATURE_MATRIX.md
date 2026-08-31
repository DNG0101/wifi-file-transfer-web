# Feature matrix — version 3

| Feature | Implementation |
|---|---|
| Simple Send / Receive home | Main journey; technical room fields removed |
| QR, code, invite link | Local generation/decoding, auto join including hash changes, ten-minute expiry |
| Private available receivers | Invited session peers and up to eight mutually remembered devices |
| Rename / forget | Persistent settings; forgetting revokes local pair |
| Files / folders / binary / empty | Up to 200 files, safe relative paths, collision-safe outputs |
| Explicit accept / decline | Required before new file bytes |
| Large file streaming | 8 MiB durable blocks; maximum 64 KiB frames; practical storage limits apply |
| Backpressure | Native bufferedamountlow plus bounded outstanding block |
| Pause / resume | Local and peer pause flags |
| Disconnect / reload recovery | Durable block records, source reselection and destination permission where required |
| Corruption | Block NACK/retry, saved-prefix repair, final whole-file SHA-256 |
| Honest progress / history | Durable bytes, rolling speed, ETA, final verification state |
| Persistent downloads | OPFS or directory; IndexedDB-only fallback capped at 256 MiB |
| Wake lock / camera fallback | Capability detected, permission failure does not block code pairing |
| Offline shell | Cached static UI; pairing still needs internet |
| TURN | Retired PeerJS relay removed; optional HTTPS temporary-credential endpoint |
| APK interoperability / unrestricted LAN scan | Not supported; browser limitations documented |
| Concurrent transfers | One active batch per tab; no automatic multi-peer queue |

# Feature matrix — version 3.1

| Feature | Implementation |
|---|---|
| Simple Send / Receive home | Connect first; picker appears after the file channel opens |
| QR, code, invite link | QR and scanner on both roles; opposite-mode invites; ten-minute expiry |
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
| Persistent downloads | New receives require device folder; old browser-stored downloads remain recoverable |
| Startup discovery / diagnostics | Private remembered peers checked automatically; diagnostics on by default |
| No upload step | Selection sends the offer immediately; bytes begin after consent |
| Wake lock / camera fallback | Capability detected, permission failure does not block code pairing |
| Offline shell | Cached static UI; pairing still needs internet |
| TURN | Retired PeerJS relay removed; optional HTTPS temporary-credential endpoint |
| APK interoperability / unrestricted LAN scan | Not supported; browser limitations documented |
| Concurrent transfers | One active batch per tab; no automatic multi-peer queue |

| Optional online presence | Yes | Separate Peer 2, IndexedDB rows, 20-second heartbeat, four browser-hosted rendezvous slots, Web Locks tab leader |
| Stale presence protection | Yes | Five-minute expiry plus inbound age rejection; returning UUID advances revision |

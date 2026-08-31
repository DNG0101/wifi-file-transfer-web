# Bug tracker

## Known browser constraints

- GitHub Pages cannot create a hotspot or discover native LAN services.
- WebRTC can fail on networks that block UDP, STUN, or direct peer connectivity.
- Closing or suspending a tab interrupts the temporary session.
- Fallback receiving stores the current files as verified Blobs until download; very large files should use a Chromium File System Access directory.
- QR rendering is intentionally optional; the pairing payload can be transferred with copy/paste without adding a third-party service or dependency.

## No known application failures

The static artifact typechecks and produces a production bundle. Cross-device WebRTC validation is environment-dependent and should be performed on an HTTPS deployment with two physical browser peers.
# Wi-Fi File Transfer

Send and receive files from https://dng0101.github.io/wifi-file-transfer-web/.

## Use on two devices

1. Open the website on both devices. Use modern Chrome, Edge, Firefox, or Safari.
2. On one device choose **Create a room**. Share its 12-character code or invite link privately.
3. On the other device enter the code and choose **Join room**, then **Receive**.
4. On the sender choose **Send**, select one or more files, and click the receiver's device name.
5. The receiver reviews filenames and sizes, then chooses **Accept files** or **Decline**.
6. Follow progress in Transfer history. After verification, click **Save** on the receiver, or find the files in the folder selected before acceptance.

Keep both pages awake and the room creator's page open. Each browser can run one transfer at a time. Any file type is supported, including APK, ZIP, video, photos, and empty files. Receiving in memory is limited to 256 MiB including undismissed downloads. Supported Chromium browsers can choose a folder and stream larger files to disk. Actual storage, browser, and network limits still apply. Files are not opened automatically.

## What changed in version 2

The previous site required manually copying WebRTC offer and answer codes and had no browser discovery. Version 2 adds room-based discovery through PeerJS Cloud, explicit receiver consent, an editable source tree, progress/history, cancellation, chunked streaming with backpressure, and SHA-256 verification. The old bundle is retained at `legacy.html` as a troubleshooting fallback, without a guarantee that it works on every network.

## Browser and network boundaries

A normal HTTPS page cannot scan Wi-Fi devices or speak the Android app's native TCP/NSD protocol. The device list means **browsers in the same room**, not proof they are on the same local network. Both endpoints must use this website, not Send Files to TV's Android APK. The reference APK was inspected as an archive, not installed or executed.

Pairing needs internet access to PeerJS Cloud and STUN. File bytes travel over an encrypted direct WebRTC data channel, not through GitHub Pages or PeerJS Cloud. The connection service sees connection metadata and peer IDs. Room members see each other's self-declared device names. Treat room codes/invite links as secrets and verify the sender before accepting.

There is no TURN relay configured. Guest Wi-Fi isolation, VPNs, blocked UDP, or restrictive NAT can prevent connection. Try a normal private Wi-Fi network with client isolation disabled. The app reports failure; it does not pretend all networks work. A managed signaling/TURN service would be needed for broader connectivity and production availability guarantees.

## Develop and test

Requirements: Node.js 20+ and npm.

```sh
npm ci
npm test
npm run build
node tests/browser-integration.mjs
```

The optional browser integration test needs installed Google Chrome and internet access. It runs two independent Chromium pages, connects through the actual PeerJS Cloud service, checks discovery and consent, transfers a 2 MiB binary file plus an empty file byte-for-byte, and verifies departure cleanup. It does not simulate two physical Wi-Fi devices.

`src/app.js` is the interface, `src/room.js` owns room presence and signaling, and `src/transfer.js` implements the transfer protocol. `assets/app.js` is the committed production bundle; `assets/app.css` is the editable stylesheet. Dependencies are bundled locally and pinned by `package-lock.json`.

## GitHub Pages

Publish the repository's `main` branch, root directory. No backend, build action, API key, or paid account is needed. After edits run the tests and build, then commit source plus `assets/app.js`. Do not publish `node_modules`. The relative asset URLs work under the repository subpath. See `DEPLOYMENT.md` and `TEST_REPORT.md`.

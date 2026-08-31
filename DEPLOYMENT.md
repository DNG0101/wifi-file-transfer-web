# GitHub Pages deployment

The root is a complete static site. Use Settings → Pages → Deploy from branch → main → root.

Run `npm ci`, `npm test`, `npm run build` before publishing. Commit editable source, lockfile, `assets/app.js` and `assets/hash-worker.js` together. Do not publish node_modules, test-results, generated large test files or browser test profiles. No private credential is required for default mode.

Expected URL: https://dng0101.github.io/wifi-file-transfer-web/

All app assets use relative URLs, including the integrity worker and configuration. Invitations live in URL fragments. The UI browser suite serves the app under /wifi-file-transfer-web/ and verifies transfer, worker loading and recovery.

The network-first service worker precaches a static shell and deletes only old app cache prefixes. It does not cache cross-origin signaling/TURN responses. Offline shell availability does not mean new peer setup works offline. Reload both devices after upgrading protocols.

Optional managed TURN credentials can be configured through connection-config.json; see README. Protect long-term credentials in the operator backend, never in the static repository.

After release, verify the Pages deployment succeeds and the live HTML, app bundle and worker match the built files. Test on actual target phones, routers and networks before making reliability guarantees.

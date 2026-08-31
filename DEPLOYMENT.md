# Deployment

The root is a complete static GitHub Pages site. In Settings > Pages, select Deploy from a branch, main, / (root), if it is not already selected.

Before publishing: npm ci, npm test, npm run build. Commit the source, lockfile, and assets/app.js together. Keep node_modules and test-results out of Git. No secrets are required. Runtime access to PeerJS Cloud and STUN is required for room pairing.

Expected URL: https://dng0101.github.io/wifi-file-transfer-web/

After GitHub finishes deployment, open the URL on both devices. If an installed app still shows the old version, close and reopen it online, then refresh. The v2 service worker removes the old application cache. All assets are relative to the repository path; there are no client-side deep routes. Invite room codes use a URL fragment and are removed after being read.

Production rollout should include Chrome/Android, Safari/iOS, and two separate physical devices on the intended network. Automated same-machine browser tests do not prove a particular router permits direct WebRTC. TURN and a managed signaling service are future work for networks that block direct connections.

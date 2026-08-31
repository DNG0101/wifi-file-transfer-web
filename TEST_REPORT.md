# Test report — 2026-08-31

Automated protocol tests verify: binary/multiple/empty files; acceptance before bytes; decline; SHA-256 corruption detection; disconnect and partial-writer abort; slow asynchronous disk writes with bounded sending; manifest validation; safe names; avoiding file overwrite. Page checks verify referenced controls and relative assets. npm test passes.

Real-browser integration: two independent Chromium pages used PeerJS Cloud, discovered a receiver in a shared room, waited for explicit acceptance, and transferred binary and empty files over a real WebRTC data channel. Received bytes matched. Receiver departure removed its entry. Command: node tests/browser-integration.mjs. This test requires internet and installed Chrome.

Production bundle builds successfully. npm audit reported zero vulnerabilities at installation.

Not verified: two physical phones/computers on the user's router; Safari/iOS; Android TV browsers; multi-gigabyte disk transfers; internet outages; router client isolation. APK inspected as an archive only, not executed. These results do not claim universal LAN connectivity.

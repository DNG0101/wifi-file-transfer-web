# Browser compatibility — version 3

| Capability | Desktop Chrome / Edge | Android browsers | Firefox / Safari / iOS |
|---|---|---|---|
| WebRTC, QR/link/code | Chromium automated tests | Capability detected; physical testing still needed | Capability detected; physical testing still needed |
| Receive directly into chosen folder | When showDirectoryPicker is available | Usually unavailable | Usually unavailable |
| OPFS persistent streaming | Supported in tested Chrome | Depends on browser/quota | Capability detected, not certified here |
| 10 GB receiving | Prefer a chosen folder and ~20 GB free | No blanket guarantee | No blanket guarantee |
| IndexedDB-only fallback | 256 MiB per batch | Same cap, possibly lower practical limits | Same cap |
| Background reliability | Keep pages awake and visible | OS may suspend | OS may suspend |
| Native LAN / Wi-Fi Direct scan | Not available | Not available to this site | Not available |

Use HTTPS outside localhost. Camera and folder access require user permission. Private browsing quotas may be much smaller: the automated incognito storage test stopped safely near 1 GiB. Storage estimates are only warnings, not reservations.

A successful same-machine Chromium test does not prove every router, mobile network, browser, or physical device combination works. Public relay availability varies. See TEST_REPORT.md for the exact tests performed.

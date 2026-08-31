# Browser compatibility — version 3.1

| Capability | Desktop Chrome / Edge | Android browsers | Firefox / Safari / iOS |
|---|---|---|---|
| WebRTC, QR/link/code | Chromium automated tests | Capability detected; physical testing still needed | Capability detected; physical testing still needed |
| Receive directly into chosen folder | When showDirectoryPicker is available | Usually unavailable | Usually unavailable |
| New receives | Device folder required | Send-only when directory picker unavailable | Send-only when directory picker unavailable |
| 10 GB receiving | Prefer a chosen folder and ~20 GB free | No blanket guarantee | No blanket guarantee |
| Browser payload fallback | Disabled for new receives | Disabled | Disabled |
| Background reliability | Keep pages awake and visible | OS may suspend | OS may suspend |
| Native LAN / Wi-Fi Direct scan | Not available | Not available to this site | Not available |

Use HTTPS outside localhost. Camera and folder access require user permission. Private browsing quotas may be much smaller: the automated incognito storage test stopped safely near 1 GiB. New received payloads are written into the user-selected folder; only resume metadata is retained in browser storage. Old browser-stored v3 files remain recoverable. Folder permissions require a user gesture; the app cannot silently choose a Downloads location.

A successful same-machine Chromium test does not prove every router, mobile network, browser, or physical device combination works. Public relay availability varies. See TEST_REPORT.md for the exact tests performed.

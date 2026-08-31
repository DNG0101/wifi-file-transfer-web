# Operational limits and remaining validation

- Discovery is scoped to invitations and remembered pairs; it cannot enumerate arbitrary LAN devices.
- Public signaling has no availability guarantee. PeerJS's free TURN service was discontinued; an operator-managed TURN service is required on networks that block direct routes.
- Physical Android/iOS devices, different mobile carriers, restrictive enterprise NATs and real Wi-Fi outages require deployment-environment testing. Automated Chromium tests do not certify these.
- Recovery metadata in browser storage can be evicted. New payloads are saved into a device folder, not browser storage. Browsers lacking showDirectoryPicker cannot receive in this mode. Folder free space cannot be reliably measured with the available browser API.
- Keep pages awake/visible. Source files must be reselected after sender reload; destination folder access may need renewal after receiver reload.
- Directory reconstruction may leave an empty placeholder if aborted; existing files are never intentionally overwritten.
- One active batch per tab, up to 200 files. Large folder manifests can hit the 32 KiB metadata cap and must be split.
- Discovery identities and friendly names are self-declared. Trust relies on private invitations/pair secrets, encrypted channels and trusted app/signaling delivery, not independent device attestation.
- Optional TURN credentials are loaded at startup; reload before a new session after they expire.
- See TEST_REPORT.md for measured evidence and explicitly untested cases.

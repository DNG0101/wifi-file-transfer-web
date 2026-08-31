# APK to browser mapping

| APK behavior | Browser implementation |
| --- | --- |
| TCP server on port 40818 | Ordered WebRTC DataChannel |
| Android NSD `_nitroshare._tcp.` discovery | Not available on ordinary web pages; manual offer/answer signaling |
| 4 MiB packet ceiling | 64 KiB bounded chunks with DataChannel backpressure |
| Packet types 0–3 | JSON control frames plus binary chunk frames |
| Transfer headers and file metadata | WebRTC `manifest` and `file-start` frames |
| Multiple files | Serial file queue with per-file progress and hashes |
| Receiver transfer directory | User-selected File System Access directory when supported; verified downloads otherwise |
| Avoid overwrite setting | Safe filename normalization; directory writes use the browser's file-handle semantics |
| Foreground/background Android transfer service | Active browser tab only; closing or suspending the tab can interrupt transfer |
| Persistent device UUID/name | Local browser settings can hold a device name; no native device identity is exposed |
| Notifications | Not implemented; browser notification permission is not required |
| URL item protocol entries | Out of scope for this file-first web rebuild |
| Android storage/media/package-install permissions | Browser file picker and user-selected directory permissions |
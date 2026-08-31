# Browser compatibility (v2)

| Capability | Chrome / Edge desktop | Chrome Android | Firefox | Safari / iOS |
|---|---|---|---|---|
| WebRTC room/file connection | Supported, Chromium tested | Expected, not physically tested | Expected, not tested | Expected in modern versions, not tested |
| Choose receive folder | Where showDirectoryPicker is available | Generally unavailable | Unavailable | Unavailable |
| Receive via in-tab download | Yes | Yes, device limits apply | Expected | Expected, device limits apply |
| Native Wi-Fi scan / Android APK interoperability | No | No | No | No |

HTTPS is required outside localhost. Keep pages in the foreground. Without a directory picker, accepted batches and outstanding downloads share a 256 MiB memory limit. Browser and OS memory/download behavior may impose lower practical limits. All files use generic binary downloads rather than being automatically opened.

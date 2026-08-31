# Browser compatibility

| Browser | Pairing / transfer | Direct folder writes | Notes |
| --- | --- | --- | --- |
| Chrome / Edge recent | Supported | Supported on desktop Chromium | File System Access API is the preferred large-file path |
| Firefox recent | Supported where WebRTC DataChannel is available | Not generally available | Use verified browser downloads |
| Safari recent | Supported on modern versions | Limited / version-dependent | Keep both tabs open and use downloads if folder access is unavailable |
| iOS browsers | WebRTC support varies by OS version | Usually unavailable | Downloads and memory limits are more constrained |

Use HTTPS in production. Localhost development is also a secure context. A public STUN server is configured for connectivity assistance; the signaling text is still manual and contains no file bytes. Some networks may block peer connectivity, especially across restrictive NATs or enterprise firewalls.
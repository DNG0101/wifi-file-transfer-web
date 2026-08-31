# APK to browser mapping

Reference: D:/Downloads/send files.apk, inspected as ZIP/DEX strings. Package references identify com.yablio.sendfilestotv. Native layout entries include activity_main, activity_transfer, and view_transfer_item. APK code was not installed, executed, or copied into the web implementation.

| Native interaction | Browser equivalent |
|---|---|
| Send and Receive | Explicit home controls |
| Native nearby discovery | Shared-room roster of browser peers via PeerJS Cloud |
| Select a target | Click receiver device name after choosing files |
| Receiver approval | Review manifest then Accept / Decline |
| Native socket transfer | Reliable encrypted WebRTC data channel |
| Native filesystem destination | Chosen directory where supported; explicit browser download otherwise |
| Transfer list | Local progress and history metadata |
| Background service | Not available; browser pages must remain open and awake |

This site does not implement the APK's wire protocol. Both devices must use the website. Browser discovery cannot enumerate arbitrary LAN devices. Network pairing depends on a public signaling service; file bytes are sent directly.

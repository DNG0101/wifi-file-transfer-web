# Wi-Fi File Transfer

A static, GitHub Pages-friendly browser app for private peer-to-peer file transfers. It is inspired by the APK **Send Files To TV** (`com.yablio.sendfilestotv`) but replaces Android-native discovery and sockets with WebRTC DataChannels and manual signaling.

## Quick start

```bash
pnpm install
PORT=25572 BASE_PATH=/ pnpm --filter @workspace/wifi-file-transfer-web run build
```

The deployable output is `dist/public`. For GitHub Pages, publish that directory and set `BASE_PATH` to the repository subpath when building (for example, `/my-repo/`).

## Pair and transfer

1. Open **Send files** on device A and choose one or more files.
2. Create an offer and copy the `WFT1.` code to device B by QR, copy/paste, or another private channel.
3. On device B, open **Receive files**, paste the offer, and accept it.
4. Copy the answer code back to device A and paste it into **Finish pairing**.
5. Start the transfer. The sender streams bounded chunks; the receiver verifies each file with SHA-256 before making it available.
6. On browsers with the File System Access API, choose a folder to stream files directly to disk. Otherwise, download verified files from the receiver page.

## Privacy and browser limits

File bytes do not pass through this app or a backend. WebRTC encrypts the DataChannel. Manual signaling carries session metadata only.

Ordinary GitHub Pages JavaScript cannot create a Wi-Fi hotspot, inspect the local network, or perform Android NSD/mDNS device discovery. Both peers must open the app in modern browsers and may need a network path that permits WebRTC. A tab closing interrupts the session; transfer history is local IndexedDB only.

See `ARCHITECTURE.md`, `APK_TO_WEB_MAPPING.md`, `FEATURE_MATRIX.md`, and `BROWSER_COMPATIBILITY.md` for the full implementation and limitation notes.
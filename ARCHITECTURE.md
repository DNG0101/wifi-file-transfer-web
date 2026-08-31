# Architecture

## Runtime

- React + Vite static frontend; no required API server.
- Wouter handles routes under `import.meta.env.BASE_URL`.
- `TransferSession` owns one temporary `RTCPeerConnection` and ordered DataChannel.
- Manual signaling encodes an offer or answer as a `WFT1.` base64url JSON string.
- The DataChannel uses JSON control frames and 64 KiB binary file chunks.
- Sender backpressure pauses above a 4 MiB buffered amount and resumes on `bufferedamountlow`.
- Receiver validates file metadata, strips path components and unsafe characters, and never writes a name supplied by the peer verbatim.
- Receiver hashes chunks incrementally with the included SHA-256 implementation. Files are only exposed after the advertised hash matches.
- File System Access API writes chunks to a user-selected directory. Other browsers retain a verified Blob until the user downloads it.
- IndexedDB stores only lightweight history metadata, never file contents.

## Protocol

Control frames are UTF-8 JSON:

`hello`, `manifest`, `file-start`, `file-end`, `complete`, `pause`, `resume`, `cancel`, and `error`.

Binary frames contain only the current file's bytes. Files are sent serially, so a chunk cannot be attributed to an ambiguous file. Every file carries an id, safe name, byte size, MIME type, modification timestamp, and SHA-256 digest at the end of the stream.

## Security model

WebRTC provides an encrypted transport. The app has no user account, cloud storage, file upload endpoint, or native permission bridge. Manual pairing is an explicit trust boundary. The receiver reviews the offer and can decline by closing the session. Metadata is bounded before use; names are normalized and path traversal is removed.

## Deliberate non-features

GitHub Pages cannot create hotspots or query Android Wi-Fi state. Browsers also do not provide portable cross-browser LAN discovery. Those APK behaviors are documented rather than faked.
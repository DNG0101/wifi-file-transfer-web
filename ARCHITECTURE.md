# Architecture (v2)

GitHub Pages serves the static HTML/CSS and bundled PeerJS 1.5.5 application. Editable modules live in src/. No file upload endpoint exists.

The room creator registers a random 12-character room ID with PeerJS Cloud. Joiners connect with independent peer IDs. The creator validates room join messages and broadcasts a roster of at most 32 peers over WebRTC control connections. Device names are self-declared, not authenticated identities. Changing Send/Receive updates presence. Closing the creator ends discovery; existing independent transfer connections can finish.

A separate reliable ordered raw data connection carries each transfer. A manifest precedes acceptance. No binary data is sent before the receiver accepts. The receiver serializes all incoming processing, including asynchronous disk writes. Control messages are offer, accept, decline, start, ready, ack, end, file-done, done, done-ack, cancel, and error. Binary chunks are at most 16 KiB. The sender limits unacknowledged data to 512 KiB and observes the native buffered amount. Both sides hash each file incrementally with SHA-256; the receiver verifies byte length and hash before exposing a download or closing its file writer. Completion is acknowledged by the receiver.

A receiver can stream to a chosen directory where supported, or retain up to 256 MiB of downloads in memory. Existing filenames get a numeric suffix rather than being overwritten. Safe filename normalization removes directory components and unsupported characters. Failed writers are aborted, although an empty placeholder file may remain on disk. Partial transfers cannot resume.

History metadata is localStorage only; file contents and room codes are not persisted there. Download object URLs are revoked when dismissed or when the page exits. The network-first service worker caches same-origin resources only and migrates the old cache. No TURN relay is configured, and connection failure on restricted networks is a known limitation.

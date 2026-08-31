# Known limitations (v2)

- Browser discovery lists only app users in the same shared room. It cannot scan all Wi-Fi devices or connect to the reference Android APK.
- Room pairing needs PeerJS Cloud and STUN internet access. No service availability guarantee or TURN relay is provided.
- Guest Wi-Fi isolation, VPNs, firewalls, and restrictive NAT may prevent a direct WebRTC connection.
- Keep both tabs awake; page closure or suspension can interrupt transfer. No resumable transfers.
- Keep the room creator connected for discovery. If it leaves, re-create a room. Active independent file connections can finish.
- In-memory receiving is limited to 256 MiB total. Save and dismiss downloads to release memory. Folder streaming requires browser File System Access support.
- An interrupted disk transfer may leave an empty placeholder. Existing files are never intentionally overwritten.
- Device names are self-declared, not verified identities. Share room codes privately and confirm sender identity before acceptance.
- Cross-platform, multi-gigabyte, and physical-LAN testing remains necessary.

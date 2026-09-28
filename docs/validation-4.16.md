# Version 4.16 validation

- 86 Node automated tests passed, including the prior live-slider, recovery, cancellation and corruption suites.
- New metadata tests cover sizes above 10 GiB and 1 TiB, exact block offsets above 2 TiB, safe integer validation and aggregate overflow rejection. They do not transfer those entire files.
- New storage tests assert that staging writes each byte once and assembly writes it once, without keepExistingData on a growing file; staged corruption fails verification.
- Browser integration transferred 64 MiB + 123 bytes through simulated channels using actual Chromium OPFS, IndexedDB and hash workers. SHA-256 matched; parallelism changed 8 -> 12 -> 8; new blocks-v2 storage completed successfully.
- Browser UI checked slider values 8, 25 and 50 and the folder-save control.
- Build and git diff whitespace checks passed.

Direct local WebRTC connection establishment did not complete in this execution environment. This is not a benchmark of Wi-Fi, hotspot, internet throughput, or a full 10+ GB transfer. Validate on the actual pair of devices to measure those properties. Physical storage, filesystem, browser quota and exact integer addressing remain limits; there is no claim of unlimited files.

Reproduce browser storage/UI coverage with `LOCAL_MOCK_TRANSPORT=1 node tests/local-transfer-browser.mjs`. Set `CHROMIUM_EXECUTABLE_PATH` if using an external Chromium binary. Omit `LOCAL_MOCK_TRANSPORT` to test actual local WebRTC where available.

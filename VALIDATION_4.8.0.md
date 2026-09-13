# Version 4.8.0 validation

Executed in the available JavaScript runtime:
- 1,003-file queue with no loss or order changes; protocol batches remain within count and UTF-8 metadata limits.
- ZIP64 records, independent CRC32 validation, binary/empty payloads, Unicode paths, deterministic 17-byte resume slices, unsafe path rejection, and metadata above 4 GiB.
- Explicit cleanup removes only completed receive copies and corresponding links; incomplete data is preserved and failed deletions retain recovery records.
- Shipped bundle syntax and HTML control consistency.

Browser tests were updated for discovery-off defaults and completed-download cleanup. Local shell execution still fails before launch with the desktop sandbox apply deny-read ACLs error, so npm build/test, browser download tests and physical large-file transfers were not run here. The shipped bundle's existing dependency prelude is retained and the changed source modules are embedded; a normal npm run build regenerates it from source.

The ZIP64 writer follows the public [PKWARE ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). Validation includes an independent structural/CRC reader, but not a native archive extractor in this environment. The 1 TiB protocol ceiling is not a tested browser capacity claim.

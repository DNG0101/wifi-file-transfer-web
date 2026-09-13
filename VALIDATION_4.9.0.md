# Version 4.9.0 validation

Executed completed-copy cleanup checks, including preservation of incomplete transfers and metadata on deletion failures. Verified that only reload navigation triggers automatic cleanup, and checked the shipped bundle syntax and HTML control consistency.

Updated browser suites for the single Transfer entry point, explicit per-device Send buttons, and automatic refresh cleanup. Full browser execution and a fresh npm build were not performed in this environment; the previously reported local sandbox startup failure remains a testing limitation. The existing bundle dependency prelude is retained with the updated source entry embedded. A normal npm run build regenerates the bundle from source.

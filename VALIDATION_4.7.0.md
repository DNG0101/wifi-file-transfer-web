# Version 4.7.0 validation

Changed browser download receiving, persistent two-way online connection confirmation, self filtering, and first-visit Unicode names.

Executed in the available JavaScript runtime:
- Main peer checks: bilateral confirmation, sending file channels in both directions, persistent pairing after file-channel close, reverse probe, mismatched peer-ID rejection, disconnect revocation, declined connection.
- Entire shipped JavaScript bundle syntax check.
- Every app DOM control exists exactly once in the HTML.

Updated browser tests cover actual download events and bytes, fallback download links, reverse transfers, empty files, Unicode names, returning users, recovery after reload, self filtering, and discovery toggling. These browser suites and npm build/test were not executed here: both local shell and Node runtimes failed to start with the desktop sandbox's apply deny-read ACLs error.

The shipped bundle retains its existing dependency prelude and embeds the updated source entry and MainPeerManager in an isolated scope. A future npm run build regenerates the bundle normally from source. No claim of a fresh esbuild build or physical-device verification is made.

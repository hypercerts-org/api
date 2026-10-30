---
'@hypercerts-org/hypercerts-api': minor
---

Validate records against `@hypercerts-org/lexicon` 1.6.0 (was 1.5.0). Records may now carry the optional `langs` field and `app.certified.signature.defs#createdVia` signatures, and funding receipts may omit `amount` and `currency`. Records using these are accepted and served unchanged; no record that validated before is rejected. Operators must reinstall the bundle for the running indexer to use the new Lexicons.

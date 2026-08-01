# Architecture

Pipeline A has seven explicit boundaries:

1. Configuration binds one protocol ID to one network, INIT transaction, deployment heights, spec
   hash, and namespace.
2. Bitcoin Core RPC supplies canonical block order. Optional ZMQ notifications only trigger polling.
3. The Tandem package parses marker bytes and computes consensus roots. Parser success alone does
   not prove full transaction validity.
4. MySQL stores canonical blocks, transactions, events, objects, carrier states, chapters,
   checkpoints, conflicts, and reorg journals. Mempool records stay in their own table.
5. Reorg rollback deletes canonical material in descending height order and never crosses
   `initHeight - 1`.
6. Agreement tuples use RFC 8785 JSON canonicalization and Ed25519. Signing is unavailable unless
   an operator supplies a key, immutable release identity, and a complete checkpoint.
7. The verified explorer gateway signs pipeline A's tuple, obtains pipeline B's independently
   signed tuple from `/agreement/{height}`, verifies both against configured trust maps, and
   compares their protocol state at the same canonical height. It repeats this verification after
   each data read and withholds the response if the agreement identity changed during the read.

Pipeline B must use a separate codebase, node, store, owner, and release process.

The gateway preserves each pipeline's parser and indexer commit and binary hash. Release identities
are signed evidence and may differ across independent implementations. Protocol ID, height, block
hash, event root, object-state root, chained root, and object counters must agree before explorer
data can be returned. Any failed prerequisite closes the verified surface with HTTP 503.

Carrier address lookups decode the deployment's native SegWit P2WSH address and reconstruct the
carrier witness program from the canonical state keys. MySQL stores and indexes that deterministic
generated projection, including automatic calculation for existing rows during migration. This
keeps lookups bounded without trusting or backfilling a separate address label.

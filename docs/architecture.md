# Architecture

Pipeline A has six explicit boundaries:

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
   an operator supplies a key and the checkpoint is complete.

Pipeline B must use a separate codebase, node, store, owner, and release process.


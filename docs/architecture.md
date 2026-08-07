# Architecture

The full architecture, with diagrams and the honest boundary between what runs and what a deployment
must supply, is published at
<https://bitcoinuniverse.github.io/index-tandem/operate/architecture/>.

Pipeline A has seven explicit boundaries:

1. Configuration binds one protocol ID to one network, INIT transaction, deployment heights, spec
   hash, and namespace. It is validated once at boot and the process refuses to start if any rule
   fails.
2. Bitcoin Core RPC supplies canonical block order. ZMQ endpoints are optional and are subscribed to
   as a wake-up channel by design.
3. The Tandem package parses marker bytes and defines the consensus roots. Parser success alone does
   not prove full transaction validity.
4. MySQL stores canonical blocks, transactions, events, objects, carrier states, chapters,
   checkpoints, conflicts, and reorg journals. Mempool records stay in their own table and never
   contribute to canonical state, counters, or roots.
5. Reorg rollback runs as one SERIALIZABLE transaction that locks the tip and the ancestor, writes
   the journal, deletes canonical material above the ancestor height, and rebuilds derived state
   behind a fail-closed guard. It never crosses `initHeight - 1`.
6. Agreement tuples use RFC 8785 JSON canonicalization and Ed25519. Signing is unavailable unless an
   operator supplies a key, an immutable release identity, and a complete checkpoint.
7. The verified explorer gateway signs pipeline A's tuple, obtains pipeline B's independently signed
   tuple, verifies both against configured trust maps, and compares their protocol state at the same
   canonical height. It repeats the verification after each data read and withholds the response if
   the agreement identity changed during the read.

Pipeline B must use a separate codebase, node, store, owner, and release process. It is intentionally
outside this repository and this Compose stack.

## What still needs a driver

The repository is an implementation scaffold with executable protocol boundaries and unit tests.
These boundaries exist and are exercised, and a deployment has to supply the runtime that drives
them:

- a block ingestion loop, and the writes that persist canonical blocks, transactions, and events
- reorg detection, which calls the implemented rollback
- a checkpoint writer, without which readiness can never pass
- a mempool driver, which calls the implemented overlay
- event, root, and counter computation

Readiness fails closed on all of it, so the service reports what it can prove rather than what it
was configured to hope for.

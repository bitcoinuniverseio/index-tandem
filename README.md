# Tandem indexer pipeline A

This repository is the Node 22.23.1, TypeScript, NestJS, and MySQL implementation of
Tandem v1 indexer pipeline A. It consumes ordered blocks from Bitcoin Core, records canonical
protocol observations, maintains a separate mempool overlay, and exposes query and agreement
surfaces.

The repository is an implementation scaffold with executable protocol boundaries and unit tests.
It does not claim a live Bitcoin Core connection, ZMQ delivery, MySQL migration, signet replay, or
production signature ceremony. Readiness fails closed until those dependencies and a signing key
are verified at runtime.

## Local verification

Use Node 22.23.1 and npm 10.9.8. The local file dependency resolves the built sibling
`../tandem` package. Build and verify that package first, then run:

```text
npm install
npm run verify
```

See `docs/architecture.md`, `docs/api.md`, and `docs/operations.md` before connecting services.

## Safety boundary

Pipeline A is not an authority for wallet spending. Consumers must compare its signed agreement
tuple with the separately implemented pipeline B tuple at the same height. A missing, stale, or
disagreeing tuple must block mint and protected-output spending flows.

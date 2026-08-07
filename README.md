# Tandem indexer pipeline A

**Documentation: <https://bitcoinuniverse.github.io/index-tandem/>**

Tandem is a Bitcoin object that two people hold together. It lives in a single 20,000 satoshi output
locked to a 2 of 2 script between exactly two sorted keys, it keeps a continuous history of chapters
and key rotations, and it has a recovery path both parties sign in advance so neither can be denied
an exit.

This repository is the Node 24.18.1, TypeScript, NestJS, and MySQL implementation of Tandem indexer
pipeline A. It consumes ordered blocks from Bitcoin Core, records canonical protocol observations,
maintains a separate mempool overlay, and exposes query and agreement surfaces.

The repository is an implementation scaffold with executable protocol boundaries and unit tests.
It does not claim a live Bitcoin Core connection, ZMQ delivery, MySQL migration, signet replay, or
production signature ceremony. Readiness fails closed until those dependencies and a signing key are
verified at runtime. The documentation labels every page with which of those it is describing.

## Local verification

Use Node 24.18.1 and npm 11.16.0. The local file dependency resolves the committed
`vendor/bitcoinuniverse-tandem-0.1.0.tgz` package. Its private engineering source commit and
artifact hash are pinned in `SOURCE-PROVENANCE.json`. The public protocol contract and exact shared
inputs remain available at `https://github.com/bitcoinuniverse/tandem`. Then run:

```text
npm install
npm run verify
```

See `docs/architecture.md`, `docs/api.md`, and `docs/operations.md` for the short form, and the
documentation site above for the complete operator and integrator guides.

## Container deployment

Copy `.env.example` to `.env`, replace every placeholder, configure both trusted-key maps, and set
the four release identity values. Then build and start pipeline A and MySQL:

```text
docker compose up --build -d
```

Compose waits for MySQL, runs TypeORM migrations, and starts the non-root application container.
The image health check probes process liveness at `/health`; `/ready` remains the authoritative
dependency and synchronization check. Pipeline B is intentionally external to this Compose stack.

The explorer-facing API is under `/tandem/verified`. It returns data only after pipeline A and
pipeline B produce trusted, valid, matching agreement tuples at the same canonical height. Mainnet
access is disabled unless `TANDEM_VERIFIED_MAINNET_ENABLED=true` is set deliberately. See
`docs/api.md` for the contract and `docs/operations.md` for key and release configuration.

## Documentation

The documentation site lives in `site/` and is built with Astro and Starlight. Its API reference is
generated from these controllers rather than written by hand, so it cannot describe a route the
service does not have.

```text
npm run docs:install
npm run docs:dev
npm run docs:verify
```

`docs:verify` regenerates the OpenAPI document, enforces the writing rules, type checks, builds,
generates the social preview images, checks every internal link, and runs the documentation tests.
Pushes to `main` publish it to GitHub Pages.

## Safety boundary

Pipeline A is not an authority for wallet spending. Consumers must compare its signed agreement
tuple with the separately implemented pipeline B tuple at the same height. A missing, stale, or
disagreeing tuple must block mint and protected-output spending flows.

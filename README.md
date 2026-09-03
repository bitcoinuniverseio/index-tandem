# Tandem indexer pipeline A

**Documentation: <https://bitcoinuniverseio.github.io/index-tandem/>**

Tandem is a Bitcoin object that two people hold together. It lives in a single 20,000 satoshi output
locked to a 2 of 2 script between exactly two sorted keys, it keeps a continuous history of chapters
and key rotations, and it has a recovery path both parties sign in advance so neither can be denied
an exit.

Tandem records are only valid as a matched pair of transactions. The protocol itself is specified
elsewhere and this repository does not restate it:

| Repository | What it owns |
|---|---|
| [bitcoinuniverseio/tandem](https://github.com/bitcoinuniverseio/tandem) | The normative specification, JSON schemas and golden vectors. Published at <https://bitcoinuniverseio.github.io/tandem/>. |
| bitcoinuniverseio/index-tandem | This repository. Pipeline A: the TypeScript, NestJS and MySQL indexer and API. |
| [bitcoinuniverseio/tandem-verifier-rs](https://github.com/bitcoinuniverseio/tandem-verifier-rs) | Pipeline B: an independent Rust and PostgreSQL verifier that shares no code with this one. |

If this repository and the specification disagree, the specification is right and this repository has
a bug.

## What this software is, and is not

It consumes ordered blocks from Bitcoin Core, records authoritative protocol observations, maintains
a separate mempool overlay, and exposes query and agreement surfaces under `/tandem`.

It is an implementation scaffold with executable protocol boundaries and unit tests. It does not
claim a live Bitcoin Core connection, ZMQ delivery, a MySQL migration run against a real database, a
signet replay, or a production signature ceremony. Readiness fails closed until those dependencies
and a signing key are verified at runtime, and every documentation page carries a label saying which
of those it is describing.

It is not an authority for wallet spending. Consumers must compare its signed agreement tuple with
the separately implemented pipeline B tuple at the same height. A missing, stale, or disagreeing
tuple must block mint and protected-output spending flows.

Tandem has no entry in the published Bitcoin Universe capability snapshot, which records per protocol
which Universe surfaces implement which actions. No Universe product implements a listing, buying,
offer or settlement path for Tandem. This is protocol infrastructure, not a marketplace component.

## Architecture at a glance

```text
Bitcoin Core RPC ----> block projector ----> MySQL authoritative tables
        |                                          |
        |  ZMQ (optional wakeup only)              +--> derived state rebuilder
        |                                          +--> reorg service (SERIALIZABLE rollback)
        +--------------> mempool overlay (separate table, never authoritative)

                          /tandem            direct surface, this pipeline's own view
                          /tandem/verified   fail closed, requires pipeline B agreement
                          /health /ready /metrics
```

Seven explicit boundaries, described in [`docs/architecture.md`](docs/architecture.md): configuration
binding, Bitcoin Core RPC, the Tandem protocol package, MySQL storage, reorg rollback, agreement
signing, and the verified explorer gateway.

## API route convention

Every route this service serves is under `/tandem`, which follows the organization rule that an
indexer serves under its repository name with the `index-` prefix removed. There is no global route
prefix in `src/main.ts`, and the two controllers declare `@Controller("tandem")` and
`@Controller("tandem/verified")` directly. The interactive document is at `/docs` and the raw
document at `/docs-json`.

`/health`, `/ready` and `/metrics` are deliberately outside that prefix, because they are process
endpoints rather than protocol endpoints.

## Local verification

Use Node 24.19.0 and npm 11.17.0. The local file dependency resolves the committed
`vendor/bitcoinuniverse-tandem-0.1.0.tgz` package, whose engineering source commit and declared
artifact hash are recorded in `SOURCE-PROVENANCE.json`. Then run:

```text
npm install
npm run verify
```

`verify` runs Biome, `tsc --noEmit`, the Vitest suite and the build. The suite is 38 tests across 15
files and needs no database, no node and no network.

The application and documentation checks run on the shared `universe-ci` pool, so certified Linux and
Windows workers execute the same contract. Fork pull requests are excluded from private self-hosted
execution. Default-branch documentation publishing keeps its existing Pages permissions and
environment gate.

## Documentation

The published site in `site/` is built with Astro and Starlight and is the complete operator and
integrator guide. Its API reference is generated from these controllers rather than written by hand,
so it cannot describe a route the service does not have.

```text
npm run docs:install
npm run docs:dev
npm run docs:verify
```

`docs:verify` regenerates the OpenAPI document, enforces the writing rules, type checks, builds,
generates the social preview images and the static endpoints, checks every internal link, and runs
the documentation tests. Pushes to `main` publish it to GitHub Pages.

The repository also carries short-form documentation that stands on its own:

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | The seven boundaries and what still needs a driver. |
| [`docs/api.md`](docs/api.md) | The two surfaces, the nine compared fields, and the operational routes. |
| [`docs/configuration.md`](docs/configuration.md) | Every environment variable with its validation rule and a safe example. |
| [`docs/database.md`](docs/database.md) | The eleven tables, the two migrations, and what is authoritative. |
| [`docs/operations.md`](docs/operations.md) | Deployment, key handling, trust maps, and the mainnet gate. |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Organized by the symptom you actually observe. |

## Container deployment

Copy `.env.example` to `.env`, replace every placeholder, configure both trusted-key maps, and set
the four release identity values. Then build and start pipeline A and MySQL:

```text
docker compose up --build -d
```

Compose waits for MySQL, runs TypeORM migrations, and starts the non-root application container. The
image health check probes process liveness at `/health`; `/ready` remains the authoritative
dependency and synchronization check. Pipeline B is intentionally external to this Compose stack.

The explorer-facing API is under `/tandem/verified`. It returns data only after pipeline A and
pipeline B produce trusted, valid, matching agreement tuples at the same authoritative height.
Mainnet access is disabled unless `TANDEM_VERIFIED_MAINNET_ENABLED=true` is set deliberately.

Pipeline A requests pipeline B's tuple from `{PIPELINE_B_BASE_URL}/agreement/{height}`. The Rust
verifier serves that envelope at `/tandem/agreement/{height}`, so `PIPELINE_B_BASE_URL` must include
the `/tandem` path segment.

## Contributing, support and security

- [`CONTRIBUTING.md`](CONTRIBUTING.md) for the review bar and the checks that must pass.
- [`SUPPORT.md`](SUPPORT.md) for where questions go.
- [`SECURITY.md`](SECURITY.md) for private vulnerability reporting.

## Versioning and releases

`package.json` is at `0.1.0` and there is no Universe release tag, so `docs.manifest.json` records
this repository as `experimental`. Release identity is separate from the package version: the four
`TANDEM_*_COMMIT` and `TANDEM_*_BINARY_SHA256` values are signed into every agreement tuple and are
deliberately never compared between pipelines.

## Safety boundary

Pipeline A is not an authority for wallet spending. A missing, stale, or disagreeing tuple must block
mint and protected-output spending flows. Read
[`what the verifier proves`](https://github.com/bitcoinuniverseio/tandem-verifier-rs/blob/main/docs/what-it-proves.md)
before treating a matching pair of tuples as a guarantee about anything beyond indexed state.

## License

MIT. See [`LICENSE`](LICENSE).

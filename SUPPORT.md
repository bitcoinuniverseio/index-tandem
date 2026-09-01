# Support

## Start with the documentation

The complete guide is published at <https://bitcoinuniverseio.github.io/index-tandem/>.

| Question | Where the answer is |
|---|---|
| What is Tandem? | <https://bitcoinuniverseio.github.io/index-tandem/discover/what-is-tandem/> |
| What are the protocol rules? | The specification at <https://bitcoinuniverseio.github.io/tandem/> |
| How do I call the API? | [`docs/api.md`](docs/api.md) and <https://bitcoinuniverseio.github.io/index-tandem/build/api-reference/> |
| What does each environment variable do? | [`docs/configuration.md`](docs/configuration.md) |
| What is in the database? | [`docs/database.md`](docs/database.md) |
| Why is `/ready` returning 503? | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Why is every verified route returning 503? | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| How do I deploy and operate it? | [`docs/operations.md`](docs/operations.md) |
| Why are there two pipelines? | <https://bitcoinuniverseio.github.io/index-tandem/discover/independent-verification/> |

## Where to ask

| Topic | Where |
|---|---|
| A bug, wrong behaviour, or documentation error in this indexer | Issues on [bitcoinuniverseio/index-tandem](https://github.com/bitcoinuniverseio/index-tandem/issues) |
| A protocol rule, a specification ambiguity, or a test vector | [bitcoinuniverseio/tandem](https://github.com/bitcoinuniverseio/tandem/issues) |
| The independent Rust verifier, pipeline B | [bitcoinuniverseio/tandem-verifier-rs](https://github.com/bitcoinuniverseio/tandem-verifier-rs/issues) |
| A vulnerability, or any parser, signature, root or reorg discrepancy | Private disclosure per [`SECURITY.md`](SECURITY.md). Never a public issue. |

## What to include in a report

- The commit you are running and the configured network.
- The full `/ready` response body when readiness is the problem.
- The block height and block hash where behaviour differs.
- Which of the nine compared agreement fields differ, when the two pipelines disagree.
- Whether the request went to `/tandem` or to `/tandem/verified`. The two surfaces answer different
  questions and a 503 means something different on each.

Never include signing keys, RPC credentials, database credentials, raw wallet material or user data.

## What is out of scope

This repository does not provide wallet functionality, custody, trading or advice about spending.
Tandem has no marketplace entry in the published Bitcoin Universe capability snapshot, so there is no
Universe listing, buying, offer or settlement path to support.

Pipeline A is also not an authority for wallet spending. A missing, stale or disagreeing agreement
tuple must block mint and protected-output spending flows in whatever consumes it.

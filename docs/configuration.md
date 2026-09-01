# Configuration

Every value is read from the process environment by `src/config/configuration.ts` and validated once,
at boot. A failure throws `ConfigurationError` and the process refuses to start rather than running
in a partly configured state. `.env.example` lists every key with a placeholder.

An interactive version of this reference, with the mistake that is easy to make for each variable, is
published at <https://bitcoinuniverseio.github.io/index-tandem/tools/env-reference/>.

## Deployment binding

These six values are the deployment identity. They are cross checked against each other at boot.

| Variable | Required | Rule |
|---|---|---|
| `TANDEM_NETWORK` | yes | A supported network name. An unrecognised value fails with `unsupported TANDEM_NETWORK`. Mainnet maps to the chain name `main` when comparing against `getblockchaininfo`. |
| `TANDEM_INIT_TXID` | yes | The configured INIT txid in display order, 32-byte lowercase hexadecimal. Never discovered by scanning. |
| `TANDEM_INIT_HEIGHT` | yes | The height INIT confirms at. It is also the floor for reorg rollback, which never crosses one block below it. |
| `TANDEM_OPEN_HEIGHT` | yes | The first height at which a CREATE can be valid. It must be at least `INIT_LEAD` blocks after the INIT height. |
| `TANDEM_CLOSE_HEIGHT` | yes | Must equal the open height plus `FOUNDING_WINDOW` exactly. Both constants come from the protocol package, not from the environment. |
| `TANDEM_SPEC_HASH` | yes | SHA256 of the exact normative specification bytes, 32-byte lowercase hexadecimal. |
| `TANDEM_NAMESPACE` | yes | Must equal the namespace derived from the network code, the INIT txid and the specification hash. A mismatch fails with `TANDEM_NAMESPACE does not match the configured INIT tuple`. |

The protocol identifier is derived rather than configured, as `tndm:<network>:<init-txid>`.

`TANDEM_NAMESPACE` is deliberately redundant: it is recomputed at boot and compared, so a
copy-and-paste error in any of the other three binding values is caught immediately instead of
producing a service that indexes a protocol nobody deployed.

The placeholder hashes in `.env.example` are not launch parameters. A deployment must supply real
ones.

## Service

| Variable | Required | Default | Rule |
|---|---|---|---|
| `HTTP_HOST` | no | `127.0.0.1` | Compose sets `0.0.0.0` so the published port reaches the process. |
| `PORT` | no | `3021` | Non-negative safe integer. |
| `NODE_ENV` | no | `development` | Label only. |

## Bitcoin Core

| Variable | Required | Default | Rule |
|---|---|---|---|
| `BITCOIN_RPC_URL` | yes | | RPC endpoint of a dedicated node on the configured network. |
| `BITCOIN_RPC_USER` | yes | | RPC user. |
| `BITCOIN_RPC_PASSWORD` | yes | | RPC password. Load it from a secret manager. |
| `BITCOIN_RPC_TIMEOUT_MS` | no | `15000` | Non-negative safe integer. |
| `BITCOIN_ZMQ_HASHBLOCK` | no | | Optional wakeup channel. |
| `BITCOIN_ZMQ_RAWTX` | no | | Optional wakeup channel. |
| `BITCOIN_ZMQ_SEQUENCE` | no | | Optional wakeup channel. |

ZMQ is a wakeup channel by design. Always reconcile from RPC, and verify the node's reported chain
before indexing.

## Database

| Variable | Required | Default |
|---|---|---|
| `MYSQL_HOST` | yes | |
| `MYSQL_PORT` | no | `3306` |
| `MYSQL_USER` | yes | |
| `MYSQL_PASSWORD` | yes | |
| `MYSQL_DATABASE` | yes | |

`MYSQL_ROOT_PASSWORD` in `.env.example` is consumed by the Compose MySQL service, not by the
application.

## Readiness

| Variable | Required | Default | Rule |
|---|---|---|---|
| `READINESS_MAX_BLOCK_LAG` | no | `2` | Maximum block lag tolerated before readiness reports false. |

## Agreement signing

| Variable | Required | Rule |
|---|---|---|
| `AGREEMENT_KEY_ID` | conditional | 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:` and `-`. Required as soon as either key value is set. |
| `AGREEMENT_PRIVATE_KEY_HEX` | no | 32-byte lowercase hexadecimal Ed25519 seed. |
| `AGREEMENT_PUBLIC_KEY_HEX` | no | 32-byte lowercase hexadecimal Ed25519 public key. |
| `TANDEM_PARSER_COMMIT` | no | 20-byte lowercase hexadecimal, that is 40 characters. |
| `TANDEM_INDEXER_COMMIT` | no | 20-byte lowercase hexadecimal, that is 40 characters. |
| `TANDEM_PARSER_BINARY_SHA256` | no | 32-byte lowercase hexadecimal. |
| `TANDEM_INDEXER_BINARY_SHA256` | no | 32-byte lowercase hexadecimal. |

The signing key is read as raw hexadecimal from the environment. There is no file, HSM or KMS loader.
Load it through a secret manager and never place it in source control.

The four release identity values must come from the immutable artifacts actually running. They are
signed into every tuple and are deliberately not compared between pipelines.

Signing is unavailable, and readiness therefore fails, until a key, a complete release identity and a
complete checkpoint all exist.

## Verified surface and pipeline B

| Variable | Required | Default | Rule |
|---|---|---|---|
| `PIPELINE_B_BASE_URL` | no | | Absolute HTTP or HTTPS URL with no credentials, query or fragment. Trailing slashes are stripped. |
| `PIPELINE_B_REQUEST_TIMEOUT_MS` | no | `5000` | Non-negative safe integer. |
| `TANDEM_VERIFIED_MAINNET_ENABLED` | no | `false` | Exactly `true` or `false`. Any other value fails the boot. |
| `PIPELINE_A_TRUSTED_KEYS_JSON` | no | `{}` | JSON object mapping each allowed key id to a 64-character lowercase hexadecimal Ed25519 public key. |
| `PIPELINE_B_TRUSTED_KEYS_JSON` | no | `{}` | Same shape, for pipeline B's signers. |

Pipeline A requests `{PIPELINE_B_BASE_URL}/agreement/{height}`. The Rust verifier serves that
envelope at `/tandem/agreement/{height}`, so the configured base URL must include the `/tandem`
segment:

```text
PIPELINE_B_BASE_URL=http://verifier.internal:8088/tandem
PIPELINE_B_REQUEST_TIMEOUT_MS=5000
```

Both trust maps are frozen at boot, so rotating a key needs a restart. Add the new key before
activation and remove the old one only after its signed heights are no longer served.

**Nothing checks that the two maps are disjoint, and nothing checks that the two key ids differ.** A
signer present in both maps satisfies both sides of the comparison, and the guarantee the verified
surface exists to provide silently disappears. Keeping them separate is the operator's job.

Keep `TANDEM_VERIFIED_MAINNET_ENABLED=false` until both pipelines, trust registries, monitoring,
replay evidence and operational ownership have been reviewed.

## What is not configurable

Protocol constants are not environment driven. The carrier value, the founding window, the INIT lead
and the marker encoding come from the Tandem package and the specification. Making any of them
configurable would let one deployment index a protocol the other pipeline is not implementing, which
defeats the reason the second pipeline exists.

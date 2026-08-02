# Operations

The full operator documentation, including deployment, configuration, readiness, monitoring, mainnet
gates, incident runbooks, and troubleshooting, is published at
<https://bitcoinuniverse.github.io/index-tandem/operate/architecture/>.

The essentials:

1. Pin Node 22.23.1 and npm 10.9.8.
2. Set a real deployment tuple. The placeholder hashes in `.env.example` are not launch parameters.
3. Run migrations against an empty, dedicated MySQL database. Nothing runs them automatically outside
   Compose, and MySQL commits DDL implicitly, so a partially applied migration has to be recovered by
   hand.
4. Connect a dedicated Bitcoin Core node and verify its reported chain before indexing.
5. Configure ZMQ only as a wake-up channel. Always reconcile from RPC.
6. Load the Ed25519 signing key through a secret manager. Never place it in source control. The
   service reads it as raw hex from the environment and provides no file, HSM, or KMS loader.
7. Set `TANDEM_PARSER_COMMIT`, `TANDEM_INDEXER_COMMIT`, `TANDEM_PARSER_BINARY_SHA256`, and
   `TANDEM_INDEXER_BINARY_SHA256` from the immutable artifacts running in pipeline A.
8. Set `PIPELINE_B_BASE_URL` to the independently operated pipeline B service. Pipeline A reads its
   agreement from `GET {base}/agreement/{height}` and applies `PIPELINE_B_REQUEST_TIMEOUT_MS`.
9. Configure `PIPELINE_A_TRUSTED_KEYS_JSON` and `PIPELINE_B_TRUSTED_KEYS_JSON` as JSON objects that
   map each allowed `key_id` to a 64-character lowercase hexadecimal Ed25519 public key. Rotate by
   adding the new key before activation and removing the old key only after its signed heights are no
   longer served. The maps are frozen at boot, so a change needs a restart. Nothing checks that the
   two maps are disjoint: confirm that yourself, because one signer present in both would satisfy
   both sides of the comparison.
10. Keep `TANDEM_VERIFIED_MAINNET_ENABLED=false` until both pipelines, trust registries, monitoring,
    replay evidence, and operational ownership have been reviewed.
11. Alert and stop dependent writes when readiness is false, an agreement is missing or stale, a
    signature or schema is invalid, a key is untrusted, or semantic fields differ.

## Compose deployment

Create `.env` from `.env.example`, replace all placeholders, and keep the file outside source
control. `docker compose up --build -d` starts MySQL, waits for its health check, runs migrations,
and then starts pipeline A as a non-root user with a read-only root filesystem, all capabilities
dropped, and a small tmpfs at `/tmp`. MySQL data is retained in the `tandem-mysql` named volume.

Pipeline B and Bitcoin Core are external services and must be reachable from the container network
using the configured URLs. Do not use loopback addresses for services running outside the indexer
container. Compose sets `HTTP_HOST=0.0.0.0` so the published port reaches the application. Local
non-container runs default to `127.0.0.1`.

The MySQL service does not carry the same hardening as the indexer service, and neither declares
resource limits. Both are yours to add.

The container's `/health` probe checks liveness only. Gate traffic on `/ready` and alert on HTTP 503
from verified explorer routes. Do not interpret container health as agreement availability.

No external service verification has been performed by the repository scaffold itself.

## Documentation

The documentation site lives in `site/`. Build and verify it with:

```text
npm run docs:install
npm run docs:verify
```

That regenerates the OpenAPI document from the controllers, checks the writing rules, type checks,
builds, generates social preview images, checks every internal link, and runs the documentation
tests.

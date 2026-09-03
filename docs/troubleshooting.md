# Troubleshooting

Organized by what you actually see. A searchable version with more detail is published at
<https://bitcoinuniverseio.github.io/index-tandem/operate/troubleshooting/>.

## The process exits immediately at startup

Configuration is validated once, before anything else runs, and a failure throws
`ConfigurationError` with the offending variable named in the message.

| Message | Cause |
|---|---|
| `<KEY> is required` | The variable is missing or empty after trimming. |
| `<KEY> must be an integer` | A non-digit value in a numeric variable. |
| `<KEY> must be 32-byte lowercase hex` | A hash variable that is not 64 lowercase hexadecimal characters. |
| `unsupported TANDEM_NETWORK: <value>` | A network name the protocol package does not define. |
| `TANDEM_CLOSE_HEIGHT must equal open height plus <n>` | The founding window was not respected. |
| `TANDEM_INIT_HEIGHT must precede the open height by at least <n> blocks` | The INIT lead was not respected. |
| `TANDEM_NAMESPACE does not match the configured INIT tuple` | One of the network, INIT txid, specification hash or namespace was pasted from a different deployment. |
| `AGREEMENT_KEY_ID is required when an agreement key is configured` | A key was supplied without an id. |
| `PIPELINE_B_BASE_URL must be an HTTP URL without credentials, query, or fragment` | Credentials or a query string in the pipeline B URL. |
| `<KEY> must be valid JSON` or `contains an invalid Ed25519 public key` | A malformed trust map. |

## `/ready` returns HTTP 503

That is the designed behaviour until every gate passes. The response names the failing gates, and
each one means exactly one thing.

| Reason | What to check |
|---|---|
| `configuration_invalid` | The boot validation above. |
| `database_unavailable` | MySQL connectivity, credentials and that migrations ran. |
| `bitcoin_core_unavailable` | RPC URL, credentials, and whether the node is up. |
| `bitcoin_network_mismatch` | The node is on a different chain than `TANDEM_NETWORK`. Mainnet expects the chain name `main`. |
| `bitcoin_core_initial_block_download` | The node is still doing IBD. Wait. |
| `node_height_unknown` | The node answered, but not with a usable height. |
| `canonical_tip_missing` | Nothing has been indexed yet. On a fresh scaffold this is expected until an ingestion driver writes blocks. |
| `canonical_tip_stale` | The indexed tip is further behind the node than `READINESS_MAX_BLOCK_LAG`. |
| `checkpoint_incomplete` | No complete checkpoint exists at the tip, so nothing can be signed. |
| `agreement_signer_unavailable` | No signing key, or an incomplete release identity. |

## The container reports healthy but nothing works

`/health` is process liveness only. The container health check probes it, so a container can be
healthy while `/ready` is refusing traffic. Gate load balancers and dependent services on `/ready`.

## Every `/tandem/verified` route returns HTTP 503

The body is always the same, whichever check failed:

```json
{ "status": "verification_unavailable", "error": "verification_unavailable" }
```

Work through the causes in this order:

1. `TANDEM_VERIFIED_MAINNET_ENABLED` is `false` and the deployment is on mainnet. That is deliberate.
2. `PIPELINE_B_BASE_URL` is unset.
3. `PIPELINE_B_BASE_URL` is missing the `/tandem` path segment. Pipeline A requests
   `{base}/agreement/{height}` and the Rust verifier serves `/tandem/agreement/{height}`, so a bare
   origin returns 404 on every attempt.
4. Pipeline B is not ready, so it has no tuple to sign at that height.
5. A signer is not in the matching trust map, so the signature is untrusted rather than invalid.
6. The two tuples differ on one of the nine compared fields. That is a real disagreement and is a
   security event, not a configuration problem. Stop dependent writes and investigate.

A data lookup that simply does not exist still returns HTTP 404, not 503. If you see 404 rather than
503, verification passed and the object is genuinely absent.

## A carrier address lookup returns nothing

Address routes accept the native SegWit P2WSH address of a carrier. Pipeline A validates the
network-specific Bech32 checksum, derives the 32-byte witness program, and matches it against the
generated `carrier_program` column reconstructed from the stored state keys. A lookup returns nothing
when the address is valid but belongs to a different network, or when the carrier has not been
indexed yet. It never depends on an externally supplied address label, so there is no label to
correct.

## A migration failed halfway

MySQL commits DDL implicitly, so there is no transaction to roll back. Recover by hand: inspect which
statements applied, restore from backup if the database held real data, and rerun against an empty,
dedicated database otherwise.

## Nothing is being indexed at all

Expected on a clean checkout. The repository is an implementation scaffold: the protocol boundaries,
reorg rollback, mempool overlay and agreement signing are implemented and tested, and a deployment
still has to supply the block ingestion loop, reorg detection, the checkpoint writer, the mempool
driver, and event, root and counter computation. `docs/architecture.md` lists exactly what is
missing, and readiness fails closed on all of it rather than pretending otherwise.

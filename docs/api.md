# API

Pipeline A protocol routes are under `/tandem`.

| Route | Purpose |
| --- | --- |
| `GET /tandem/status` | Bound deployment and current readiness snapshot |
| `GET /tandem/objects/:objectKey` | Object and chapter history |
| `GET /tandem/carriers/:txid/:vout` | Carrier state for an exact outpoint |
| `GET /tandem/events/:txid` | Canonical events for a transaction |
| `GET /tandem/invalid-events` | Paginated invalid observations |
| `GET /tandem/reorgs` | Paginated reorg journal |
| `GET /tandem/stats` | Canonical aggregate counts |
| `GET /tandem/agreement/:height` | Signed checkpoint envelope when available |

`GET /health` is process liveness. `GET /ready` returns HTTP 503 until configuration, MySQL,
Bitcoin Core identity and sync, the canonical tip, a checkpoint, and the signing boundary are ready.
`GET /metrics` returns Prometheus text exposition.

## Verified explorer API

The explorer-facing contract is a separate, fail-closed surface under `/tandem/verified`.

| Route | Purpose |
| --- | --- |
| `GET /tandem/verified/status` | Verified deployment and readiness status |
| `GET /tandem/verified/objects` | Verified object listing |
| `GET /tandem/verified/objects/:key` | Verified object detail |
| `GET /tandem/verified/events/:txid` | Verified canonical events for a transaction |
| `GET /tandem/verified/transactions/:txid` | Verified transaction detail |
| `GET /tandem/verified/addresses/:address` | Verified address activity |
| `GET /tandem/verified/invalid-events` | Verified invalid-event listing |
| `GET /tandem/verified/mempool` | Verified mempool overlay listing |
| `GET /tandem/verified/conflicts` | Verified conflict listing |
| `GET /tandem/verified/reorgs` | Verified reorg journal |
| `GET /tandem/verified/stats` | Verified aggregate counts |
| `GET /tandem/verified/search` | Verified explorer search |

Address lookups accept the native SegWit P2WSH address of a Tandem carrier. Pipeline A validates
the network-specific Bech32 checksum and derives the 32-byte witness program, then matches it to
an indexed, database-generated program reconstructed from the persisted state keys. It does not
depend on an optional or externally supplied address label.

Every HTTP 200 response has a top-level `verification` object in addition to the endpoint data:

```json
{
  "data": {},
  "verification": {
    "status": "verified",
    "height": 1008,
    "blockHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "chainedRoot": "0000000000000000000000000000000000000000000000000000000000000000",
    "pipelineA": {
      "keyId": "pipeline-a-2026-01",
      "signature": "128-lowercase-hex-characters",
      "release": {
        "parserCommit": "40-lowercase-hex-characters",
        "indexerCommit": "40-lowercase-hex-characters",
        "parserBinarySha256": "64-lowercase-hex-characters",
        "indexerBinarySha256": "64-lowercase-hex-characters"
      }
    },
    "pipelineB": {
      "keyId": "pipeline-b-2026-01",
      "signature": "128-lowercase-hex-characters",
      "release": {
        "parserCommit": "40-lowercase-hex-characters",
        "indexerCommit": "40-lowercase-hex-characters",
        "parserBinarySha256": "64-lowercase-hex-characters",
        "indexerBinarySha256": "64-lowercase-hex-characters"
      }
    }
  }
}
```

Pipeline A requests pipeline B at `GET /agreement/{height}`, validates each envelope against the
configured trusted key for its `key_id`, and verifies each Ed25519 signature over the RFC 8785 JCS
canonical tuple. The protocol ID, height, block hash, event root, object-state root, chained root,
and object counters must match. Each pipeline keeps its own signed parser and indexer release
identity, so those identities are returned but are not required to be identical.

The gateway verifies agreement before the data read and again afterward. If the canonical height,
roots, signer, or signed release changes during the read, the response is withheld.

Missing, malformed, stale, mismatching, untrusted, or otherwise unverifiable signed data returns
HTTP 503 with `status` and `error` set to `verification_unavailable`. A data lookup that does not
exist remains HTTP 404. Mainnet verified responses are disabled by default and require the explicit
`TANDEM_VERIFIED_MAINNET_ENABLED=true` operator setting.

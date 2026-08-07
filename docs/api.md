# API

The complete, always current API reference is generated from these controllers and published at
<https://bitcoinuniverse.github.io/index-tandem/build/api-reference/>. A running instance also serves
the same document at `/docs` as an interactive UI and at `/docs-json` as raw JSON.

Regenerate the committed document after changing a route:

```text
npm run openapi:emit
```

That writes `site/src/data/openapi.json`, and `test/openapi-contract.spec.ts` fails if the committed
document no longer matches the controllers.

## The two surfaces

`/tandem` answers from this pipeline's own view. It makes no claim that any other implementation
agrees, and it is the right surface for operating and debugging one node.

`/tandem/verified` is fail closed. Before returning any data it requires a signed agreement tuple
from this pipeline and an independently signed tuple from pipeline B at the same canonical height,
verifies both signatures against the configured trust maps, and compares these nine fields:

```text
protocol_id  height  block_hash  event_root  object_state_root
chained_root  founding_created  all_objects  active_objects
```

The four release identity fields are signed and returned but deliberately not compared, because two
independent implementations are expected to be different code.

Verification runs again after the data read. If the canonical height, roots, signer, or signed
release changed during the read, the response is withheld.

Every HTTP 200 on that surface carries a top-level `verification` object alongside `data`.

Missing, malformed, stale, mismatching, untrusted, or otherwise unverifiable signed data returns
HTTP 503 with this exact body, whichever check failed:

```json
{ "status": "verification_unavailable", "error": "verification_unavailable" }
```

A data lookup that does not exist remains HTTP 404. Mainnet verified responses are disabled unless
`TANDEM_VERIFIED_MAINNET_ENABLED=true` is set deliberately.

## Operational routes

`GET /health` is process liveness only. `GET /ready` is the authoritative dependency and
synchronization check and returns HTTP 503 until every gate passes. `GET /metrics` returns Prometheus
text exposition.

Do not gate traffic on `/health`. The container health check probes it, so a container can report
healthy while `/ready` is refusing.

## Carrier address lookups

Address routes accept the native SegWit P2WSH address of a carrier. Pipeline A validates the
network-specific Bech32 checksum, derives the 32-byte witness program, and matches it against an
indexed, database-generated program reconstructed from the persisted state keys. It does not depend
on an optional or externally supplied address label.

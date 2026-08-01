# API

All protocol routes are under `/v1/tandem`.

| Route | Purpose |
| --- | --- |
| `GET /status` | Bound deployment and current readiness snapshot |
| `GET /objects/:objectKey` | Object and chapter history |
| `GET /carriers/:txid/:vout` | Carrier state for an exact outpoint |
| `GET /events/:txid` | Canonical events for a transaction |
| `GET /invalid-events` | Paginated invalid observations |
| `GET /reorgs` | Paginated reorg journal |
| `GET /stats` | Canonical aggregate counts |
| `GET /agreement/:height` | Signed checkpoint envelope when available |

`GET /health` is process liveness. `GET /ready` returns HTTP 503 until configuration, MySQL,
Bitcoin Core identity and sync, the canonical tip, a checkpoint, and the signing boundary are ready.
`GET /metrics` returns Prometheus text exposition.


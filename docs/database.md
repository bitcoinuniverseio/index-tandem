# Database model

MySQL, eleven tables, two migrations, managed with TypeORM. The full page with column detail is
published at <https://bitcoinuniverseio.github.io/index-tandem/operate/mysql/>.

Run migrations against an empty, dedicated database:

```text
npm run migration:run
```

Nothing runs them automatically outside Compose. MySQL commits DDL implicitly, so a migration that
fails halfway has to be recovered by hand rather than rolled back.

## Tables

| Table | Holds | Authoritative |
|---|---|---|
| `tandem_blocks` | One row per indexed height, keyed by height, with a unique block hash. | Yes |
| `tandem_transactions` | Transactions that matter to Tandem, keyed by txid and unique on block height and transaction index. | Yes |
| `tandem_events` | Every protocol event in block order, unique on height, transaction index and event index. | Yes |
| `tandem_objects` | One row per object, keyed by object key and unique on the creating txid. | Yes |
| `tandem_states` | The state sequence per object, keyed by outpoint and unique on object key and sequence. | Yes |
| `tandem_carriers` | Carrier outputs, keyed by outpoint and indexed by object and creation height. | Yes |
| `tandem_chapters` | Chapters, unique per txid and per object sequence. | Yes |
| `tandem_checkpoints` | Per-height roots and counters. Readiness and agreement signing both depend on these. | Yes |
| `tandem_mempool` | Unconfirmed observations, keyed by txid. | No. Never contributes to authoritative state, counters or roots. |
| `tandem_conflicts` | Detected conflicts, indexed by resolution status and detection height. | Evidence |
| `tandem_reorg_journal` | Rollback records, indexed by detection time. | Evidence |

The separation in that last column is the important part. Mempool rows live in their own table, and
nothing in the counter or root computation reads them.

## The carrier program column

The second migration adds a generated column to `tandem_states`:

```sql
carrier_program CHAR(64) GENERATED ALWAYS AS (
  LOWER(SHA2(UNHEX(CONCAT('5221', key_0, '21', key_1, '52ae')), 256))
) STORED
```

That is the SHA256 of the reconstructed 2 of 2 witness script, computed by the database from the two
stored keys rather than supplied by a caller. The address lookup route validates a native SegWit
P2WSH address, derives its 32-byte witness program, and matches it against this column through
`ix_tandem_states_carrier_program`. Because the column is generated, an address lookup cannot be
tricked by a stored label, and there is no label to keep in step.

## Reorganization rollback

Rollback runs as one `SERIALIZABLE` transaction. It locks the tip and the ancestor, writes the
journal row, deletes authoritative material above the ancestor height, and rebuilds derived state
behind a fail-closed guard. It never crosses `initHeight - 1`, so the deployment's own INIT can never
be rolled away.

## Sizing

No sizing measurement has been recorded for this repository on any network, so it publishes no table
of expected disk, memory or catch-up time. The shape of the cost is knowable from the schema:
authoritative growth is dominated by `tandem_events` and `tandem_states`, both of which grow with
protocol activity rather than with chain height, while `tandem_blocks` grows with indexed height.

## Backup and recovery

Back up MySQL with a tool matched to your recovery objective and test the restore into a separate
environment. After a restore, compare the latest stored block hash with Bitcoin Core and let the
normal reorg path reconcile, but only once the backup has been preserved. A restore into a database
built under a different deployment binding is a different protocol and must not be used.

# Security policy

Report vulnerabilities privately to the Bitcoin Universe security contact before public disclosure.
Do not include signing keys, RPC credentials, database credentials, raw wallet material, or user data
in an issue.

The following conditions are safety failures: accepting an unexpected Bitcoin network, indexing an
unconfigured INIT, crossing the reorg boundary below the deployment, mixing mempool state into the
canonical tables, signing an incomplete checkpoint, or reporting ready without all runtime checks.


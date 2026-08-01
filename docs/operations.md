# Operations

1. Pin Node 22.23.1 and npm 10.9.8.
2. Set a real deployment tuple. Placeholder hashes in `.env.example` are not launch parameters.
3. Run migrations against an empty, dedicated MySQL database.
4. Connect a dedicated Bitcoin Core node and verify its reported chain before indexing.
5. Configure ZMQ only as a wake-up channel. Always reconcile from RPC.
6. Load the Ed25519 signing key through a secret manager. Never place it in source control.
7. Compare signed tuples against pipeline B at every published height.
8. Alert and stop dependent writes when readiness is false, agreement is missing, or roots differ.

No external service verification has been performed by the repository scaffold itself.

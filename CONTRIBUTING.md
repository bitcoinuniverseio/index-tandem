# Contributing

This repository is one implementation of Tandem. It does not own the protocol, and it is not allowed
to redefine it.

## Ground rules

1. The specification in [bitcoinuniverseio/tandem](https://github.com/bitcoinuniverseio/tandem) is
   authoritative. If this repository disagrees with it, this repository has a bug.
2. Do not copy anything from pipeline B, the Rust verifier, to make the two agree. The comparison
   between them is only worth something while they are independent.
3. Do not describe an unreleased, ungated or unexercised capability as available. Every page here
   carries a stage label for exactly this reason.
4. Mempool observations never contribute to authoritative state, counters or roots. A change that
   blurs that line will not be accepted.

## Before you open a pull request

```text
npm install
npm run verify
```

`verify` runs `biome check`, `tsc --noEmit`, the Vitest suite and the build. CI runs the same command
plus `npm audit --audit-level=high` on the shared self-hosted pool.

If you touched a controller or a DTO, regenerate the API document and commit it:

```text
npm run openapi:emit
```

`test/openapi-contract.spec.ts` fails when the committed document no longer matches the controllers,
and the documentation workflow fails the build if `site/src/data/openapi.json` is out of date. The
reference on the site is generated from that file, so it cannot describe a route the service does not
have.

If you touched the site, run its own gate:

```text
npm run docs:install
npm run docs:verify
```

That regenerates the API document, enforces the writing rules, type checks, builds, generates the
social preview images and the static endpoints, checks every internal link, and runs the
documentation tests.

## Writing rules, enforced

`site/scripts/check-prose.mjs` runs over `site/src`, `site/scripts`, `docs/` and `README.md` and
fails the build on:

- em dashes and their lookalikes, anywhere, including code;
- marketing filler and stock phrases;
- version labelling, because there is one Tandem rather than a numbered series of them.

Write plainly, say what the software actually does, and prefer a table or a diagram to three
paragraphs.

## Changes that need more than a green suite

| Change | Also required |
|---|---|
| Protocol interpretation | A specification citation, and a test for the exact case. |
| The agreement tuple or the verified gateway | Confirmation that the nine compared fields and the four uncompared release identity fields are unchanged, and that pipeline B still interoperates. |
| Database schema | A migration, and a note on what happens to an existing database. |
| Configuration | An update to `.env.example`, `docs/configuration.md` and `site/src/data/env-vars.ts`. |
| A workflow | Keep the self-hosted runner label. GitHub-hosted runner labels are not permitted in this organization. |

## Documentation manifest

`docs.manifest.json` must keep validating against the organization documentation manifest schema.
Update `lastVerified.commit` when the facts in it are re-checked, and declare only contract files
that exist.

## Security

A parser, signature, root or reorg discrepancy is a security matter. Follow [`SECURITY.md`](SECURITY.md)
and do not open a public issue.

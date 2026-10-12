# Contributing

Read AGENTS.md and docs/DEVELOPMENT.md. Use Node22+, TypeScript ESM, UTF-8/LF and two spaces.
Run npm ci, npm test, npm run test:package and node bin/cc.js --help.

Tests use synthetic loopback responses and isolated state only. Never commit credentials,
customer records, API dumps or private screenshots. Live authentication/data/write scope
requires authorization. Do not infer CC entitlement from BI/STS or reuse their tokens.

Keep embedded help, docs, tests and package allowlists aligned. No release/publication,
remote setup, commit or push without authorization. Contributions use the MIT license.
Support/security contact: support@muneris.dk.

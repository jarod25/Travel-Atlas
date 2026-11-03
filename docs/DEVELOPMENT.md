# Development

## Prerequisites

- Node.js 24 LTS
- pnpm 10.34.9 (`npm install -g pnpm@10.34.9`)
- PostgreSQL + PostGIS for database integration tests only

```sh
git clone https://github.com/jarod25/Travel-Atlas.git
cd Travel-Atlas
pnpm install
pnpm dev
```

The web client and API start locally. The API's `GET /health` is a minimal readiness check; it is not a database connectivity check.

## Commands

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

**Integration tests:** set `DATABASE_URL` to a dedicated test database with PostGIS available. Do not point it at production, personal data, or another project's database.

PowerShell example (substitute your own username, port, and password; do not paste credentials into chat):

```powershell
$env:DATABASE_URL = 'postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/atlas_lot0'
pnpm test:integration
```

The test creates a **temporary table** and synthetic geometries. CI uses a disposable PostGIS service. The first pnpm install creates `pnpm-lock.yaml`; commit the generated lockfile in the next setup PR and switch CI to `--frozen-lockfile`.

## Git workflow

1. Bootstrap shared repository configuration on `main`.
2. Use `develop` as the integration branch.
3. Branch from `develop` using `feature/<english-kebab-case>`.
4. Keep commits and pull requests in English, preferably Conventional Commits.
5. Merge via pull requests after CI and review; do not force-push protected branches.
6. Merge tested releases to `main`, create a tag and GitHub Release, and synchronize any fixes back to `develop`.

For behavioral changes, use pragmatic **red → green → refactor** development. Tests for external routing should mock HTTP responses in CI; never make reliable CI depend on an experimental public routing API.

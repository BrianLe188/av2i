# av2i: Visual Cloud Infrastructure Provisioning

Design AWS infrastructure on a canvas (nested VPC → Subnet → EC2/RDS, S3), get validated
Terraform out.

## Layout

| Path | What |
|---|---|
| `packages/core` | Framework-free domain logic: resource definitions, nesting rules, auto-resize, CIDR helpers, validation, graph → Terraform. Shared by web and api. |
| `apps/api` | NestJS + TypeORM. Projects, version snapshots, Terraform export. |
| `apps/web` | React + Vite + React Flow canvas, property panel, live Terraform/issues panels. |

## Run

```bash
npm install
npm run dev        # core (watch) + api :3000 + web :5173
npm test           # core unit tests
```

### Sign-in (GitHub)

Routes: `/login`, `/` (project dashboard), `/projects/:id` (canvas). Everything but `/login` needs a session.

1. Create a GitHub OAuth app (Settings → Developers → New OAuth App) with callback URL
   `http://localhost:5173/api/auth/github/callback`.
2. `cp apps/api/.env.example apps/api/.env` and fill `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`.
3. Optional, local review only: `DEV_LOGIN=true` adds a "Continue as dev user" button (ignored in production).

The first account to sign in inherits any projects created before auth existed.

The API stores data in a local sql.js file (`apps/api/data/av2i.sqlite`) by default.
For PostgreSQL: `npm run db:up` and set `DATABASE_URL=postgres://av2i:av2i@localhost:5432/av2i`.

## Known gaps (prototype)

- Auth is GitHub-only with a signed 7-day cookie (no revocation). The OAuth scope is `read:user`; repo access for opening PRs will need a wider scope. Not tested against real GitHub yet (no OAuth app was available).
- `synchronize: true` creates the schema; switch to migrations before deploying.
- Connections have meaning for these pairs only (IGW↔Route table, NAT↔Route table, Route table↔Subnet, EC2 or Lambda↔RDS, EC2 or Lambda↔S3, Load balancer↔EC2, DNS record↔Load balancer); anything else is rejected. Generated Terraform is checked with `tofu validate` in Docker (`npm run test:tofu -w @av2i/core`, opt-in; first run downloads the AWS provider).
- Palette HTML5 drag-and-drop was verified by dispatching drop events, not with a real mouse drag.

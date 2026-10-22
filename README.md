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

## Canvas shortcuts

Shift-drag selects several resources (Cmd/Ctrl-click adds one). With several selected, the side panel aligns and distributes them (within one container). Cmd/Ctrl+C / V / D copy, paste and duplicate (nested resources and the connections between them come along; pasted subnets get a free CIDR, buckets a new name), Esc clears the selection, Cmd/Ctrl+Z / Shift+Z undo and redo. "Export PNG" (top right of the canvas) downloads the diagram, and the minimap sits bottom right.

## Cost and security

- **Cost tab:** rough monthly cost from on-demand list prices (`packages/core/src/cost.ts`, us-east-1 with a coarse regional factor). Usage-based services (S3, Lambda, CloudFront, data transfer) are listed but not priced. Prices are hard-coded and will drift.
- **Security:** generated Terraform defaults to IMDSv2, encrypted EC2 root volumes and RDS storage, 7-day RDS backups, and blocked public access on S3. `packages/core/src/security.ts` flags what it can't fix: world-open ports (databases are errors), databases in public subnets, plain-HTTP public load balancers and CloudFront origins. Findings show a "Security" tag in the Issues tab.

## Known gaps (prototype)

- Auth is GitHub-only with a signed 7-day cookie (no revocation). The OAuth scope is `read:user`; repo access for opening PRs will need a wider scope. Not tested against real GitHub yet (no OAuth app was available).
- `synchronize: true` creates the schema; switch to migrations before deploying.
- Connections have meaning for a fixed set of pairs (see `PAIRS` in `packages/core/src/edges.ts`: routing, security group attachment, database and S3 access, load balancer targets, CloudFront origins, DNS aliases); anything else is rejected. Generated Terraform is checked with `tofu validate` in Docker (`npm run test:tofu -w @av2i/core`, opt-in; first run downloads the AWS provider).
- Palette HTML5 drag-and-drop was verified by dispatching drop events, not with a real mouse drag.

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

The API stores data in a local sql.js file (`apps/api/data/av2i.sqlite`) by default.
For PostgreSQL: `npm run db:up` and set `DATABASE_URL=postgres://av2i:av2i@localhost:5432/av2i`.

## Known gaps (prototype)

- No auth yet (GitHub login is planned); every project is visible to anyone who can reach the API.
- `synchronize: true` creates the schema; switch to migrations before deploying.
- Connections have meaning for five pairs only (IGW↔Route table, Route table↔Subnet, EC2↔RDS, Load balancer↔EC2, EC2↔S3); anything else is rejected. ALB is HTTP-only, and generated Terraform has not been run through `terraform validate`.
- Palette HTML5 drag-and-drop was verified by dispatching drop events, not with a real mouse drag.

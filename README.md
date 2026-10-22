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

## Sharing, import and the database

- **Share:** the editor's Share button creates a secret read-only link (`/s/<token>`): viewers see the canvas, Terraform, issues and cost without signing in and cannot edit. Stop sharing revokes it.
- **Import Terraform:** on the projects page. Paste or pick `.tf` files; av2i draws the AWS resources it understands and lists what it skipped. It reads literal values only (no variables, modules, `count`, `for_each`), and puts Lambda functions outside a VPC aside. Security groups come in with all their rules (IPv6 and prefix-list sources are skipped). Round-tripping av2i's own output reproduces the same resources and connections (tested), except av2i's automatic per-resource security groups, which are regenerated.
- **Migrations:** the schema changes only through TypeORM migrations in `apps/api/src/migrations` (run on startup). After changing an entity: `npm run migration:generate -w @av2i/api -- src/migrations/Name`, then add the class to `src/database.ts`. A database created before migrations existed is adopted as is. `npm test -w @av2i/api` runs end-to-end API tests (auth, ownership, sharing) against a temporary database.

## Security groups

- **Rules:** a Security group node has any number of inbound and outbound rules. Each has a protocol (TCP, UDP, ICMP or all traffic), ports for TCP/UDP (`22, 443, 8000-8100`, empty = every port), a source or destination (anywhere, a CIDR, or another security group on the canvas) and an optional description. Terraform gets one `aws_vpc_security_group_*_rule` per port range. Groups saved with the older single-rule fields are read as the equivalent rules.
- **How many groups AWS gets:** a resource with no group attached gets one of its own (`Managed by av2i for …`). Connect a Security group node to it and that group replaces the managed one; connect the same group to several resources and they share it (it is created once, and identical rules are emitted once because AWS rejects duplicates). A VPC's *Default security group* field does the same for every resource in the VPC that has none attached.
- **Connection rules with drawn groups:** database access and load balancer targets add their rule to the first group of the receiving resource, naming the first group of the sending one, unless the group already has that exact rule. The load balancer's listener is opened to the internet automatically only on a managed group; with a drawn group, its own rules decide (the Issues tab warns when none allows the listener port).

## UI and canvas layout

- **UI:** shadcn/ui (Radix, Nova preset) on Tailwind v4, in `apps/web/src/components/ui`. Add more with `npx shadcn@latest add <component>` from `apps/web`. Light/dark follows the system. Only canvas styling lives in `styles.css`.
- **Connections** are routed by `routeEdges` (`packages/core/src/route.ts`): right-angled paths on a grid that go around every resource that is not one of the connection's ends, prefer to stay inside their container, and keep off each other's lanes. They are recomputed when anything moves. The label shows on hover or selection, and selecting a resource fades the connections that don't touch it.
- **Auto layout** (top right of the canvas, undoable) arranges everything with ELK (`apps/web/src/layout.ts`, loaded on first use): containers hold their children, connected resources sit side by side, nothing overlaps. Projects created from a template or an import are laid out the same way.

## Canvas shortcuts

Shift-drag selects several resources (Cmd/Ctrl-click adds one). With several selected, the side panel aligns and distributes them (within one container). Cmd/Ctrl+C / V / D copy, paste and duplicate (nested resources and the connections between them come along; pasted subnets get a free CIDR, buckets a new name), Esc clears the selection, Cmd/Ctrl+Z / Shift+Z undo and redo. "Export PNG" (top right of the canvas) downloads the diagram, and the minimap sits bottom right.

## Cost and security

- **Cost tab:** rough monthly cost from on-demand list prices (`packages/core/src/cost.ts`, us-east-1 with a coarse regional factor). Usage-based services (S3, Lambda, CloudFront, data transfer) are listed but not priced. Prices are hard-coded and will drift.
- **Security:** generated Terraform defaults to IMDSv2, encrypted EC2 root volumes and RDS storage, 7-day RDS backups, and blocked public access on S3. `packages/core/src/security.ts` flags what it can't fix: world-open ports (databases are errors), databases in public subnets, plain-HTTP public load balancers and CloudFront origins. Findings show a "Security" tag in the Issues tab.

## Known gaps (prototype)

- Auth is GitHub-only with a signed 7-day cookie (no revocation). The OAuth scope is `read:user`; repo access for opening PRs will need a wider scope. Not tested against real GitHub yet (no OAuth app was available).
- Connections have meaning for a fixed set of pairs (see `PAIRS` in `packages/core/src/edges.ts`: routing, security group attachment, database and S3 access, load balancer targets, CloudFront origins, DNS aliases); anything else is rejected. Generated Terraform is checked with `tofu validate` in Docker (`npm run test:tofu -w @av2i/core`, opt-in; first run downloads the AWS provider).
- Palette HTML5 drag-and-drop was verified by dispatching drop events, not with a real mouse drag.

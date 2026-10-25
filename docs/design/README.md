# Implementation design

How the specification in [../spec](../spec/README.md) becomes software. Nothing here is built yet. Choices that need the
owner's answer are in [decisions.md](decisions.md) with a recommendation; the rest of this file assumes the recommendations.

## Principle

The specification is the single source of truth. Code never copies a fact from it (a limit, a trust principal, a Terraform
argument name); it reads them from a **registry** compiled from the front matter. A change to a service file changes the
product without a code change, and a change to a rule's meaning is a code change that a test must catch.

## Pipeline

```
docs/spec (markdown + YAML)
   │  1 compile (build time)
   ▼
registry.json   services, mechanisms, matrix, limits, rule metadata, i18n strings
                         │
user's Design (JSON) ──► 2 normalize ──► 3 derive facts ──► 4 validate ──► 5 plan ──► 6 emit
                         explicit graph   public/private,    findings       resources    HCL files +
                         (derived and     egress, s3_path    (VAL, SEC)     and order    deployer policy
                          generated
                          elements added)
```

| Stage | Input | Output | Spec it reads |
|---|---|---|---|
| 1 compile | `docs/spec/**/*.md` | `registry.json`, TypeScript types | all front matter; [conventions](../spec/00-conventions.md) |
| 2 normalize | Design | NormalizedDesign: every implied node and edge made explicit, each marked `origin` and `because` | mechanisms flagged derived or generated; D-005, D-006, D-012, D-022, D-025, D-030 |
| 3 derive facts | NormalizedDesign | facts: `public(subnet)`, `internet_egress(w)`, `s3_path(w, bucket)` | [egress-path](../spec/relations/egress-path.md), [route](../spec/relations/route.md) |
| 4 validate | NormalizedDesign + facts | `Finding[]` with rule ID, severity, targets, i18n message | [rules](../spec/rules/validation.md) |
| 5 plan | NormalizedDesign | Terraform resources, local names, dependency order | [resource-map](../spec/terraform/resource-map.md), [pitfalls](../spec/terraform/pitfalls.md) |
| 6 emit | plan | `*.tf` files, `versions.tf`, deployer IAM policy (D-028) | D-001, [pitfalls](../spec/terraform/pitfalls.md) |

Each stage is a pure function. The same code runs in the browser (instant feedback while the user draws) and on a server
(export, API). The platform never holds AWS credentials and never runs `apply`; it produces files (assumption, DD-010).

## Packages

```
packages/
  registry/    compiler from docs/spec to registry.json and generated types      (stage 1)
  model/       Design and NormalizedDesign types, JSON Schema, graph helpers
  engine/      normalize, derive, plan                                           (stages 2, 3, 5)
  rules/       one implementation per VAL and SEC rule                            (stage 4)
  generator/   HCL printer and file layout                                        (stage 6)
  testkit/     fixtures, scenario and case runners, conformance checks
  authz/       IAM-style policy evaluation for the accounts (DD-021)
apps/
  cli/         `av2i validate|generate design.json`
  web/         canvas, panels, i18n (later; interface design phase)
  api/         accounts, sessions and persistence (DD-021)
```

A pnpm workspace in TypeScript. TypeScript is chosen because the same engine must run in the browser and on the server and
because the previous version already used React, XYFlow and TypeScript (DD-001).

## Data model

The design graph is a list of nodes and a list of edges ([data-model.md](data-model.md) has the full shape).

- A **node** has an immutable `key` (used for Terraform names), a `service` ID from the registry, `props` using Terraform
  argument names, and an optional `parent` (nesting gives `containment`, `igw-attach` and `nat-placement`).
- An **edge** has a `mechanism` ID from the registry, `from` and `to` node keys, and mechanism-specific `props`. The matrix
  decides whether an edge may exist; the mechanism file decides what it generates.
- Nothing derived is stored in the user's Design. Normalization adds it, so changing a spec rule or D-025 never requires a
  data migration.

## Rules

A rule's `check` is a sentence, not code (DD-004). Each rule ID has a TypeScript implementation in `packages/rules` that
receives a read-only context and returns findings. Three tests keep the code honest:

1. **Coverage:** CI fails if a rule ID in the registry has no implementation, or an implementation has no registry entry.
2. **Cases:** every case in [rules/cases.md](../spec/rules/cases.md) is run, and `fires` must match.
3. **Scenarios:** every base scenario produces no `error` finding, and every variant fires exactly the listed rules
   ([scenarios](../spec/scenarios/00-index.md)).

## Generation

The generator prints HCL from an internal tree (DD-005): blocks, attributes and expressions, with references as raw
expressions such as `aws_subnet.private_a.id`. Files are split by service group, names are stable, and every resource
carries only the arguments the spec lists. CI runs three checks on every scenario base design:

- golden files: the output equals the committed expected files;
- `tofu fmt -check`: the output is canonical;
- `tofu init -backend=false` and `tofu validate` with the pinned provider `~> 6.66.0`: the output is valid.

Local names come from the node `key`, not its label, so renaming a box on the canvas never renames a resource (a rename in
Terraform state means destroy and create, or a `moved` block).

## Milestones

| # | Slice | Done when |
|---|---|---|
| M0 | registry compiler, JSON Schema for every spec file kind, schema check in CI | every file in `docs/spec` validates; types generated. **Compiler, schemas and cross-reference checks done** (`packages/registry`); generated TypeScript types and CI wiring remain |
| M1 | networking end to end: VPC, subnet, IGW, NAT, EIP, route table, SG, S3 endpoint; EC2 | [ec2-in-vpc](../spec/scenarios/ec2-in-vpc.md) (an executable scenario written for this milestone) generates and `tofu validate` passes. **Done**: 40 of 174 rules implemented, 24 variants pass, golden files, and 11 generated designs pass `tofu fmt -check`, `init` and `validate` with OpenTofu 1.12.9 and provider 6.66.0 (`pnpm --filter @av2i/testkit tofu-check`, runs in Docker) |
| M2 | rules for the networking and compute groups, with their cases | all their cases and scenario variants pass. **Done for the nine networking and compute services**: 46 of 174 rules implemented (every rule whose services are all among them), 29 variants and 85 converted cases pass (cases carry a `patch` on a base scenario, DD-009), and 12 generated designs pass `tofu fmt -check`, `init` and `validate`; one container serves the whole `tofu-check` run (about ten minutes, most of it `tofu init`). Rules that also touch other services (VAL-070, 109, 125..127, SEC-023, 044 and others) wait for those services |
| M3 | containers, storage and database | [container-service](../spec/scenarios/container-service.md) needs a load balancer (M4), so M3 runs [container-backend](../spec/scenarios/container-backend.md), an executable scenario written for it. **Done**: ECS Fargate (cluster and service), ECR, S3, RDS, Lambda and the roles they run as, with 109 of 174 rules implemented. Of the rest in scope, ten hold by construction (the platform writes the trust policy, the policy attachments, the inline policy names and the S3 egress rule itself: SEC-039, SEC-040, VAL-104, 105, 115, 118, 119, 120, 126, 127) and four wait for something else (SEC-016 is a hint, SEC-044 needs a bucket policy from M4, VAL-035 needs the image's architecture, VAL-066 needs the approved dedicated classes); 51 need a service of M4. 100 variants (70 of them in the new scenario) and 86 cases pass, and 46 generated designs pass `tofu fmt -check` and `validate` (`tofu init` runs once and the designs are checked four at a time, about four minutes). The studio offers the new services, their connections and forms |
| M4 | delivery: ALB, Route 53, ACM, CloudFront | [static-site-cdn](../spec/scenarios/static-site-cdn.md) and [three-tier-web](../spec/scenarios/three-tier-web.md), run as two executable scenarios: [alb-web](../spec/scenarios/alb-web.md) (HTTPS ALB, Fargate target, certificate, alias, access logs) and [static-site](../spec/scenarios/static-site.md) (private bucket behind CloudFront with a us-east-1 certificate). **Done**: ALB with listeners and target groups, ACM with DNS validation and provider aliases, Route 53 zones with alias, validation and hand-written records, CloudFront with origin access control, managed policies by data source and merged bucket policies; 155 of 174 rules implemented (the 19 left: 15 hold by construction, SEC-016 is a hint, VAL-035 and VAL-066 as before, VAL-098 needs the origin's domain), 166 variants across four scenarios pass, and 77 generated designs pass `tofu fmt -check` and `validate`. The studio offers the four services and their connections. The EC2 and database halves of three-tier-web were already covered by M2 and M3 |
| M5 | IAM, required roles, grants, deployer policy | [serverless-api](../spec/scenarios/serverless-api.md) and every grant case, run as the executable scenario [serverless-backend](../spec/scenarios/serverless-backend.md). **Done**: roles, derived required roles, grants and managed policies came with M3; M5 adds customer managed policies (a node, attached by a grant connection, checked by the same rules as a raw policy), the rules over them (VAL-107, 108, 117, 120, SEC-036 to 038 and 042 read every document that applies to a role) and `deployer-policy.json`, the IAM permissions the person who applies the files needs, scoped to the design's roles, passing and attaching limited (DD-020). 20 variants, and 87 generated designs pass `tofu fmt -check` and `validate`. Not done: the role slots and grant levels are still tables in code that a test keeps equal to the registry rows (the spec says a new row should be enough); RDS IAM database authentication and Secrets Manager grants wait for Tier 2 and for a matrix cell that allows them; the deployer policy lists IAM permissions only |
| M6 | web canvas on the engine | [ui.md](ui.md). **First version done** in `apps/studio` (React, Vite, React Flow; `pnpm studio`): palette, canvas with nesting and connections checked against the matrix, inspector forms from the registry, live problems, Terraform and resource tabs, templates with variants, zip and JSON export, undo and redo, VI and EN. Nine services at first; M3 added six |
| A1 | accounts: server, login, users | [DD-021](decisions.md). `apps/api` (Fastify, Kysely, PostgreSQL), `packages/authz`; the studio sits behind a login. **Done**: first start creates `admin`/`admin` (or `ADMIN_INITIAL_PASSWORD`) that must change its password before anything else works; server-side sessions with hashed tokens; throttling and account lock; built-in policies and a pure evaluator; user create, reset, disable and policy assignment with a last-administrator guard; audit log; login, forced change, account menu and a users and audit dialog in the studio; Dockerfile and `compose.yaml`. 27 API tests against a real PostgreSQL. Not done: projects and versions on the server (A2), groups and policy editing in the interface (A3), sharing and API tokens (A4) |
| A2 | projects and versions on the server | [DD-021](decisions.md). `projects`, `project_versions` and `project_shares` (migration 0002); list, create, read, save with a revision check, soft delete, snapshots, named versions and restore; the canvas opens `/projects/:id`, saves on its own, shows who saved first and lets the person choose, has a history dialog and a view-only mode; dashboard and projects page list them; a browser draft can be saved as a project. 14 API tests against PostgreSQL, 8 for the save queue. Not done: managing shares (A4), groups and policies in the interface (A3) |
| A3 | groups and policies in the interface | [DD-021](decisions.md). Groups (members, policies, delete), customer policies (JSON editor that validates as you type, example statements, action reference, delete with force), a permission check that shows which statement decided, groups on the users page, and sidebar entries by permission. The last-administrator rule now covers groups. 8 group and 8 policy tests against PostgreSQL. Not done: managing project shares (A4), API tokens, SSO |
| A4 | sharing projects | [DD-021](decisions.md). Share a project with a user or a group as viewer or editor: list, add, change role and remove (`project:Share`), a pick list of users and groups, audit entries, and a Share dialog on the canvas that only appears for people allowed to share. 7 API tests against PostgreSQL. Not done: API tokens, SSO |
| A4b | API tokens | [DD-021](decisions.md). Personal tokens for scripts and CI: shown once, hashed in the database, with a name, an expiry and an optional scope of actions; bearer authentication that never exceeds the person's rights; revoke, expiry and disabled accounts stop them; they cannot manage tokens or the password; account page section. 13 API tests against PostgreSQL, 3 for the scope helper. Not done: SSO |

IAM is not last because it is least important; M1 to M4 use only the roles the scenarios need, hard-wired through the
assume-role registry until M5 generalizes them.

## What the specification still lacks for implementation

These are gaps found while designing, to be fixed in the spec rather than worked around in code.

1. **Scenario variants are prose.** `change` is a sentence. A test needs a patch (add, remove, set on the Design). DD-008.
2. **Case inputs are ad hoc.** Each case in `cases.md` uses its own keys. Each needs a fixture adapter, or to be rewritten as
   a small Design. DD-009.
3. **Rule checks that bundle conditions** (12 listed in `needs_split`): ten are implemented and tested one condition per case in `packages/testkit/test/splits.test.ts`; VAL-066 and SEC-016 are deferred in the registry.
4. **No JSON Schema yet** for service, relation and rule files; the conventions are prose. M0 writes them.
5. **Heterogeneous front matter.** Service `properties`, mechanism `properties` and registry tables use different shapes.
   M0 either normalizes them in the compiler or tightens the conventions.

# AWS connections (R2a)

Status: decided (owner, 27 October 2026: all six questions answered as recommended). Part of DD-023 (see DD-025 in `decisions.md`).

R1 lets a run use whatever `AWS_*` variables the server has. That is one identity for every project and every run, with the
rights of whatever key the server holds. R2a replaces it with **connections**: a connection says which role a project's runs
assume in a customer account, and the platform keeps no long-lived AWS secret to do it.

## 1. What the user sees

**Set up (an administrator, once per AWS account)**
1. Opens **AWS connections** and presses *New connection*: a name, the ARN of the **plan role** (read only) and, optionally, the ARN of
   the **apply role** (can write). Without an apply role the connection is *plan only*.
2. The platform makes an **ExternalId** and shows a short guide for the AWS side: the identity of this server (the principal that
   will assume the roles), the **trust policy** to paste into each role (with the ExternalId), and a **read-only policy** for the plan
   role. Everything has a *Copy* button.
3. Presses **Test**. For each role the page says whether the server could assume it and which account it landed in, or what went wrong
   in words ("the role does not trust this server: check its trust policy and the ExternalId").

**Use (a person who plans)**
4. In the Plan dialog of a project they pick the connection (only the ones they may use). The dialog's checklist shows the role the
   run will assume and the account, from a real `AssumeRole`, before anyone presses Plan.
5. Plan runs as that role. The log's first line says which role and session.

**What changes for R1 projects.** A project with no connection cannot be planned. For a development machine the old behaviour can be
switched on for the whole server (`RUN_WITH_SERVER_IDENTITY=true`); the Plan dialog then says "using the server's own identity".

## 2. How it works

```
 run starts ──▶ base identity of the server ──▶ sts:AssumeRole(plan or apply role, ExternalId, session name)
                (instance role, container role,        │
                 or an IAM user that may only          ▼
                 call sts:AssumeRole)         temporary keys (about 1 hour)
                                                       │
                              env of the tofu process only: AWS_ACCESS_KEY_ID / SECRET / SESSION_TOKEN
```

- The **base identity is never given to tofu.** Today the process inherits every `AWS_*` of the server; from R2a it gets only the
  temporary keys of the assumed role, plus the few settings that are not credentials (`AWS_ENDPOINT_URL*`, `AWS_CA_BUNDLE`,
  `AWS_REGION`, `AWS_DEFAULT_REGION`).
- The **session name** is `av2i-<user>-<run>` (characters AWS allows, at most 64), so CloudTrail shows who asked.
- The three temporary values join the secrets masked in the log. They are not written to a file.
- A run that lasts longer than the keys cannot be refreshed (role chaining caps a session at one hour), so `RUN_TIMEOUT_MINUTES`
  above 55 is reduced to 55 at start, with a warning.
- Plan runs assume the **plan role**; apply runs (R2b) the **apply role**. Apply is disabled for a connection with no apply role.
- Both roles must be in the **same account**; the account is read from the ARN, never typed.
- The ExternalId is made by the platform (32 random bytes, hex) and cannot be edited. It is not a secret between the platform and AWS,
  but it stops another AWS customer from making this server assume a role by guessing an ARN (the confused deputy problem), so only
  people with `connection:Manage` see it.

## 3. Data

New migration `0006_connections.sql`.

```sql
create table aws_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  plan_role_arn text not null,
  apply_role_arn text,                 -- null: plan only
  external_id text not null,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_test jsonb                      -- { plan: {ok, arn?, account?, error?}, apply: {...} }
);
create unique index aws_connections_name_idx on aws_connections (lower(name));

alter table projects add column connection_id uuid references aws_connections (id) on delete restrict;

alter table runs add column connection_id uuid references aws_connections (id) on delete set null;
alter table runs add column role_arn text;       -- the role the run assumed
alter table runs add column aws_account text;
```

- Only ARNs and the ExternalId are stored: no key, no secret.
- A connection that a project uses cannot be deleted (`restrict`, answered as 409 `connection_in_use`).
- A run copies `connection_id`, the role and the account when it is queued, so what it ran as stays known after the project is changed.
  Apply (R2b) refuses a plan whose connection is not the project's current one, like a changed design.

**ARN rule.** `^arn:aws(-[a-z]+)*:iam::\d{12}:role/[\w+=,.@/-]{1,512}$`; plan and apply roles must name the same account.

## 4. Permissions

Two new actions, both on `av2i:connection/<id>`:

| Action | Meaning |
|---|---|
| `connection:Manage` (exists) | create, change, test and delete connections; see ARNs, ExternalId and policies |
| `connection:Use` (new) | pick a connection for a project, and run with it |

`connection:Use` makes a connection a real boundary: a person who may plan a project (`run:Plan`) still cannot plan against an account
they were not given. The server checks both, on the project and on the connection, when a run is queued. The owner of a project does
not get `connection:Use` by being the owner; an administrator grants it by policy (resource `av2i:connection/<id>` or `*`).
No built-in policy other than `Administrator` includes it.

## 5. API

| Call | Needs | Notes |
|---|---|---|
| `GET /api/connections` | Manage or Use | Manage: everything. Use only: `id`, `name`, `description`, `account` of the connections they may use |
| `POST /api/connections` | Manage | body `name`, `description`, `planRoleArn`, `applyRoleArn?`; makes the ExternalId; 201 |
| `GET /api/connections/:id` | Manage | adds `externalId`, `usedBy` (projects), and the generated `trustPolicy` and `planPolicy` |
| `PATCH /api/connections/:id` | Manage | name, description, role ARNs (`applyRoleArn: null` removes it); a change clears the last test |
| `DELETE /api/connections/:id` | Manage | 409 `connection_in_use` while a project uses it |
| `POST /api/connections/:id/test` | Manage | assumes each role and calls `sts:GetCallerIdentity` with it; stores and returns the result |
| `GET /api/server-identity` | Manage | who the server is, and from where (`env`, `container`, `instance`, `none`) |
| `PUT /api/projects/:id/connection` | `project:Write` and `connection:Use` | body `connectionId` or `null` |
| `GET /api/projects/:id/preflight` | `run:Plan` | now also assumes the plan role and reports role, account and the assumed ARN (cached 60 s per connection) |

`POST /api/projects/:id/runs` additionally needs a connection (or the server-identity switch), `connection:Use` on it, and fails with
`no_connection`, `connection_forbidden`, or `assume_failed` (with the AWS reason) otherwise. Every change to a connection, its test and
a project's choice is audited (`connection.created`, `.updated`, `.deleted`, `.tested`, `project.connection_set`); never the keys.

**Errors worth naming.** `AccessDenied` from `AssumeRole` is shown as "the role does not trust this server, or the ExternalId differs"
(AWS does not say which). `ExpiredToken` or `InvalidClientTokenId` on the base identity is "the server's own key is not valid".

## 6. What the platform generates for the AWS side

- **Trust policy** (same for both roles of a connection):

  ```json
  { "Version": "2012-10-17", "Statement": [{ "Effect": "Allow",
      "Principal": { "AWS": "<principal of this server>" }, "Action": "sts:AssumeRole",
      "Condition": { "StringEquals": { "sts:ExternalId": "<ExternalId>" } } }] }
  ```

  The principal comes from `sts:GetCallerIdentity`: an IAM user ARN as it is; for a role, the `assumed-role` ARN is turned into the role ARN
  (`arn:aws:iam::<account>:role/<name>`). A role with a path is shown with a warning, because the STS answer leaves the path out.
- **Plan policy**: a read-only template with `Describe*`, `List*` and `Get*` of the services the platform knows (EC2/VPC, RDS, S3, IAM, ELB,
  ECS, ECR, Lambda, Route 53, CloudFront, ACM, CloudWatch Logs, KMS, Secrets Manager's `DescribeSecret`, WAFv2). AWS's managed `ReadOnlyAccess`
  is the simple alternative; the page says so.
- **Apply policy: not generated.** `deployer-policy.json` (DD-020) covers only the IAM part, and DD-020 says the rest is not enumerated yet.
  The page says that the apply role needs the rights to create what the design draws, recommends against `AdministratorAccess`, and links the
  deployer policy for the IAM part. A least-privilege apply policy for every service is its own piece of work (see "Not in R2a").

## 7. Studio

- **AWS connections** in the side menu, for people with `connection:Manage`: a list (name, account, plan role, apply role or "plan only", last
  test, number of projects), *New connection*, and a page per connection with the form, the AWS-side guide (copy buttons), *Test*, and the
  projects that use it. Deleting asks for confirmation and is blocked while it is in use.
- **Plan dialog**: a *Connection* row with a select of the connections the person may use (or "none"), saved at once; the checklist's
  identity line becomes "Role: arn… · Account: 123…" from the assumed role. With no connection the line says what to do.
- Texts in Vietnamese and English like the rest.

## 8. Code

- `apps/api/src/aws.ts`: `AwsGateway { callerIdentity(creds?), assumeRole(...) }` with the real implementation (`@aws-sdk/client-sts`); injected
  through `buildApp` so tests use a fake; `principalOf(arn)`; `sessionName(user, run)`; `trustPolicy(...)`; `planPolicy()`.
- `apps/api/src/runs/credentials.ts`: picks the identity for a run (connection, or the server identity if switched on) and returns the
  environment of the tofu process and the secrets to mask. `runner.ts` stops copying `AWS_*` and uses it.
- `apps/api/src/routes/connections.ts`, plus the project route and the changes in `runs.ts` and the preflight.
- `packages/authz`: `connection:Use`, `resource.connection`.
- Studio: `ConnectionsPage`, `ConnectionPage`, `ConnectionGuide`, the row in `RunDialog`, routes, menu entry, texts.

## 9. Tests

- Unit: ARN rule and the same-account rule, `principalOf` (user, role, assumed role, with a path), session name (characters, length), the trust
  policy, the environment of a run (no base `AWS_*`, only the temporary keys and the allowed settings), masking of the three values.
- API with a fake gateway: who may manage and who may use, create and change validation, delete in use, test result stored, a project cannot
  choose a connection its owner may not use, a run needs the connection and `connection:Use` on top of `run:Plan`, assume failure becomes a failed
  request with the reason, audit entries carry no key.
- Real OpenTofu through Moto (manual, like before): `AssumeRole` works in Moto, so the whole path (base keys, assume, run as the temporary keys,
  masking) can be run without an AWS account. Moto does not enforce trust policies, so that part is checked only against real AWS.

## 10. Not in R2a

Apply and approval (R2b); a least-privilege apply policy for all services; rotating the ExternalId; several connections or environments per
project; the S3 state backend with the connection (R3); sharing one connection's use through project shares.

## 11. Questions for the owner (all answered as recommended)

1. **`connection:Use` as its own permission** (recommended), or may any project owner pick any connection?
2. **A project with no connection cannot be planned**, with `RUN_WITH_SERVER_IDENTITY=true` as the escape for development (recommended), or fall
   back to the server identity silently?
3. **Both roles in the same account**, enforced (recommended)?
4. **The ExternalId is generated and not editable**; rotation later (recommended)?
5. **Plan policy as a read-only template, apply policy not generated yet** (recommended), or hold R2a until an apply policy exists?
6. **One connection per project** for now (recommended)?

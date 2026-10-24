# Conventions

Rules for every file in this specification. They exist so the front matter can be parsed later and so two
authors describe the same thing the same way.

## 1. File format

Every file under `services/`, `relations/`, `rules/` and `scenarios/` is markdown that starts with YAML front
matter. The front matter of `rules/validation.md` and `rules/security.md` holds `source_aliases` (alias to URL); the rules themselves are one
fenced `yaml` block in the body, and a rule's `source` is an alias, a URL, or `null` only while its status is `unverified`. The front matter is the machine-readable part and the source of truth. The body explains it to a human
and must not contradict it.

## 2. Identifiers

- IDs are lowercase `kebab-case` English: `security-group`, `nat-gateway`, `sg-attach`.
- Service IDs are stable and never reused. Renaming needs an entry in [decisions.md](decisions.md).
- Rule IDs are `VAL-<nnn>` for validation and `SEC-<nnn>` for security, numbered in order of creation and never
  reused, even after a rule is retired.
- Property keys use the Terraform argument name exactly (`vpc_security_group_ids`), never a translation.
- AWS names (service names, IAM actions such as `s3:GetObject`, resource types such as `aws_subnet`) are written
  in English and never translated.

## 3. Language (i18n)

- Anything shown to a user is an object with both languages: `{ vi: "...", en: "..." }`. Vietnamese is the
  default.
- Technical terms stay in English inside Vietnamese text (for example "gắn Security Group vào EC2").
- Identifiers, property keys, Terraform names and IAM actions are never in a language object.
- Prose in the body of these files is English so it stays consistent with the AWS documentation it cites.

## 4. Service file

Path: `services/<id>.md`.

```yaml
id: security-group                 # stable ID
title: { vi: ..., en: ... }
terraform:
  resources: [aws_security_group, aws_vpc_security_group_ingress_rule, aws_vpc_security_group_egress_rule]
scope: vpc                         # global | regional | vpc | subnet | az
placement:
  requires: [vpc]                  # what it must live in
  subnet_type: null                # public | private | any | null
  min_azs: null                    # minimum availability zones when it spans several
properties:
  - key: name
    type: string                   # string | number | boolean | enum | list | map | reference | json
    required: false
    default: null
    constraints: ["must not start with 'sg-'", "max 255 characters"]
    force_new: true                # changing it replaces the resource
    source: <url>
    status: verified
limits:
  - { id: rules_per_security_group, value: 60, adjustable: true, source: <url>, status: verified }
relations: [sg-attach, sg-reference]   # mechanism IDs this service takes part in
cost: { model: free | usage | hourly | mixed, notes: ... }
status: verified
```

Body sections, in this order, all required (write "None." when empty):

1. **Purpose**: what it is for, when to use it, when not to.
2. **Behaviour**: how it works, including defaults that surprise people.
3. **Placement**: where it can exist and why.
4. **Relations**: each mechanism it takes part in, linking to `relations/`.
5. **Failure modes**: what goes wrong and the error AWS or Terraform reports.
6. **Limits, cost, security**.
7. **Terraform mapping**: resource and arguments, `ForceNew` arguments, ordering and dependency notes.
8. **Sources**.

## 5. Relation (mechanism) file

Path: `relations/<mechanism>.md`. A mechanism is a kind of connection, not a pair of services. One mechanism
can join many pairs.

```yaml
id: sg-attach
title: { vi: ..., en: ... }
participants:
  - { role: group, service: security-group }
  - { role: member, service: [ec2, ecs, rds, alb, lambda] }
direction: undirected              # a->b | undirected
same_vpc: true                     # participants must be in the same VPC
cardinality: { group: many, member: many }   # per participant: one | many
conditions:
  - { text: { vi: ..., en: ... }, when: "lambda is attached to a VPC" }
generates:                         # what the platform must emit
  - { terraform: "vpc_security_group_ids", on: member }
effects:                           # consequences on other resources, if any
  - ...
invalid_when: [VAL-014]            # rule IDs from rules/
failure_modes: [ ... ]
source: <url>
status: verified
```

## 6. Rule file

Path: `rules/validation.md` and `rules/security.md`. One YAML block per rule inside the file.

```yaml
- id: VAL-014
  severity: error                  # see section 7
  applies_to: [sg-attach]          # mechanism or service IDs
  check: "a resource has at most 5 security groups"
  message: { vi: ..., en: ... }
  fix: { vi: ..., en: ... }
  source: <url>
  status: verified
```

`check` is a precise statement a test can be written from, not a description of intent.

## 7. Severity

| Value | Meaning | Platform behaviour |
|---|---|---|
| `error` | AWS or Terraform would reject it, or the design cannot work | Block export |
| `warning` | Deploys but is probably not what the user wants (no route to the internet, public exposure) | Show, allow export |
| `info` | Useful, no action needed (cost, naming) | Show quietly |

Security rules use the same scale. A world-open database port is `error`, a world-open SSH port is `warning`.

## 8. Matrix cells

In `relations/matrix.md` each ordered pair of services gets exactly one value, never blank:

- `valid`: allowed, names the mechanism.
- `conditional`: allowed under a stated condition, names the mechanism and the condition.
- `invalid`: not allowed, states why in one line.
- `none`: AWS has no direct relationship between them.

## 9. Status and sources

- `status` is `verified` or `unverified` (see the [README](README.md#verification)).
- `source` is a URL to the AWS documentation or the Terraform provider documentation page that states the fact.
  A `verified` entry without a `source` is invalid.
- When the AWS documentation and the provider behaviour disagree, record both and note the difference in the
  body under Failure modes.
- To avoid repeating long URLs, a file may declare a `sources` map of short aliases (`S1: <url>`) in its front
  matter and then cite them with `src: [S1, S2]` or `(S1)` in prose. The aliases are local to the file. A
  `src` entry counts as the `source` required above.
- Where a value is `unverified` inside an otherwise `verified` entry, say which part in a comment or note.

## 10. Writing rules

- State facts, not advice, in `behaviour` and `limits`. Advice goes in security rules or the body.
- Give numbers with the unit and whether the limit can be raised.
- Do not describe a behaviour you have not checked as `verified`.
- Do not duplicate: link to the owning file by ID.

## 11. Scenario files

A scenario is a reference design written so a test can be built from it. Front matter keys:

```yaml
id: three-tier-web
title: { vi: ..., en: ... }
services: [vpc, subnet, ...]            # service IDs used
nodes:                                   # one entry per resource drawn
  - { id: alb, service: alb, props: { internal: false } }
connections:                             # drawn, derived or generated links
  - { from: alb, to: app, mechanism: listener-target, kind: drawn }   # kind: drawn | derived | generated
expect:
  errors: []                             # rule IDs that must not fire on the base design
  findings: [SEC-028]                    # warning and info rules that are expected to fire
variants:                                # each variant mutates the base design and names what must fire
  - { id: one-subnet-alb, change: "...", fires: [VAL-071], severity: error }
```

An **executable** scenario (`executable: true`) carries a full `design` (the saved shape in [design/data-model.md](../design/data-model.md))
instead of `nodes` and `connections`, and each variant has a `patch` list of operations on that design (`set`, `unset`, `add-node`,
`remove-node`, `add-edge`, `remove-edge`; nodes and edges are addressed by key, see DD-012). `kind: drawn` is created by the user, `derived` is computed and reported, `generated` is produced by the platform from
other connections. A variant lists every rule that must fire; a test also checks that no other `error` appears. A variant that removes a finding of the base design (a Lambda function that leaves the VPC no longer holds the interface permissions) lists it under `clears`; the test then expects the base findings minus `clears`, plus `fires`.
Every rule ID must exist in [rules/validation.md](rules/validation.md) or [rules/security.md](rules/security.md).

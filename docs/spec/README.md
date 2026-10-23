# AWS infrastructure specification

Machine-readable specification of the AWS services in scope, how each one behaves, and how they relate. It
exists so the platform is built from one consistent model instead of from patches. Read
[00-conventions.md](00-conventions.md) before reading or writing any other file.

## Scope

| Item | Decision |
|---|---|
| Services | Tier 1 only (list below) |
| Partition | AWS commercial (`aws`). GovCloud and China are out of scope |
| Infrastructure as code | Terraform / OpenTofu (HCL). CloudFormation and CDK are out of scope |
| AWS provider | `~> 6.0` (see [version pinning](#version-pinning)) |
| OpenTofu | `>= 1.10` |
| UI language | Vietnamese by default, English selectable. Technical terms follow AWS naming in English |

### Services in scope

| Group | Services |
|---|---|
| Networking | VPC, Subnet, Internet Gateway, NAT Gateway, Route Table, Security Group, VPC Endpoint (S3 gateway) |
| Compute | EC2, Lambda |
| Containers | ECS (Fargate), ECR |
| Storage | S3 |
| Database | RDS (PostgreSQL, MySQL) |
| Delivery | ALB, Route 53, CloudFront |
| Security | IAM (roles and policies), ACM |

Deferred (Tier 2/3): DynamoDB, ElastiCache, SQS, SNS, EventBridge, API Gateway, Secrets Manager, SSM, KMS,
Cognito, CloudWatch, VPC Endpoint, WAF, EKS, Auto Scaling Group and everything else. The mechanisms in
[relations/00-mechanisms.md](relations/00-mechanisms.md) are written so these can be added without reshaping
the model.

## Layout

```
docs/spec/
├── README.md                this file
├── 00-conventions.md        file schemas, ID rules, i18n rules, severity scale, status values
├── 01-glossary.md           AWS terms (en) with explanations (vi/en)
├── services/                one file per service
├── relations/
│   ├── 00-mechanisms.md     catalogue of relation mechanisms
│   ├── matrix.md            service x service: valid | conditional | invalid
│   └── <mechanism>.md       detail per mechanism
├── rules/
│   ├── validation.md        VAL-xxx: is the design deployable
│   └── security.md          SEC-xxx: is the design safe
├── scenarios/               reference architectures and edge cases
├── terraform/
│   ├── resource-map.md      what each service and mechanism generates
│   └── pitfalls.md          ForceNew, dependency cycles, ordering, required arguments
├── limits.md                quotas, with sources
├── sources.md               documents used
└── decisions.md             decision log and open questions
```

UI concerns (labels on the palette, which properties appear in the panel, layout) are deliberately not part of
this specification. They belong to the interface design phase.

## Verification

Every technical claim carries a `status`:

- `verified`: checked against the AWS documentation or the Terraform provider documentation, with a `source`.
- `unverified`: general knowledge, not yet checked. Treat as a hypothesis.

A file is complete only when no `unverified` entry remains in it, or each remaining one is listed in
[decisions.md](decisions.md) as an open question.

## Version pinning

- The provider constraint `~> 6.0` allows any 6.x release. Before implementation starts, pick one exact minor
  release, record it in [decisions.md](decisions.md) and commit the lock file, because patch releases have
  occasionally been withdrawn.
- The newest 6.x release and the newest OpenTofu release were not confirmed against official pages when this
  was written (status: `unverified`). Confirm on the Terraform Registry and the OpenTofu releases page.

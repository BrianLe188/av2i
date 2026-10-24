---
id: scenarios-index
title: { vi: "Các kịch bản tham chiếu", en: "Reference scenarios" }
scenarios: [ec2-in-vpc, three-tier-web, serverless-api, container-service, static-site-cdn, isolated-private-app]
rules_total: 174
rules_covered: 104
rules_not_covered: [VAL-009, VAL-014, VAL-015, VAL-018, VAL-019, VAL-020, VAL-022, VAL-023, VAL-024, VAL-025, VAL-026, VAL-027, VAL-033, VAL-050, VAL-053, VAL-055, VAL-056, VAL-057, VAL-059, VAL-060, VAL-061, VAL-063, VAL-064, VAL-065, VAL-066, VAL-068, VAL-069, VAL-072, VAL-073, VAL-075, VAL-076, VAL-077, VAL-078, VAL-079, VAL-080, VAL-082, VAL-083, VAL-084, VAL-086, VAL-090, VAL-092, VAL-095, VAL-097, VAL-098, VAL-103, VAL-104, VAL-107, VAL-108, VAL-109, VAL-114, VAL-115, VAL-117, VAL-118, VAL-119, VAL-120, VAL-121, SEC-005, SEC-009, SEC-014, SEC-016, SEC-018, SEC-020, SEC-021, SEC-022, SEC-025, SEC-033, SEC-037, SEC-038, SEC-039, SEC-040]
status: unverified
---

# Reference scenarios

Six designs, each a base that must produce no `error` plus variants that each break one thing and name the rules that
must fire (see [conventions section 11](../00-conventions.md#11-scenario-files)).

| Scenario | Shows |
|---|---|
| [ec2-in-vpc](ec2-in-vpc.md) | the first **executable** scenario: a full design with machine-applied patches, run by the engine in `packages/testkit` |
| [serverless-backend](serverless-backend.md) | the executable scenario of M5: an ALB in front of two Lambda functions, one in the VPC from an image, a drawn role with grants and a customer managed policy, and the deployer policy, with 20 variants |
| [alb-web](alb-web.md) | the executable scenario of M4 for load balancers: an HTTPS ALB in front of a Fargate service with a certificate, an alias record and access logs, with 35 variants |
| [static-site](static-site.md) | the executable scenario of M4 for delivery: a private bucket behind CloudFront with a us-east-1 certificate and Route 53 records, with 31 variants |
| [container-backend](container-backend.md) | the second **executable** scenario (M3): ECS Fargate, ECR, RDS, S3 and Lambda in a VPC, with 70 variants |
| [three-tier-web](three-tier-web.md) | public, private and database tiers, NAT per AZ, ALB, Multi-AZ RDS, certificate and DNS |
| [serverless-api](serverless-api.md) | Lambda behind an ALB, one function in the VPC and one outside, image from ECR |
| [container-service](container-service.md) | ECS Fargate with task and execution roles, ECR, ALB, RDS |
| [static-site-cdn](static-site-cdn.md) | S3 through CloudFront with OAC, ACM in us-east-1, Route 53 aliases |
| [isolated-private-app](isolated-private-app.md) | no internet path at all, and what the platform reports |

## Coverage

The scenarios touch 104 of 174 rules. The 70 not listed in the front matter are mostly single-property checks
(CIDR ranges, name formats, numeric limits, a policy statement's shape). A scenario does not test them; they need one unit
test per rule, built from the `check` sentence; those cases are written in [rules/cases.md](../rules/cases.md). Rules about relations between resources are the ones scenarios cover.

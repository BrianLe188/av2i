---
id: serverless-backend
title: { vi: "API serverless: ALB, Lambda, S3, RDS, IAM", en: "Serverless API: ALB, Lambda, S3, RDS, IAM" }
services: [vpc, subnet, internet-gateway, route-table, vpc-endpoint-s3, security-group, lambda, ecr, alb, rds, db-subnet-group, s3, acm, route53, iam-role, iam-policy]
executable: true
design:
  schema: 1
  name: serverless-backend
  settings: { region: ap-southeast-1 }
  nodes:
    - { key: vpc, label: "API", service: vpc, props: { cidr_block: "10.4.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
    - { key: igw, label: "Internet gateway", service: internet-gateway, parent: vpc, props: {} }
    - { key: pub_a, label: "Public A", service: subnet, parent: vpc, props: { cidr_block: "10.4.0.0/24", availability_zone: ap-southeast-1a } }
    - { key: pub_b, label: "Public B", service: subnet, parent: vpc, props: { cidr_block: "10.4.1.0/24", availability_zone: ap-southeast-1b } }
    - { key: priv_a, label: "Private A", service: subnet, parent: vpc, props: { cidr_block: "10.4.10.0/24", availability_zone: ap-southeast-1a } }
    - { key: priv_b, label: "Private B", service: subnet, parent: vpc, props: { cidr_block: "10.4.11.0/24", availability_zone: ap-southeast-1b } }
    - { key: rt_public, label: "Public routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_priv, label: "Private routes", service: route-table, parent: vpc, props: {} }
    - { key: s3ep, label: "S3 endpoint", service: vpc-endpoint-s3, parent: vpc, props: { policy: {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": ["arn:aws:s3:::av2i-example-uploads/*"]}]} } }
    - { key: sg_alb, label: "alb-sg", service: security-group, parent: vpc, props: { name: alb-sg, description: "Load balancer", ingress_rules: [{ ip_protocol: tcp, from_port: 80, to_port: 80, cidr_ipv4: "0.0.0.0/0" }, { ip_protocol: tcp, from_port: 443, to_port: 443, cidr_ipv4: "0.0.0.0/0" }] } }
    - { key: sg_fn, label: "fn-sg", service: security-group, parent: vpc, props: { name: fn-sg, description: "Data function" } }
    - { key: sg_db, label: "db-sg", service: security-group, parent: vpc, props: { name: db-sg, description: "Database" } }
    - { key: alb, label: "API ALB", service: alb, parent: pub_a, props: { name: api-alb, drop_invalid_header_fields: true, enable_deletion_protection: true, listeners: [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-TLS13-1-2-2021-06", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "redirect", "status_code": "HTTP_301", "port": "443", "protocol": "HTTPS"}}] } }
    - { key: cert, label: "Certificate", service: acm, props: { domain_name: api.example.com, validation_method: DNS } }
    - { key: zone, label: "example.com", service: route53, props: { name: example.com } }
    - { key: edge_fn, label: "Edge function", service: lambda, props: { function_name: edge, filename: edge.zip, handler: index.handler, runtime: nodejs22.x } }
    - { key: data_fn, label: "Data function", service: lambda, parent: priv_a, props: { function_name: data, image_tag: v1, timeout: 30 } }
    - { key: repo, label: "Images", service: ecr, props: { name: data-fn, image_tag_mutability: IMMUTABLE, image_scanning_configuration: { scan_on_push: true } } }
    - { key: db_group, label: "Database subnets", service: db-subnet-group, parent: vpc, props: { name: data-db } }
    - { key: db, label: "Database", service: rds, parent: vpc, props: { engine: postgres, instance_class: db.t3.micro, allocated_storage: 20, username: app, deletion_protection: true } }
    - { key: uploads, label: "Uploads", service: s3, props: { bucket: av2i-example-uploads } }
    - { key: data_role, label: "Data role", service: iam-role, props: { name: api-data, managed_policies: ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole", "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"] } }
    - { key: audit, label: "Audit metrics", service: iam-policy, props: { name: api-audit, description: "Publish metrics", policy: {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["cloudwatch:PutMetricData"], "Resource": "*", "Condition": {"StringEquals": {"cloudwatch:namespace": "Backend"}}}]} } }
  edges:
    - { id: e_rt_public_igw, mechanism: route, from: rt_public, to: igw, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_public_a, mechanism: route-association, from: rt_public, to: pub_a }
    - { id: e_rt_public_b, mechanism: route-association, from: rt_public, to: pub_b }
    - { id: e_rt_priv_s3, mechanism: route, from: rt_priv, to: s3ep }
    - { id: e_rt_priv_a, mechanism: route-association, from: rt_priv, to: priv_a }
    - { id: e_rt_priv_b, mechanism: route-association, from: rt_priv, to: priv_b }
    - { id: e_alb_b, mechanism: containment, from: pub_b, to: alb }
    - { id: e_fn_b, mechanism: containment, from: priv_b, to: data_fn }
    - { id: e_dbg_a, mechanism: containment, from: priv_a, to: db_group }
    - { id: e_dbg_b, mechanism: containment, from: priv_b, to: db_group }
    - { id: e_db_group, mechanism: db-subnet-group, from: db, to: db_group }
    - { id: e_sg_alb, mechanism: sg-attach, from: sg_alb, to: alb }
    - { id: e_sg_fn, mechanism: sg-attach, from: sg_fn, to: data_fn }
    - { id: e_sg_db, mechanism: sg-attach, from: sg_db, to: db }
    - { id: e_alb_edge, mechanism: listener-target, from: alb, to: edge_fn }
    - { id: e_alb_data, mechanism: listener-target, from: alb, to: data_fn }
    - { id: e_cert_alb, mechanism: cert-attach, from: cert, to: alb }
    - { id: e_zone_alb, mechanism: dns-alias, from: zone, to: alb, props: { name: api.example.com } }
    - { id: e_repo_data, mechanism: image-source, from: repo, to: data_fn }
    - { id: e_data_db, mechanism: network-access, from: data_fn, to: db }
    - { id: e_role_data, mechanism: assume-role, from: data_role, to: data_fn }
    - { id: e_role_uploads, mechanism: grant, from: data_role, to: uploads, props: { level: readwrite } }
    - { id: e_role_audit, mechanism: grant, from: data_role, to: audit }
expect:
  errors: []
  findings: [SEC-008, SEC-028, SEC-034]
patch_ops:
  - "see ec2-in-vpc for the six patch operations (DD-012)"
variants:
  - { id: no-endpoint, change: "the S3 endpoint is removed from the private route table", patch: [{"op": "remove-edge", "mechanism": "route", "from": "rt_priv", "to": "s3ep"}], fires: [VAL-070], severity: warning }
  - { id: public-subnet-attach, change: "the data function is also attached to a public subnet", patch: [{"op": "add-edge", "edge": {"id": "e_fn_pub", "mechanism": "containment", "from": "pub_a", "to": "data_fn"}}], fires: [VAL-038, VAL-070], severity: warning }
  - { id: one-subnet, change: "the data function in one subnet", patch: [{"op": "remove-edge", "mechanism": "containment", "from": "priv_b", "to": "data_fn"}], fires: [VAL-037], severity: warning }
  - { id: subnets-no-sg, change: "the data function has subnets and no security group", patch: [{"op": "remove-edge", "mechanism": "sg-attach", "from": "sg_fn", "to": "data_fn"}], fires: [SEC-004, VAL-029, VAL-036], severity: error }
  - { id: no-vpc-to-db, change: "the edge function calls the database", patch: [{"op": "add-edge", "edge": {"id": "e_edge_db", "mechanism": "network-access", "from": "edge_fn", "to": "db"}}], fires: [VAL-049], severity: error }
  - { id: missing-vpc-policy, change: "the data role lacks the VPC permissions", patch: [{"op": "set", "node": "data_role", "path": "props.managed_policies", "value": ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]}], clears: [SEC-008], fires: [VAL-111], severity: error }
  - { id: dedicated-tenancy, change: "the VPC uses dedicated tenancy", patch: [{"op": "set", "node": "vpc", "path": "props.instance_tenancy", "value": "dedicated"}], fires: [VAL-039], severity: error }
  - { id: bad-timeout, change: "timeout 1200 seconds", patch: [{"op": "set", "node": "edge_fn", "path": "props.timeout", "value": 1200}], fires: [VAL-034], severity: error }
  - { id: shared-role, change: "the data role also runs the edge function", patch: [{"op": "add-edge", "edge": {"id": "e_role_edge", "mechanism": "assume-role", "from": "data_role", "to": "edge_fn"}}], fires: [SEC-041], severity: info }
  - { id: wildcard-grant, change: "a hand-written policy with s3:* on every resource", patch: [{"op": "set", "node": "data_role", "path": "props.raw_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["s3:*"], "Resource": "*"}]}}], fires: [SEC-036, SEC-038], severity: error }
  - { id: admin-role, change: "AdministratorAccess attached", patch: [{"op": "set", "node": "data_role", "path": "props.managed_policies", "value": ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole", "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole", "arn:aws:iam::aws:policy/AdministratorAccess"]}], fires: [SEC-035], severity: error }
  - { id: policy-star, change: "the customer policy allows every action", patch: [{"op": "set", "node": "audit", "path": "props.policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["*"], "Resource": "*"}]}}], fires: [SEC-036, SEC-042], severity: error }
  - { id: policy-pass-role, change: "the customer policy allows iam:PassRole", patch: [{"op": "set", "node": "audit", "path": "props.policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["iam:PassRole"], "Resource": ["arn:aws:iam::123456789012:role/other"]}]}}], fires: [SEC-042], severity: error }
  - { id: policy-service-wildcard, change: "the customer policy allows sqs:* on a queue", patch: [{"op": "set", "node": "audit", "path": "props.policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["sqs:*"], "Resource": ["arn:aws:sqs:ap-southeast-1:123456789012:q"]}]}}], fires: [SEC-038], severity: warning }
  - { id: policy-no-resource, change: "a statement without Resource", patch: [{"op": "set", "node": "audit", "path": "props.policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["sqs:SendMessage"]}]}}], fires: [VAL-117], severity: error }
  - { id: policy-bad-name, change: "a policy name with a space", patch: [{"op": "set", "node": "audit", "path": "props.name", "value": "bad name"}], fires: [VAL-120], severity: error }
  - { id: policy-detached, change: "the policy is not attached to any role", patch: [{"op": "remove-edge", "mechanism": "grant", "from": "data_role", "to": "audit"}], fires: [], severity: info }
  - { id: two-policies, change: "a second customer policy on the role", patch: [{"op": "add-node", "node": {"key": "logs_policy", "label": "Logs", "service": "iam-policy", "props": {"name": "api-logs", "policy": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"], "Resource": ["arn:aws:logs:ap-southeast-1:123456789012:log-group:/api:*"]}]}}}}, {"op": "add-edge", "edge": {"id": "e_role_logs", "mechanism": "grant", "from": "data_role", "to": "logs_policy"}}], fires: [], severity: info }
  - { id: edge-role-drawn, change: "a drawn role for the edge function with its managed policy", patch: [{"op": "add-node", "node": {"key": "edge_role", "label": "Edge role", "service": "iam-role", "props": {"name": "api-edge", "managed_policies": ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]}}}, {"op": "add-edge", "edge": {"id": "e_role_edge", "mechanism": "assume-role", "from": "edge_role", "to": "edge_fn"}}], fires: [], severity: info }
  - { id: function-image-pull, change: "the data role may also pull from the repository", patch: [{"op": "add-edge", "edge": {"id": "e_role_repo", "mechanism": "grant", "from": "data_role", "to": "repo", "props": {"level": "pull"}}}], fires: [], severity: info }
---

# Serverless backend

Two functions behind one load balancer. `edge_fn` stays outside the VPC; `data_fn` runs from a container image in two private
subnets with no NAT gateway, reaches S3 through the gateway endpoint and the database through a generated security group rule.
The role of `data_fn` is drawn by the user with its managed policies (a drawn role carries its own, DD-015), a grant on the
bucket and a customer managed policy; `edge_fn` gets a derived role. It is the executable form of
[serverless-api](serverless-api.md) and the first design to produce the deployer policy.

## What the engine derives or generates

- The execution role of `edge_fn` (D-025); `data_role` is the user's and holds exactly what is written on it.
- Two Lambda target groups, one `aws_lambda_permission` per function and attachments that wait for the permissions (DD-017).
- The customer managed policy and its attachment to `data_role`, one inline `grants` policy with the bucket statements.
- `deployer-policy.json`: the IAM permissions the person who runs `tofu apply` needs, scoped to this design's roles and policies
  (DD-020).

---
id: alb-web
title: { vi: "Web sau ALB: HTTPS, ECS Fargate, ACM, Route 53, log ra S3", en: "Web behind an ALB: HTTPS, ECS Fargate, ACM, Route 53, logs to S3" }
services: [vpc, subnet, internet-gateway, nat-gateway, elastic-ip, route-table, security-group, alb, ecs, acm, route53, s3, cloudfront, lambda, ec2, iam-role]
executable: true
design:
  schema: 1
  name: alb-web
  settings: { region: ap-southeast-1 }
  nodes:
    - { key: vpc, label: "Web", service: vpc, props: { cidr_block: "10.3.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } }
    - { key: igw, label: "Internet gateway", service: internet-gateway, parent: vpc, props: {} }
    - { key: pub_a, label: "Public A", service: subnet, parent: vpc, props: { cidr_block: "10.3.0.0/24", availability_zone: ap-southeast-1a } }
    - { key: pub_b, label: "Public B", service: subnet, parent: vpc, props: { cidr_block: "10.3.1.0/24", availability_zone: ap-southeast-1b } }
    - { key: app_a, label: "App A", service: subnet, parent: vpc, props: { cidr_block: "10.3.10.0/24", availability_zone: ap-southeast-1a } }
    - { key: app_b, label: "App B", service: subnet, parent: vpc, props: { cidr_block: "10.3.11.0/24", availability_zone: ap-southeast-1b } }
    - { key: nat_a, label: "NAT A", service: nat-gateway, parent: pub_a, props: { availability_mode: zonal, connectivity_type: public } }
    - { key: nat_b, label: "NAT B", service: nat-gateway, parent: pub_b, props: { availability_mode: zonal, connectivity_type: public } }
    - { key: rt_public, label: "Public routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_app_a, label: "App A routes", service: route-table, parent: vpc, props: {} }
    - { key: rt_app_b, label: "App B routes", service: route-table, parent: vpc, props: {} }
    - { key: sg_alb, label: "alb-sg", service: security-group, parent: vpc, props: { name: alb-sg, description: "Load balancer", ingress_rules: [{ ip_protocol: tcp, from_port: 80, to_port: 80, cidr_ipv4: "0.0.0.0/0", description: "http" }, { ip_protocol: tcp, from_port: 443, to_port: 443, cidr_ipv4: "0.0.0.0/0", description: "https" }] } }
    - { key: sg_task, label: "task-sg", service: security-group, parent: vpc, props: { name: task-sg, description: "ECS tasks" } }
    - { key: alb, label: "Web ALB", service: alb, parent: pub_a, props: { name: web-alb, drop_invalid_header_fields: true, enable_deletion_protection: true, access_logs: { enabled: true, prefix: alb }, listeners: [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-TLS13-1-2-2021-06", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "redirect", "status_code": "HTTP_301", "port": "443", "protocol": "HTTPS"}}] } }
    - { key: logs, label: "ALB logs", service: s3, props: { bucket: av2i-example-alb-logs, bucket_policy: {"Version": "2012-10-17", "Statement": [{"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": ["arn:aws:s3:::av2i-example-alb-logs", "arn:aws:s3:::av2i-example-alb-logs/*"], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]} } }
    - { key: cluster, label: "Web cluster", service: ecs, props: { part: cluster, name: web } }
    - { key: web, label: "Web", service: ecs, parent: app_a, props: { part: service, name: web, cluster: cluster, desired_count: 2, container_port: 8080, image: "public.ecr.aws/nginx/nginx:stable" } }
    - { key: cert, label: "Certificate", service: acm, props: { domain_name: app.example.com, validation_method: DNS } }
    - { key: zone, label: "example.com", service: route53, props: { name: example.com } }
  edges:
    - { id: e_rt_public_igw, mechanism: route, from: rt_public, to: igw, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_public_a, mechanism: route-association, from: rt_public, to: pub_a }
    - { id: e_rt_public_b, mechanism: route-association, from: rt_public, to: pub_b }
    - { id: e_rt_app_a_nat, mechanism: route, from: rt_app_a, to: nat_a, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_app_b_nat, mechanism: route, from: rt_app_b, to: nat_b, props: { destination_cidr_block: "0.0.0.0/0" } }
    - { id: e_rt_app_a_app, mechanism: route-association, from: rt_app_a, to: app_a }
    - { id: e_rt_app_b_app, mechanism: route-association, from: rt_app_b, to: app_b }
    - { id: e_alb_b, mechanism: containment, from: pub_b, to: alb }
    - { id: e_web_b, mechanism: containment, from: app_b, to: web }
    - { id: e_sg_alb, mechanism: sg-attach, from: sg_alb, to: alb }
    - { id: e_sg_task, mechanism: sg-attach, from: sg_task, to: web }
    - { id: e_alb_web, mechanism: listener-target, from: alb, to: web }
    - { id: e_cert_alb, mechanism: cert-attach, from: cert, to: alb }
    - { id: e_zone_alb, mechanism: dns-alias, from: zone, to: alb, props: { name: app.example.com } }
    - { id: e_alb_logs, mechanism: resource-policy, from: alb, to: logs }
expect:
  errors: []
  findings: [SEC-034]
patch_ops:
  - "see ec2-in-vpc for the six patch operations (DD-012)"
variants:
  - { id: alb-one-subnet, change: "the ALB uses only pub_a", patch: [{"op": "remove-edge", "mechanism": "containment", "from": "pub_b", "to": "alb"}], fires: [VAL-071], severity: error }
  - { id: alb-private-subnets, change: "an internet-facing ALB in the app subnets", patch: [{"op": "set", "node": "alb", "path": "parent", "value": "app_a"}, {"op": "remove-edge", "mechanism": "containment", "from": "pub_b", "to": "alb"}, {"op": "add-edge", "edge": {"id": "e_alb_app_b", "mechanism": "containment", "from": "app_b", "to": "alb"}}], fires: [VAL-074], severity: warning }
  - { id: alb-small-subnet, change: "an ALB subnet of /28", patch: [{"op": "set", "node": "pub_b", "path": "props.cidr_block", "value": "10.3.1.0/28"}], fires: [VAL-072], severity: warning }
  - { id: alb-bad-name, change: "a name that starts with a hyphen", patch: [{"op": "set", "node": "alb", "path": "props.name", "value": "-bad"}], fires: [VAL-073], severity: error }
  - { id: alb-https-no-cert, change: "an HTTPS listener without a certificate", patch: [{"op": "remove-edge", "mechanism": "cert-attach", "from": "cert", "to": "alb"}], clears: [SEC-034], fires: [VAL-075], severity: error }
  - { id: alb-bad-redirect, change: "a redirect with status 307", patch: [{"op": "set", "node": "alb", "path": "props.listeners", "value": [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-TLS13-1-2-2021-06", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "redirect", "status_code": "HTTP_307", "port": "443", "protocol": "HTTPS"}}]}], fires: [VAL-076], severity: error }
  - { id: alb-no-port, change: "the target group has no port", patch: [{"op": "unset", "node": "web", "path": "props.container_port"}], fires: [VAL-077], severity: error }
  - { id: alb-instance-target-group, change: "a Fargate service in an instance target group", patch: [{"op": "remove-edge", "mechanism": "listener-target", "from": "alb", "to": "web"}, {"op": "add-edge", "edge": {"id": "e_alb_web2", "mechanism": "listener-target", "from": "alb", "to": "web", "props": {"target_type": "instance"}}}], fires: [VAL-043], severity: error }
  - { id: alb-sg-closed, change: "the listener port 80 is closed on the ALB group", patch: [{"op": "set", "node": "sg_alb", "path": "props.ingress_rules", "value": [{"ip_protocol": "tcp", "from_port": 443, "to_port": 443, "cidr_ipv4": "0.0.0.0/0"}]}], fires: [VAL-082], severity: error }
  - { id: alb-bad-health-check, change: "a health check interval of 1 second", patch: [{"op": "remove-edge", "mechanism": "listener-target", "from": "alb", "to": "web"}, {"op": "add-edge", "edge": {"id": "e_alb_web2", "mechanism": "listener-target", "from": "alb", "to": "web", "props": {"health_check": {"interval": 1}}}}], fires: [VAL-083], severity: error }
  - { id: alb-health-check, change: "a health check on /health", patch: [{"op": "remove-edge", "mechanism": "listener-target", "from": "alb", "to": "web"}, {"op": "add-edge", "edge": {"id": "e_alb_web2", "mechanism": "listener-target", "from": "alb", "to": "web", "props": {"health_check": {"path": "/health", "matcher": "200", "interval": 15, "timeout": 5, "healthy_threshold": 2, "unhealthy_threshold": 3}}}}], fires: [], severity: info }
  - { id: alb-http-forward, change: "the HTTP listener forwards", patch: [{"op": "set", "node": "alb", "path": "props.listeners", "value": [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-TLS13-1-2-2021-06", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "forward"}}]}], fires: [SEC-024], severity: warning }
  - { id: alb-old-tls, change: "the provider's default TLS policy", patch: [{"op": "set", "node": "alb", "path": "props.listeners", "value": [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-2016-08", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "redirect", "status_code": "HTTP_301", "port": "443", "protocol": "HTTPS"}}]}], fires: [SEC-025], severity: warning }
  - { id: alb-keeps-invalid-headers, change: "invalid header fields are not dropped", patch: [{"op": "unset", "node": "alb", "path": "props.drop_invalid_header_fields"}], fires: [SEC-026], severity: info }
  - { id: alb-deletable, change: "deletion protection off", patch: [{"op": "set", "node": "alb", "path": "props.enable_deletion_protection", "value": false}], fires: [SEC-027], severity: info }
  - { id: alb-no-logs, change: "access logs off", patch: [{"op": "set", "node": "alb", "path": "props.access_logs", "value": {"enabled": false}}], fires: [SEC-028], severity: info }
  - { id: alb-fixed-response, change: "port 80 answers with a fixed response", patch: [{"op": "set", "node": "alb", "path": "props.listeners", "value": [{"port": 443, "protocol": "HTTPS", "ssl_policy": "ELBSecurityPolicy-TLS13-1-2-2021-06", "default_action": {"type": "forward"}}, {"port": 80, "protocol": "HTTP", "default_action": {"type": "fixed-response", "status_code": "503", "content_type": "text/plain", "message_body": "maintenance"}}]}], fires: [], severity: info }
  - { id: alb-lambda-target, change: "the ALB also forwards to a function", patch: [{"op": "add-node", "node": {"key": "fn", "label": "Worker", "service": "lambda", "props": {"function_name": "web-worker", "filename": "lambda.zip", "handler": "index.handler", "runtime": "nodejs22.x"}}}, {"op": "add-edge", "edge": {"id": "e_alb_fn", "mechanism": "listener-target", "from": "alb", "to": "fn"}}], fires: [], severity: info }
  - { id: alb-ec2-target, change: "the ALB also forwards to an instance", patch: [{"op": "add-node", "node": {"key": "inst", "label": "Server", "service": "ec2", "parent": "app_a", "props": {"ami": "ami-0123456789abcdef0", "instance_type": "t3.micro", "metadata_options": {"http_tokens": "required"}, "root_block_device": {"encrypted": true}}}}, {"op": "add-edge", "edge": {"id": "e_sg_inst", "mechanism": "sg-attach", "from": "sg_task", "to": "inst"}}, {"op": "add-edge", "edge": {"id": "e_alb_inst", "mechanism": "listener-target", "from": "alb", "to": "inst", "props": {"port": 80, "target_group": "servers"}}}], fires: [], severity: info }
  - { id: alb-two-kinds-in-one-group, change: "a service and a function in one target group", patch: [{"op": "add-node", "node": {"key": "fn", "label": "Worker", "service": "lambda", "props": {"function_name": "web-worker", "filename": "lambda.zip", "handler": "index.handler", "runtime": "nodejs22.x"}}}, {"op": "remove-edge", "mechanism": "listener-target", "from": "alb", "to": "web"}, {"op": "add-edge", "edge": {"id": "e_alb_web2", "mechanism": "listener-target", "from": "alb", "to": "web", "props": {"target_group": "mixed"}}}, {"op": "add-edge", "edge": {"id": "e_alb_fn", "mechanism": "listener-target", "from": "alb", "to": "fn", "props": {"target_group": "mixed"}}}], fires: [VAL-079], severity: error }
  - { id: cert-wrong-region, change: "the certificate is created in eu-west-1", patch: [{"op": "set", "node": "cert", "path": "props.region", "value": "eu-west-1"}], fires: [VAL-101], severity: error }
  - { id: cert-not-covering, change: "the certificate covers www.example.com, the alias is app.example.com", patch: [{"op": "set", "node": "cert", "path": "props.domain_name", "value": "www.example.com"}], fires: [VAL-102], severity: error }
  - { id: cert-wildcard, change: "a wildcard certificate covers the alias", patch: [{"op": "set", "node": "cert", "path": "props.domain_name", "value": "*.example.com"}], fires: [], severity: info }
  - { id: cert-no-zone, change: "the certificate's domain is in no hosted zone of the design", patch: [{"op": "set", "node": "cert", "path": "props.domain_name", "value": "app.example.org"}, {"op": "set", "node": "cert", "path": "props.subject_alternative_names", "value": ["app.example.com"]}], fires: [VAL-100], severity: error }
  - { id: cert-many-names, change: "11 names on one certificate", patch: [{"op": "set", "node": "cert", "path": "props.subject_alternative_names", "value": ["n0.example.com", "n1.example.com", "n2.example.com", "n3.example.com", "n4.example.com", "n5.example.com", "n6.example.com", "n7.example.com", "n8.example.com", "n9.example.com"]}], fires: [VAL-099], severity: error }
  - { id: zone-force-destroy, change: "force_destroy on the zone", patch: [{"op": "set", "node": "zone", "path": "props.force_destroy", "value": true}], fires: [SEC-033], severity: info }
  - { id: zone-records, change: "a TXT record and an MX record written by hand", patch: [{"op": "set", "node": "zone", "path": "props.records", "value": [{"name": "example.com", "type": "TXT", "ttl": 300, "records": ["v=spf1 -all"]}, {"name": "example.com", "type": "MX", "ttl": 300, "records": ["10 mail.example.com"]}]}], fires: [], severity: info }
  - { id: zone-record-and-alias, change: "a record with both records and alias", patch: [{"op": "set", "node": "zone", "path": "props.records", "value": [{"name": "x.example.com", "type": "A", "ttl": 60, "records": ["10.0.0.1"], "alias": {"name": "y.example.com", "zone_id": "Z", "evaluate_target_health": false}}]}], fires: [VAL-085], severity: error }
  - { id: zone-cname-at-apex, change: "a CNAME named like the zone", patch: [{"op": "set", "node": "zone", "path": "props.records", "value": [{"name": "example.com", "type": "CNAME", "ttl": 60, "records": ["other.example.net"]}]}], fires: [VAL-087], severity: error }
  - { id: zone-duplicate-record, change: "two records with one name and type", patch: [{"op": "set", "node": "zone", "path": "props.records", "value": [{"name": "a.example.com", "type": "A", "ttl": 60, "records": ["10.0.0.1"]}, {"name": "a.example.com", "type": "A", "ttl": 60, "records": ["10.0.0.2"]}]}], fires: [VAL-090], severity: error }
  - { id: logs-kms, change: "the log bucket encrypts with KMS", patch: [{"op": "set", "node": "logs", "path": "props.encryption", "value": {"sse_algorithm": "aws:kms"}}], fires: [VAL-055], severity: error }
  - { id: logs-no-transport-rule, change: "the log bucket policy has no deny for plain HTTP", patch: [{"op": "unset", "node": "logs", "path": "props.bucket_policy"}], fires: [SEC-015], severity: info }
  - { id: logs-public-policy, change: "a public statement while block_public_policy is on", patch: [{"op": "set", "node": "logs", "path": "props.bucket_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::av2i-example-alb-logs/*"}]}}], fires: [SEC-015, VAL-052], severity: error }
  - { id: logs-bad-policy, change: "a statement without a principal", patch: [{"op": "set", "node": "logs", "path": "props.bucket_policy", "value": {"Version": "2012-10-17", "Statement": [{"Effect": "Deny", "Action": "s3:*", "Resource": "*"}]}}], fires: [SEC-015, VAL-117], severity: error }
  - { id: cdn-in-front, change: "a distribution in front of the ALB", patch: [{"op": "add-node", "node": {"key": "cdn", "label": "CDN", "service": "cloudfront", "props": {"enabled": true}}}, {"op": "add-edge", "edge": {"id": "e_cdn_alb", "mechanism": "origin", "from": "cdn", "to": "alb"}}], fires: [SEC-032], severity: info }
---

# Web behind an ALB

An internet-facing Application Load Balancer in two public subnets with an HTTPS listener and an HTTP listener that redirects, a
Fargate service in two private subnets as the target, a certificate for `app.example.com` validated in the hosted zone, an alias
record, and access logs written to a bucket. It is the first executable design for milestone M4 and stands in for
[three-tier-web](three-tier-web.md), which also has instances and a database.

## What the engine derives or generates

- The target group (type `ip`, port from the container port), the listeners and the service's `load_balancer` block with a
  dependency on the listeners (DD-017).
- Ingress on `sg_task` from `sg_alb` on the container port, from the `listener-target` connection (DD-016).
- The validation record in the zone and the validation resource the listener's certificate comes from (DD-018).
- The alias record for `app.example.com`.
- One bucket policy with the log delivery statement, merged with the statement written on the bucket (DD-019).

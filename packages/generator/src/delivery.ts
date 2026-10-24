import { aliasRecords, aliasesOf, bucketPolicy, certNames, certOf, certRegion, defaultOrigin, forwardsOf, listenersOf, originsOf, targetGroupsOf, zoneFor, type Graph, type TargetGroup } from "@av2i/engine";
import type { NormalizedNode, Value } from "@av2i/model";
import { call, ref, type Block, type Expr } from "./hcl.ts";
import { blocksOf, hyphen, resource, slug, toExpr, type PlanCtx } from "./ctx.ts";

const obj = (v: Value | undefined): Record<string, Value> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Value>) : {});

/** Provider alias of a Region other than the design's (decision D-022). */
export const aliasOf = (region: string) => region.replace(/-/g, "_");

/** Regions other than the design's that a certificate is created in. */
export function aliasRegions(g: Graph): string[] {
  const own = g.design.settings.region;
  return [...new Set(g.nodesOf("acm").map((c) => certRegion(g, c)).filter((r) => r !== own))].sort();
}

/** The ARN a consumer should use for a certificate: the validation resource's when it exists, so the certificate is issued first. */
function certArn(g: Graph, cert: NormalizedNode): Expr {
  const validated = g.edges("cert-validation").some((e) => e.from === cert.key);
  return ref(validated ? `aws_acm_certificate_validation.${cert.key}.certificate_arn` : `aws_acm_certificate.${cert.key}.arn`);
}

export const listenerName = (alb: string, port: number) => `${alb}_${port}`;

const tgName = (id: string) => hyphen(id).slice(0, 32).replace(/-+$/, "");

/** The bucket policy of a bucket (one document, all statements merged) and its dependency on the access block. */
export function planBucketPolicies(c: PlanCtx): void {
  for (const b of c.g.nodesOf("s3")) {
    const statements = bucketPolicy(c.g, b);
    if (!statements.length) continue;
    const usesAccount = JSON.stringify(statements).includes("data.aws_caller_identity");
    if (usesAccount) c.once("identity", () => c.add("iam.tf", { type: "data", labels: ["aws_caller_identity", "current"], args: [] }, b.key));
    const policy = { Version: "2012-10-17", Statement: statements } as unknown as Value;
    c.add("storage.tf", resource("aws_s3_bucket_policy", b.key, [["bucket", ref(`aws_s3_bucket.${b.key}.id`)], ["policy", call("jsonencode", toExpr(policy))], ["depends_on", [ref(`aws_s3_bucket_public_access_block.${b.key}`)]]]), b.key);
  }
}

function planLoadBalancers(c: PlanCtx): void {
  const { g, add } = c;
  const groups = targetGroupsOf(g);
  for (const lb of g.nodesOf("alb")) {
    const name = typeof lb.props.name === "string" && lb.props.name ? lb.props.name : hyphen(lb.key);
    const args: [string, Expr][] = [["name", name], ["load_balancer_type", "application"], ["internal", lb.props.internal === true]];
    args.push(["subnets", g.subnetsOf(lb.key).map((s) => ref(`aws_subnet.${s.key}.id`))], ["security_groups", g.securityGroupsOf(lb.key).map((s) => ref(`aws_security_group.${s.key}.id`))]);
    args.push(...c.optional(lb, ["idle_timeout", "drop_invalid_header_fields", "enable_deletion_protection"]));
    const blocks: Block[] = [];
    const logs = g.edges("resource-policy").find((e) => e.from === lb.key && g.node(e.to)?.service === "s3");
    if (logs && g.prop(lb.key, "access_logs.enabled") === true) {
      const prefix = g.prop(lb.key, "access_logs.prefix");
      blocks.push({ type: "access_logs", labels: [], args: [["bucket", ref(`aws_s3_bucket.${logs.to}.id`)], ...(typeof prefix === "string" && prefix ? ([["prefix", prefix]] as [string, Expr][]) : []), ["enabled", true]] });
      args.push(["depends_on", [ref(`aws_s3_bucket_policy.${logs.to}`)]]);
    }
    args.push(c.tags(lb));
    add("delivery.tf", resource("aws_lb", lb.key, args, blocks), lb.key);

    for (const l of listenersOf(g, lb.key)) {
      const la: [string, Expr][] = [["load_balancer_arn", ref(`aws_lb.${lb.key}.arn`)], ["port", l.port], ["protocol", l.protocol]];
      if (l.protocol === "HTTPS") {
        la.push(["ssl_policy", l.ssl_policy ?? "ELBSecurityPolicy-TLS13-1-2-2021-06"]);
        const cert = certOf(g, lb.key);
        if (cert) la.push(["certificate_arn", certArn(g, cert)]);
      }
      let action: Block;
      if (l.action.type === "redirect") {
        action = { type: "default_action", labels: [], args: [["type", "redirect"]], blocks: [{ type: "redirect", labels: [], args: [["port", l.action.port ?? "443"], ["protocol", l.action.protocol ?? "HTTPS"], ["status_code", l.action.status_code ?? "HTTP_301"]] }] };
      } else if (l.action.type === "fixed-response") {
        action = { type: "default_action", labels: [], args: [["type", "fixed-response"]], blocks: [{ type: "fixed_response", labels: [], args: [["content_type", l.action.content_type ?? "text/plain"], ...(l.action.message_body ? ([["message_body", l.action.message_body]] as [string, Expr][]) : []), ["status_code", l.action.status_code ?? "503"]] }] };
      } else {
        const to = forwardsOf(g, lb.key, l);
        if (to.length === 1) action = { type: "default_action", labels: [], args: [["type", "forward"], ["target_group_arn", ref(`aws_lb_target_group.${to[0]!.id}.arn`)]] };
        else action = { type: "default_action", labels: [], args: [["type", "forward"]], blocks: [{ type: "forward", labels: [], args: [], blocks: to.map((t) => ({ type: "target_group", labels: [], args: [["arn", ref(`aws_lb_target_group.${t.id}.arn`)]] as [string, Expr][] })) }] };
      }
      add("delivery.tf", resource("aws_lb_listener", listenerName(lb.key, l.port), la, [action]), lb.key);
    }
  }

  for (const t of groups) planTargetGroup(c, t);
}

function planTargetGroup(c: PlanCtx, t: TargetGroup): void {
  const { g, add } = c;
  const args: [string, Expr][] = [["name", tgName(t.id)], ["target_type", t.type]];
  if (t.type !== "lambda") {
    const vpc = g.vpcOf(t.targets[0]!.key)?.key ?? g.vpcOf(t.alb)?.key;
    if (t.port !== undefined) args.push(["port", t.port]);
    args.push(["protocol", t.protocol]);
    if (vpc) args.push(["vpc_id", ref(`aws_vpc.${vpc}.id`)]);
  }
  const health = t.edges.map((e) => e.props?.health_check).find((h) => h !== undefined);
  const blocks = health ? blocksOf("health_check", health as Value) : [];
  args.push(["tags", { Name: tgName(t.id) }]);
  add("delivery.tf", resource("aws_lb_target_group", t.id, args, blocks), t.id);
  for (const target of t.targets) {
    const base = `${t.id}_${target.key}`;
    if (target.service === "ec2") {
      add("delivery.tf", resource("aws_lb_target_group_attachment", base, [["target_group_arn", ref(`aws_lb_target_group.${t.id}.arn`)], ["target_id", ref(`aws_instance.${target.key}.id`)]]), t.id);
    } else if (target.service === "lambda") {
      add("delivery.tf", resource("aws_lambda_permission", base, [["statement_id", "AllowExecutionFromAlb"], ["action", "lambda:InvokeFunction"], ["function_name", ref(`aws_lambda_function.${target.key}.function_name`)], ["principal", "elasticloadbalancing.amazonaws.com"], ["source_arn", ref(`aws_lb_target_group.${t.id}.arn`)]]), t.id);
      add("delivery.tf", resource("aws_lb_target_group_attachment", base, [["target_group_arn", ref(`aws_lb_target_group.${t.id}.arn`)], ["target_id", ref(`aws_lambda_function.${target.key}.arn`)], ["depends_on", [ref(`aws_lambda_permission.${base}`)]]]), t.id);
    }
  }
}

function planDns(c: PlanCtx): void {
  const { g, add } = c;
  for (const cert of g.nodesOf("acm")) {
    const region = certRegion(g, cert);
    const alias = region !== g.design.settings.region ? ([["provider", ref(`aws.${aliasOf(region)}`)]] as [string, Expr][]) : [];
    const sans = Array.isArray(cert.props.subject_alternative_names) ? (cert.props.subject_alternative_names as unknown[]).map(String) : [];
    const args: [string, Expr][] = [...alias, ["domain_name", String(cert.props.domain_name ?? "")]];
    if (sans.length) args.push(["subject_alternative_names", sans]);
    args.push(["validation_method", "DNS"], ...c.optional(cert, ["key_algorithm"]), c.tags(cert));
    const blocks: Block[] = [...blocksOf("options", cert.props.options ?? null), { type: "lifecycle", labels: [], args: [["create_before_destroy", true]] }];
    add("dns.tf", resource("aws_acm_certificate", cert.key, args, blocks), cert.key);

    const zones = [...new Set(certNames(cert).map((n) => zoneFor(g, n)?.key).filter((k): k is string => !!k))];
    if (!zones.length) continue;
    const dvo = `aws_acm_certificate.${cert.key}.domain_validation_options`;
    const recordNames: string[] = [];
    for (const z of zones) {
      const name = zones.length === 1 ? `${cert.key}_validation` : `${cert.key}_validation_${z}`;
      recordNames.push(name);
      const mine = certNames(cert).filter((n) => zoneFor(g, n)?.key === z);
      const filter = zones.length === 1 ? "" : ` if contains([${mine.map((n) => `"${n}"`).join(", ")}], dvo.domain_name)`;
      const forEach = ref(`{ for dvo in ${dvo} : dvo.domain_name => { name = dvo.resource_record_name, record = dvo.resource_record_value, type = dvo.resource_record_type }${filter} }`);
      add("dns.tf", resource("aws_route53_record", name, [["for_each", forEach], ["allow_overwrite", true], ["name", ref("each.value.name")], ["records", [ref("each.value.record")]], ["ttl", 60], ["type", ref("each.value.type")], ["zone_id", ref(`aws_route53_zone.${z}.zone_id`)]]), cert.key);
    }
    const fqdns = recordNames.map((n) => `[for r in aws_route53_record.${n} : r.fqdn]`);
    add("dns.tf", resource("aws_acm_certificate_validation", cert.key, [...alias, ["certificate_arn", ref(`aws_acm_certificate.${cert.key}.arn`)], ["validation_record_fqdns", ref(fqdns.length === 1 ? fqdns[0]! : `concat(${fqdns.join(", ")})`)]]), cert.key);
  }

  for (const z of g.nodesOf("route53")) {
    add("dns.tf", resource("aws_route53_zone", z.key, [["name", String(z.props.name ?? "")], ...c.optional(z, ["comment", "force_destroy"]), c.tags(z)]), z.key);
    const records = Array.isArray(z.props.records) ? z.props.records : [];
    records.forEach((r, i) => {
      const o = obj(r as Value);
      const args: [string, Expr][] = [["zone_id", ref(`aws_route53_zone.${z.key}.zone_id`)], ["name", String(o.name ?? "")], ["type", String(o.type ?? "A")]];
      if (typeof o.ttl === "number") args.push(["ttl", o.ttl]);
      if (Array.isArray(o.records)) args.push(["records", toExpr(o.records as Value)]);
      const aliasBlock = o.alias !== undefined ? blocksOf("alias", o.alias as Value) : [];
      add("dns.tf", resource("aws_route53_record", c.unique("aws_route53_record", `${z.key}_record_${i + 1}`), args, aliasBlock), z.key);
    });
  }
  for (const e of g.edges("dns-alias")) {
    for (const { name, target } of aliasRecords(g, e)) {
      const lb = target.service === "alb";
      const dns = lb ? `aws_lb.${target.key}.dns_name` : `aws_cloudfront_distribution.${target.key}.domain_name`;
      const zone = lb ? `aws_lb.${target.key}.zone_id` : `aws_cloudfront_distribution.${target.key}.hosted_zone_id`;
      const types = lb || target.props.is_ipv6_enabled !== true ? ["A"] : ["A", "AAAA"];
      for (const type of types) {
        const base = `${e.from}_${slug(name)}_${type.toLowerCase()}`;
        add("dns.tf", resource("aws_route53_record", c.unique("aws_route53_record", base), [["zone_id", ref(`aws_route53_zone.${e.from}.zone_id`)], ["name", name], ["type", type]], [{ type: "alias", labels: [], args: [["name", ref(dns)], ["zone_id", ref(zone)], ["evaluate_target_health", lb]] }]), e.id);
      }
    }
  }
}

const METHODS = { "read-only": ["GET", "HEAD"], all: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"] } as const;

function planCdn(c: PlanCtx): void {
  const { g, add } = c;
  const policyData = (kind: "cache" | "origin_request", name: string): Expr => {
    const type = kind === "cache" ? "aws_cloudfront_cache_policy" : "aws_cloudfront_origin_request_policy";
    c.once(`${type}.${name}`, () => add("cdn.tf", { type: "data", labels: [type, slug(name)], args: [["name", name]] }, name));
    return ref(`data.${type}.${slug(name)}.id`);
  };

  for (const cdn of g.nodesOf("cloudfront")) {
    const origins = originsOf(g, cdn.key);
    const blocks: Block[] = [];
    for (const o of origins) {
      if (o.node.service === "s3") {
        const oac = o.edge.props?.access !== "none";
        const args: [string, Expr][] = [["domain_name", ref(`aws_s3_bucket.${o.node.key}.bucket_regional_domain_name`)], ["origin_id", o.id]];
        if (typeof o.edge.props?.origin_path === "string") args.push(["origin_path", o.edge.props.origin_path]);
        if (oac) {
          const name = `${cdn.key}_${o.node.key}`;
          add("cdn.tf", resource("aws_cloudfront_origin_access_control", name, [["name", hyphen(name).slice(0, 64)], ["origin_access_control_origin_type", "s3"], ["signing_behavior", typeof o.edge.props?.signing_behavior === "string" ? o.edge.props.signing_behavior : "always"], ["signing_protocol", "sigv4"]]), o.edge.id);
          args.push(["origin_access_control_id", ref(`aws_cloudfront_origin_access_control.${name}.id`)]);
        }
        blocks.push({ type: "origin", labels: [], args });
      } else {
        const policy = typeof o.edge.props?.protocol_policy === "string" ? o.edge.props.protocol_policy : "https-only";
        blocks.push({
          type: "origin", labels: [],
          args: [["domain_name", ref(`aws_lb.${o.node.key}.dns_name`)], ["origin_id", o.id]],
          blocks: [{ type: "custom_origin_config", labels: [], args: [["http_port", 80], ["https_port", 443], ["origin_protocol_policy", policy], ["origin_ssl_protocols", ["TLSv1.2"]]] }],
        });
      }
    }

    const behavior = (type: string, spec: Record<string, Value>, originNode: NormalizedNode | undefined, path?: string): Block => {
      const dynamic = originNode?.service === "alb";
      const methods = METHODS[(typeof spec.methods === "string" && spec.methods === "all" ? "all" : "read-only")];
      const args: [string, Expr][] = [];
      if (path) args.push(["path_pattern", path]);
      args.push(["target_origin_id", originNode?.key ?? ""], ["viewer_protocol_policy", typeof spec.viewer_protocol_policy === "string" ? spec.viewer_protocol_policy : "redirect-to-https"]);
      args.push(["allowed_methods", [...methods]], ["cached_methods", ["GET", "HEAD"]]);
      args.push(["compress", typeof spec.compress === "boolean" ? spec.compress : true]);
      args.push(["cache_policy_id", policyData("cache", typeof spec.cache_policy === "string" ? spec.cache_policy : dynamic ? "Managed-CachingDisabled" : "Managed-CachingOptimized")]);
      const orp = typeof spec.origin_request_policy === "string" ? spec.origin_request_policy : dynamic ? "Managed-AllViewer" : undefined;
      if (orp) args.push(["origin_request_policy_id", policyData("origin_request", orp)]);
      return { type, labels: [], args };
    };
    const def = defaultOrigin(origins);
    blocks.push(behavior("default_cache_behavior", obj(cdn.props.default_cache_behavior), def?.node));
    const ordered = Array.isArray(cdn.props.ordered_cache_behavior) ? cdn.props.ordered_cache_behavior : [];
    for (const o of ordered) {
      const spec = obj(o as Value);
      blocks.push(behavior("ordered_cache_behavior", spec, typeof spec.origin === "string" ? g.node(spec.origin) : def?.node, String(spec.path_pattern ?? "")));
    }
    const geo = obj(cdn.props.restrictions);
    blocks.push({ type: "restrictions", labels: [], blocks: [{ type: "geo_restriction", labels: [], args: [["restriction_type", typeof geo.restriction_type === "string" ? geo.restriction_type : "none"], ...(Array.isArray(geo.locations) ? ([["locations", toExpr(geo.locations as Value)]] as [string, Expr][]) : [])] }], args: [] });
    const vc = obj(cdn.props.viewer_certificate);
    const cert = certOf(g, cdn.key);
    blocks.push({
      type: "viewer_certificate", labels: [],
      args: cert
        ? [["acm_certificate_arn", certArn(g, cert)], ["ssl_support_method", typeof vc.ssl_support_method === "string" ? vc.ssl_support_method : "sni-only"], ["minimum_protocol_version", typeof vc.minimum_protocol_version === "string" ? vc.minimum_protocol_version : "TLSv1.2_2021"]]
        : [["cloudfront_default_certificate", true]],
    });
    blocks.push(...blocksOf("custom_error_response", cdn.props.custom_error_response ?? null));

    const args: [string, Expr][] = [["enabled", cdn.props.enabled !== false]];
    const aliases = aliasesOf(cdn);
    if (aliases.length) args.push(["aliases", aliases]);
    args.push(...c.optional(cdn, ["comment", "default_root_object", "price_class", "http_version", "is_ipv6_enabled", "web_acl_id", "wait_for_deployment", "retain_on_delete"]), c.tags(cdn));
    add("cdn.tf", resource("aws_cloudfront_distribution", cdn.key, args, blocks), cdn.key);
  }
}

/** Load balancers with their listeners and target groups, certificates and DNS, CloudFront, and the bucket policies the relations need. */
export function planDelivery(c: PlanCtx): void {
  planLoadBalancers(c);
  planDns(c);
  planCdn(c);
  planBucketPolicies(c);
}

export type { Block };

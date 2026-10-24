import { describe, expect, it } from "vitest";
import { Graph, effectiveIngress, normalize, targetGroupsOf, zoneFor, covers } from "@av2i/engine";
import { generate } from "@av2i/generator";
import { applyPatch, type Design, type PatchOp } from "@av2i/model";
import { executableScenarios, firedRules } from "../src/index.ts";

const scenario = (id: string) => executableScenarios().find((s) => s.id === id)!.design;
const web = scenario("alb-web");
const site = scenario("static-site");
const patched = (d: Design, ...p: PatchOp[]) => applyPatch(d, p);

describe("load balancer output", () => {
  const files = generate(web);

  it("forwards to an ip target group of the container port and registers the service in it", () => {
    expect(files["delivery.tf"]).toContain('target_type = "ip"');
    expect(files["delivery.tf"]).toContain("port        = 8080");
    expect(files["compute.tf"]).toContain("load_balancer {");
    expect(files["compute.tf"]).toContain("aws_lb_listener.alb_443");
    expect(files["compute.tf"]).toContain("aws_lb_listener.alb_80");
  });

  it("takes the HTTPS certificate from the validation resource and redirects HTTP", () => {
    expect(files["delivery.tf"]).toContain("aws_acm_certificate_validation.cert.certificate_arn");
    expect(files["delivery.tf"]).toContain('status_code = "HTTP_301"');
  });

  it("lets the service's group accept the container port from the ALB's group", () => {
    const g = new Graph(normalize(web));
    const rule = effectiveIngress(g, "sg_task").find((r) => r.referenced_security_group_id === "sg_alb");
    expect(rule).toMatchObject({ from_port: 8080, to_port: 8080, generated: "network-access" });
  });

  it("writes the log delivery statement and the account data source once", () => {
    expect(files["storage.tf"]).toContain("logdelivery.elasticloadbalancing.amazonaws.com");
    expect(files["storage.tf"]).toContain("AWSLogs");
    expect(Object.values(files).join("\n").match(/data "aws_caller_identity"/g)?.length).toBe(1);
  });

  it("merges the statement written on the bucket with the generated one in one policy", () => {
    expect(files["storage.tf"]!.match(/resource "aws_s3_bucket_policy"/g)?.length).toBe(1);
    expect(files["storage.tf"]).toContain("DenyInsecureTransport");
    expect(files["storage.tf"]).toContain("AllowAlbLogsAlb");
  });

  it("gives a function target its invoke permission before the attachment", () => {
    const d = patched(web, { op: "add-node", node: { key: "fn", label: "F", service: "lambda", props: { function_name: "f", filename: "f.zip", handler: "h", runtime: "nodejs22.x" } } }, { op: "add-edge", edge: { id: "e_fn", mechanism: "listener-target", from: "alb", to: "fn" } });
    const out = generate(d);
    expect(out["delivery.tf"]).toContain('resource "aws_lambda_permission"');
    expect(out["delivery.tf"]).toContain("aws_lambda_permission.alb_fn_fn");
    expect(out["delivery.tf"]).toContain("forward {");
  });

  it("shares one target group between connections that name it", () => {
    const d = patched(web, { op: "add-node", node: { key: "web2", label: "W2", service: "ecs", parent: "app_a", props: { part: "service", cluster: "cluster", desired_count: 1, container_port: 8080, image: "nginx" } } }, { op: "add-edge", edge: { id: "e_sg2", mechanism: "sg-attach", from: "sg_task", to: "web2" } }, { op: "remove-edge", mechanism: "listener-target", from: "alb", to: "web" }, { op: "add-edge", edge: { id: "e1", mechanism: "listener-target", from: "alb", to: "web", props: { target_group: "shared" } } }, { op: "add-edge", edge: { id: "e2", mechanism: "listener-target", from: "alb", to: "web2", props: { target_group: "shared" } } });
    const groups = targetGroupsOf(new Graph(normalize(d)));
    expect(groups.map((t) => t.id)).toEqual(["shared"]);
    expect(groups[0]!.targets.length).toBe(2);
  });

  it("VAL-078 flags a target group two load balancers use", () => {
    const d = patched(web,
      { op: "add-node", node: { key: "alb2", label: "B", service: "alb", parent: "pub_a", props: { name: "second", listeners: [] } } },
      { op: "add-edge", edge: { id: "e_b", mechanism: "containment", from: "pub_b", to: "alb2" } },
      { op: "remove-edge", mechanism: "listener-target", from: "alb", to: "web" },
      { op: "add-edge", edge: { id: "e1", mechanism: "listener-target", from: "alb", to: "web", props: { target_group: "shared" } } },
      { op: "add-edge", edge: { id: "e2", mechanism: "listener-target", from: "alb2", to: "web", props: { target_group: "shared" } } });
    expect(firedRules(d)).toContain("VAL-078");
  });
});

describe("certificates and DNS", () => {
  it("creates a certificate in another Region through a provider alias", () => {
    expect(generate(site)["versions.tf"]).toContain('alias  = "us_east_1"');
    expect(generate(site)["dns.tf"]).toContain("provider                  = aws.us_east_1");
  });

  it("needs no alias when the design is in that Region", () => {
    const d: Design = { ...site, settings: { region: "us-east-1" } };
    expect(generate(d)["versions.tf"]).not.toContain("alias");
    expect(generate(d)["dns.tf"]).not.toContain("provider ");
  });

  it("writes a validation record set per hosted zone, each only for its own names", () => {
    const d = patched(site, { op: "set", node: "cert", path: "props.subject_alternative_names", value: ["www.example.com", "www.example.net"] }, { op: "add-node", node: { key: "zone_net", label: "net", service: "route53", props: { name: "example.net" } } });
    const dns = generate(d)["dns.tf"]!;
    expect(dns).toContain('resource "aws_route53_record" "cert_validation_zone"');
    expect(dns).toContain('resource "aws_route53_record" "cert_validation_zone_net"');
    expect(dns).toContain("concat(");
    expect(dns).toContain('contains(["www.example.net"], dvo.domain_name)');
  });

  it("picks the longest matching zone and reads wildcards without the star", () => {
    const g = new Graph(normalize(patched(site, { op: "add-node", node: { key: "sub", label: "s", service: "route53", props: { name: "app.example.com" } } })));
    expect(zoneFor(g, "www.app.example.com")?.key).toBe("sub");
    expect(zoneFor(g, "*.example.com")?.key).toBe("zone");
    expect(zoneFor(g, "example.org")).toBeUndefined();
  });

  it("covers a name with an exact match or a wildcard at the same level only", () => {
    expect(covers("example.com", "example.com")).toBe(true);
    expect(covers("*.example.com", "www.example.com")).toBe(true);
    expect(covers("*.example.com", "a.b.example.com")).toBe(false);
    expect(covers("*.example.com", "example.com")).toBe(false);
  });
});

describe("distributions", () => {
  it("reads managed policies by data source and signs requests to the bucket", () => {
    const cdn = generate(site)["cdn.tf"]!;
    expect(cdn).toContain('data "aws_cloudfront_cache_policy"');
    expect(cdn).toContain("origin_access_control_id");
    expect(cdn).toContain('signing_behavior                  = "always"');
  });

  it("uses a dynamic cache policy and the viewer's headers for an ALB origin", () => {
    const d = patched(web, { op: "add-node", node: { key: "cdn", label: "C", service: "cloudfront", props: { enabled: true } } }, { op: "add-edge", edge: { id: "e_cdn", mechanism: "origin", from: "cdn", to: "alb" } });
    const cdn = generate(d)["cdn.tf"]!;
    expect(cdn).toContain("Managed-CachingDisabled");
    expect(cdn).toContain("Managed-AllViewer");
    expect(cdn).toContain("custom_origin_config");
  });

  it("VAL-053 limits the merged bucket policy to 20 KB", () => {
    const big = { Version: "2012-10-17", Statement: [{ Effect: "Deny", Principal: "*", Action: "s3:*", Resource: "x".repeat(21000), Condition: { Bool: { "aws:SecureTransport": "false" } } }] };
    expect(firedRules(patched(site, { op: "set", node: "site", path: "props.bucket_policy", value: big }))).toContain("VAL-053");
  });

  it("VAL-095 limits the aliases of a distribution to 100", () => {
    const names = Array.from({ length: 101 }, (_, i) => `n${i}.example.com`);
    expect(firedRules(patched(site, { op: "set", node: "cdn", path: "props.aliases", value: names }))).toContain("VAL-095");
    expect(firedRules(site)).not.toContain("VAL-095");
  });

  it("VAL-084 limits the load balancers of a Region to 50", () => {
    const many = Array.from({ length: 50 }, (_, i): PatchOp => ({ op: "add-node", node: { key: `lb${i}`, label: "x", service: "alb", parent: "pub_a", props: { name: `lb-${i}`, listeners: [] } } }));
    expect(firedRules(patched(web, ...many))).toContain("VAL-084");
  });
});

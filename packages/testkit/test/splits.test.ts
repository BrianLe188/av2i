import { describe, expect, it } from "vitest";
import { applyPatch, type Design, type PatchOp } from "@av2i/model";
import { executableScenarios, firedRules } from "../src/index.ts";

/**
 * One case per condition of the rules whose check sentence bundles several (cases.md, needs_split). Each case changes one thing in
 * a scenario's base design and says whether the rule fires; the rule's own neighbours (the boundary that must still pass) are
 * listed next to the value that breaks it.
 */
const base = (id: string): Design => executableScenarios().find((s) => s.id === id)!.design;
const set = (node: string, path: string, value: unknown): PatchOp => ({ op: "set", node, path, value: value as never });
const unset = (node: string, path: string): PatchOp => ({ op: "unset", node, path });
const remove = (mechanism: string, from: string, to: string): PatchOp => ({ op: "remove-edge", mechanism, from, to });

interface Case { rule: string; name: string; base: string; patch: PatchOp[]; fires: boolean }
const c = (rule: string, name: string, b: string, fires: boolean, ...patch: PatchOp[]): Case => ({ rule, name, base: b, patch, fires });

const CB = "container-backend", WEB = "alb-web", SITE = "static-site";
const bucket = (name: string, ...more: PatchOp[]) => [set("files", "props.bucket", name), ...more];
const listeners = (...l: unknown[]) => set("alb", "props.listeners", l);
const https = { port: 443, protocol: "HTTPS", default_action: { type: "forward" } };
const rule = (r: Record<string, unknown>) => set("files", "props.lifecycle_rules", [Object.fromEntries(Object.entries({ id: "r", status: "Enabled", filter: {}, expiration: { days: 1 }, ...r }).filter(([, v]) => v !== undefined))]);
const health = (h: Record<string, unknown>): PatchOp[] => [remove("listener-target", "alb", "web"), { op: "add-edge", edge: { id: "e_h", mechanism: "listener-target", from: "alb", to: "web", props: { health_check: h as never } } }];
const doc = (...statements: Record<string, unknown>[]) => ({ Version: "2012-10-17", Statement: statements });
const allow = { Effect: "Allow", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::b/*"] };

const cases: Case[] = [
  // VAL-018: name length, characters and the sg- prefix
  c("VAL-018", "255 characters", CB, false, set("sg_task", "props.name", "a".repeat(255))),
  c("VAL-018", "256 characters", CB, true, set("sg_task", "props.name", "a".repeat(256))),
  c("VAL-018", "a character AWS does not accept", CB, true, set("sg_task", "props.name", "bad|name")),
  c("VAL-018", "the sg- prefix", CB, true, set("sg_task", "props.name", "sg-task")),
  c("VAL-018", "characters AWS accepts", CB, false, set("sg_task", "props.name", "Task_group.v2 (prod)")),

  // VAL-050: bucket name, one case per condition
  c("VAL-050", "a valid name", CB, false, ...bucket("my-bucket-1")),
  c("VAL-050", "2 characters", CB, true, ...bucket("ab")),
  c("VAL-050", "3 characters", CB, false, ...bucket("abc")),
  c("VAL-050", "63 characters", CB, false, ...bucket("a".repeat(63))),
  c("VAL-050", "64 characters", CB, true, ...bucket("a".repeat(64))),
  c("VAL-050", "capitals", CB, true, ...bucket("MyBucket")),
  c("VAL-050", "an underscore", CB, true, ...bucket("my_bucket")),
  c("VAL-050", "starts with a hyphen", CB, true, ...bucket("-bucket")),
  c("VAL-050", "ends with a period", CB, true, ...bucket("bucket.")),
  c("VAL-050", "two adjacent periods", CB, true, ...bucket("my..bucket")),
  c("VAL-050", "a period inside", CB, false, ...bucket("my.bucket")),
  c("VAL-050", "formatted as an IP address", CB, true, ...bucket("192.168.1.1")),
  c("VAL-050", "prefix xn--", CB, true, ...bucket("xn--bucket")),
  c("VAL-050", "prefix sthree-", CB, true, ...bucket("sthree-bucket")),
  c("VAL-050", "prefix amzn-s3-demo-", CB, true, ...bucket("amzn-s3-demo-bucket")),
  c("VAL-050", "suffix -s3alias", CB, true, ...bucket("bucket-s3alias")),
  c("VAL-050", "suffix --ol-s3", CB, true, ...bucket("bucket--ol-s3")),
  c("VAL-050", "suffix .mrap", CB, true, ...bucket("bucket.mrap")),
  c("VAL-050", "suffix --x-s3", CB, true, ...bucket("bucket--x-s3")),
  c("VAL-050", "suffix --table-s3", CB, true, ...bucket("bucket--table-s3")),
  c("VAL-050", "suffix -an in the global namespace", CB, true, ...bucket("bucket-an")),
  c("VAL-050", "suffix -an in the account regional namespace", CB, false, ...bucket("bucket-123456789012-ap-southeast-1-an", set("files", "props.bucket_namespace", "account-regional"))),
  c("VAL-050", "no name", CB, true, unset("files", "props.bucket")),

  // VAL-056: lifecycle configuration
  c("VAL-056", "a valid rule", CB, false, rule({})),
  c("VAL-056", "no id", CB, true, rule({ id: "" })),
  c("VAL-056", "an id of 256 characters", CB, true, rule({ id: "x".repeat(256) })),
  c("VAL-056", "an id of 255 characters", CB, false, rule({ id: "x".repeat(255) })),
  c("VAL-056", "a status that is not Enabled or Disabled", CB, true, rule({ status: "On" })),
  c("VAL-056", "no action", CB, true, rule({ expiration: undefined })),
  c("VAL-056", "an empty filter", CB, false, rule({ filter: {} })),
  c("VAL-056", "one filter element", CB, false, rule({ filter: { prefix: "a/" } })),
  c("VAL-056", "two filter elements", CB, true, rule({ filter: { prefix: "a/", object_size_greater_than: 1 } })),
  c("VAL-056", "a noncurrent version rule with versioning on", CB, false, rule({ expiration: undefined, noncurrent_version_expiration: { noncurrent_days: 5 } })),
  c("VAL-056", "a noncurrent version rule with versioning suspended", CB, true, set("files", "props.versioning", { status: "Suspended" }), rule({ expiration: undefined, noncurrent_version_expiration: { noncurrent_days: 5 } })),

  // VAL-060: required fields and the password alternative
  c("VAL-060", "complete", CB, false),
  c("VAL-060", "no engine", CB, true, unset("db", "props.engine")),
  c("VAL-060", "no instance class", CB, true, unset("db", "props.instance_class")),
  c("VAL-060", "no storage", CB, true, unset("db", "props.allocated_storage")),
  c("VAL-060", "no user", CB, true, unset("db", "props.username")),
  c("VAL-060", "no subnet group", CB, true, remove("db-subnet-group", "db", "db_group")),
  c("VAL-058", "a group with one subnet", CB, true, remove("containment", "db_b", "db_group")),
  c("VAL-058", "a group with two subnets in two zones", CB, false),
  c("VAL-058", "a group with no instance still needs two zones", CB, true, remove("db-subnet-group", "db", "db_group"), remove("containment", "db_b", "db_group")),
  c("VAL-060", "neither a password nor a managed one", CB, true, set("db", "props.manage_master_user_password", false)),
  c("VAL-060", "a password and not a managed one", CB, false, set("db", "props.manage_master_user_password", false), set("db", "props.password", "Sup3rSecretPass")),

  // VAL-076: listener
  c("VAL-076", "the base listeners", WEB, false),
  c("VAL-076", "port 0", WEB, true, listeners({ ...https, port: 0 })),
  c("VAL-076", "port 65536", WEB, true, listeners({ ...https, port: 65536 })),
  c("VAL-076", "port 65535", WEB, false, listeners({ ...https, port: 65535 })),
  c("VAL-076", "protocol TCP", WEB, true, listeners({ ...https, protocol: "TCP" })),
  c("VAL-076", "an unknown action", WEB, true, listeners({ ...https, default_action: { type: "authenticate" } })),
  c("VAL-076", "a redirect with 307", WEB, true, listeners({ port: 80, protocol: "HTTP", default_action: { type: "redirect", status_code: "HTTP_307" } })),
  c("VAL-076", "a redirect with 302", WEB, false, listeners({ port: 80, protocol: "HTTP", default_action: { type: "redirect", status_code: "HTTP_302" } })),
  c("VAL-076", "a fixed response with 302", WEB, true, listeners({ port: 80, protocol: "HTTP", default_action: { type: "fixed-response", status_code: "302" } })),
  c("VAL-076", "a fixed response with 503", WEB, false, listeners({ port: 80, protocol: "HTTP", default_action: { type: "fixed-response", status_code: "503" } })),
  c("VAL-076", "a forward with no target", WEB, true, remove("listener-target", "alb", "web")),

  // VAL-082: security groups of a load balancer
  c("VAL-082", "the base groups", WEB, false),
  c("VAL-082", "a listener port closed inbound", WEB, true, set("sg_alb", "props.ingress_rules", [{ ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: "0.0.0.0/0" }])),
  c("VAL-082", "all protocols open inbound", WEB, false, set("sg_alb", "props.ingress_rules", [{ ip_protocol: "-1", cidr_ipv4: "0.0.0.0/0" }])),
  c("VAL-082", "the target port outside the written egress rules: the engine adds it", WEB, false, set("sg_alb", "props.egress_rules", [{ ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: "0.0.0.0/0" }])),
  c("VAL-082", "the target port open outbound", WEB, false, set("sg_alb", "props.egress_rules", [{ ip_protocol: "tcp", from_port: 8080, to_port: 8080, cidr_ipv4: "0.0.0.0/0" }])),

  // VAL-083: health check numbers
  c("VAL-083", "sound numbers", WEB, false, ...health({ interval: 30, timeout: 5, healthy_threshold: 5, unhealthy_threshold: 2, matcher: "200" })),
  c("VAL-083", "interval 4", WEB, true, ...health({ interval: 4 })),
  c("VAL-083", "interval 301", WEB, true, ...health({ interval: 301 })),
  c("VAL-083", "interval 5", WEB, false, ...health({ interval: 5 })),
  c("VAL-083", "timeout 1", WEB, true, ...health({ timeout: 1 })),
  c("VAL-083", "timeout 121", WEB, true, ...health({ timeout: 121 })),
  c("VAL-083", "healthy threshold 1", WEB, true, ...health({ healthy_threshold: 1 })),
  c("VAL-083", "healthy threshold 11", WEB, true, ...health({ healthy_threshold: 11 })),
  c("VAL-083", "unhealthy threshold 1", WEB, true, ...health({ unhealthy_threshold: 1 })),
  c("VAL-083", "unhealthy threshold 11", WEB, true, ...health({ unhealthy_threshold: 11 })),
  c("VAL-083", "matcher 199", WEB, true, ...health({ matcher: "199" })),
  c("VAL-083", "matcher 500", WEB, true, ...health({ matcher: "500" })),
  c("VAL-083", "matcher 499", WEB, false, ...health({ matcher: "499" })),

  // VAL-092: distribution structure
  c("VAL-092", "the base distribution", SITE, false),
  c("VAL-092", "no origin", SITE, true, remove("origin", "cdn", "site")),
  c("VAL-092", "an ordered behaviour without a path", SITE, true, set("cdn", "props.ordered_cache_behavior", [{ cache_policy: "Managed-CachingOptimized" }])),
  c("VAL-092", "an ordered behaviour for a missing origin", SITE, true, set("cdn", "props.ordered_cache_behavior", [{ path_pattern: "/a/*", origin: "nowhere" }])),
  c("VAL-092", "an ordered behaviour for the origin", SITE, false, set("cdn", "props.ordered_cache_behavior", [{ path_pattern: "/a/*", origin: "site" }])),
  c("VAL-092", "an error response with a code and no page", SITE, true, set("cdn", "props.custom_error_response", [{ error_code: 404, response_code: 200 }])),
  c("VAL-092", "an error response with a page and no code", SITE, true, set("cdn", "props.custom_error_response", [{ error_code: 404, response_page_path: "/e.html" }])),
  c("VAL-092", "an error response with both", SITE, false, set("cdn", "props.custom_error_response", [{ error_code: 404, response_code: 200, response_page_path: "/e.html" }])),

  // VAL-108: policy sizes (trust policy size cannot exceed 2,048 characters with the principals a design has)
  c("VAL-108", "an inline policy of 10,000 characters", CB, false, set("task_role", "props.raw_policy", doc({ ...allow, Resource: ["a".repeat(9900)] }))),
  c("VAL-108", "an inline policy of 10,300 characters", CB, true, set("task_role", "props.raw_policy", doc({ ...allow, Resource: ["a".repeat(10300)] }))),

  // VAL-117: policy statements
  c("VAL-117", "a sound bucket policy", SITE, false, set("site", "props.bucket_policy", doc({ ...allow, Principal: "*", Condition: { Bool: { "aws:SecureTransport": "false" } } }))),
  c("VAL-117", "a bucket policy with another version", SITE, true, set("site", "props.bucket_policy", { ...doc({ ...allow, Principal: "*" }), Version: "2008-10-17" })),
  c("VAL-117", "a bucket policy with no statement", SITE, true, set("site", "props.bucket_policy", { Version: "2012-10-17", Statement: [] })),
  c("VAL-117", "a statement without Effect", SITE, true, set("site", "props.bucket_policy", doc({ Principal: "*", Action: ["s3:GetObject"], Resource: ["x"] }))),
  c("VAL-117", "a statement without Action", SITE, true, set("site", "props.bucket_policy", doc({ Effect: "Deny", Principal: "*", Resource: ["x"] }))),
  c("VAL-117", "a bucket policy statement without Principal", SITE, true, set("site", "props.bucket_policy", doc(allow))),
  c("VAL-117", "a bucket policy that is not JSON", SITE, true, set("site", "props.bucket_policy", "{not json")),
  c("VAL-117", "a sound role policy", CB, false, set("task_role", "props.raw_policy", doc(allow))),
  c("VAL-117", "a role policy statement without Resource", CB, true, set("task_role", "props.raw_policy", doc({ Effect: "Allow", Action: ["s3:GetObject"] }))),
  c("VAL-117", "a role policy statement that has a Principal and no Resource", CB, true, set("task_role", "props.raw_policy", doc({ Effect: "Allow", Action: ["s3:GetObject"], Principal: "*" }))),
];

describe("rules whose check bundles several conditions", () => {
  for (const k of cases) {
    it(`${k.rule}: ${k.name} ${k.fires ? "fires" : "does not fire"}`, () => {
      const d = applyPatch(base(k.base), k.patch);
      expect(firedRules(d).includes(k.rule)).toBe(k.fires);
    });
  }

  it("covers the rules cases.md lists as needing a split", () => {
    const covered = new Set(cases.map((k) => k.rule));
    // VAL-066 and SEC-016 are deferred in the registry (no data, no precise check)
    for (const r of ["VAL-018", "VAL-050", "VAL-056", "VAL-060", "VAL-076", "VAL-082", "VAL-083", "VAL-092", "VAL-108", "VAL-117"]) expect(covered.has(r), r).toBe(true);
  });
});

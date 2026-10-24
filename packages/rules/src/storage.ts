import { getPath } from "@av2i/engine";
import { hit, type RuleImpl } from "./context.ts";

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const BAD_PREFIX = ["xn--", "sthree-", "amzn-s3-demo-"];
const BAD_SUFFIX = ["-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3"];

function badBucketName(name: string | undefined, namespace: unknown): boolean {
  if (name === undefined || name === "") return true;
  if (name.length < 3 || name.length > 63) return true;
  if (!/^[a-z0-9.-]+$/.test(name) || !/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name) || name.includes("..")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
  if (BAD_PREFIX.some((p) => name.startsWith(p)) || BAD_SUFFIX.some((s) => name.endsWith(s))) return true;
  return name.endsWith("-an") && namespace !== "account-regional";
}

export const VAL_050: RuleImpl = (ctx) =>
  ctx.g.nodesOf("s3").filter((b) => badBucketName(text(b.props.bucket), b.props.bucket_namespace)).map((b) => hit(b.key));

const versioningOf = (ctx: Parameters<RuleImpl>[0], key: string) => text(ctx.g.prop(key, "versioning.status")) ?? "Enabled";

const ONE_FILTER = ["prefix", "tag", "and", "object_size_greater_than", "object_size_less_than"];
const ACTIONS = ["expiration", "transition", "noncurrent_version_expiration", "noncurrent_version_transition", "abort_incomplete_multipart_upload"];

export const VAL_056: RuleImpl = (ctx) =>
  ctx.g.nodesOf("s3").filter((b) => {
    const rules = b.props.lifecycle_rules;
    if (rules === undefined) return false;
    if (!Array.isArray(rules)) return true;
    return rules.some((r) => {
      if (r === null || typeof r !== "object" || Array.isArray(r)) return true;
      const id = text(r.id);
      if (!id || id.length > 255 || (r.status !== "Enabled" && r.status !== "Disabled")) return true;
      const actions = ACTIONS.filter((a) => a in r);
      if (actions.length === 0) return true;
      const filter = r.filter;
      if (filter !== undefined && filter !== null && typeof filter === "object" && !Array.isArray(filter) && ONE_FILTER.filter((k) => k in filter).length > 1) return true;
      return actions.some((a) => a.startsWith("noncurrent")) && versioningOf(ctx, b.key) !== "Enabled";
    });
  }).map((b) => hit(b.key));

export const VAL_057: RuleImpl = (ctx) =>
  ctx.g.nodesOf("s3").filter((b) => b.props.object_lock_enabled === true && versioningOf(ctx, b.key) !== "Enabled").map((b) => hit(b.key));

export const SEC_012: RuleImpl = (ctx) =>
  ctx.g.nodesOf("s3").filter((b) => ["block_public_acls", "ignore_public_acls", "block_public_policy", "restrict_public_buckets"].some((k) => getPath(b.props, `public_access_block.${k}`) === false)).map((b) => hit(b.key));

export const SEC_013: RuleImpl = (ctx) => ctx.g.nodesOf("s3").filter((b) => versioningOf(ctx, b.key) !== "Enabled").map((b) => hit(b.key));

export const SEC_014: RuleImpl = (ctx) =>
  ctx.g.nodesOf("s3").filter((b) => (text(ctx.g.prop(b.key, "ownership_controls.object_ownership")) ?? "BucketOwnerEnforced") !== "BucketOwnerEnforced").map((b) => hit(b.key));

export const SEC_009: RuleImpl = (ctx) => ctx.g.nodesOf("ecr").filter((r) => ctx.g.prop(r.key, "image_scanning_configuration.scan_on_push") !== true).map((r) => hit(r.key));

export const SEC_010: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ecr").filter((r) => {
    const mutability = text(r.props.image_tag_mutability) ?? "MUTABLE";
    const mutable = mutability === "MUTABLE" || mutability === "MUTABLE_WITH_EXCLUSION";
    const latest = ctx.g.edges("image-source").some((e) => e.from === r.key && (text(ctx.g.prop(e.to, "image_tag")) ?? "latest") === "latest");
    return mutable || latest;
  }).map((r) => hit(r.key));

export const VAL_047: RuleImpl = (ctx) =>
  ctx.g.nodesOf("ecr").filter((r) => {
    const p = r.props.lifecycle_policy;
    if (p === undefined || p === null || p === "") return false;
    let doc: unknown = p;
    if (typeof p === "string") {
      try { doc = JSON.parse(p); } catch { return true; }
    }
    const rules = (doc as { rules?: unknown })?.rules;
    return !Array.isArray(rules) || rules.length > 50 || JSON.stringify(doc).length > 30720;
  }).map((r) => hit(r.key));

import type { Design } from "@av2i/model";
import { plan, type FileName } from "./plan.ts";
import { printBlocks } from "./hcl.ts";
import { Graph, normalize } from "@av2i/engine";
import { aliasOf, aliasRegions } from "./delivery.ts";
import { deployerPolicy } from "./deployer.ts";

export { plan, type PlannedResource, type FileName } from "./plan.ts";
export { printBlocks, quote, ref, type Block, type Expr } from "./hcl.ts";

/** Pinned by decision D-001. */
export const PROVIDER_VERSION = "~> 6.66.0";
export const TOFU_VERSION = ">= 1.12.0, < 1.13.0";

const versionsFile = (region: string, aliases: string[]) => `terraform {
  required_version = "${TOFU_VERSION}"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${PROVIDER_VERSION}"
    }
  }
}

provider "aws" {
  region = "${region}"
}
${aliases.map((a) => `
provider "aws" {
  alias  = "${aliasOf(a)}"
  region = "${a}"
}
`).join("")}`;

/** Terraform files for a design, keyed by file name. The caller has already checked that the design has no errors. */
export function generate(design: Design): Record<string, string> {
  const planned = plan(design);
  const aliases = aliasRegions(new Graph(normalize(design)));
  const files: Record<string, string> = { "versions.tf": versionsFile(design.settings.region, aliases) };
  const order: FileName[] = ["network.tf", "security.tf", "storage.tf", "iam.tf", "compute.tf", "database.tf", "delivery.tf", "dns.tf", "cdn.tf", "variables.tf"];
  for (const f of order) {
    const blocks = planned.filter((p) => p.file === f).map((p) => p.block);
    if (blocks.length) files[f] = printBlocks(blocks);
  }
  const deployer = deployerPolicy(new Graph(normalize(design)));
  if (deployer) files["deployer-policy.json"] = deployer;
  return files;
}

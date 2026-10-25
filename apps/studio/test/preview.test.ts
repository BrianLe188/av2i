import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import type { Design } from "@av2i/model";
import { analyze } from "../src/logic/analyze.ts";
import { addNode } from "../src/logic/design.ts";
import { blankDesign, fromTemplate, templates } from "../src/logic/templates.ts";

const reg = getRegistry();

describe("Terraform while errors remain", () => {
  it("writes a clean design and counts no errors", () => {
    const a = analyze(fromTemplate(reg, "ec2-in-vpc"), reg);
    expect(a.errors).toBe(0);
    expect(a.files).not.toBeNull();
    expect(a.generateError).toBeNull();
  });

  it("still writes the part of a design that has errors, and says how many", () => {
    // a database with no security group and no second subnet: VAL-029 and VAL-058 are errors
    let d: Design = blankDesign("ap-southeast-1");
    const vpc = addNode(reg, d, "vpc", null, undefined);
    d = vpc.design;
    const sub = addNode(reg, d, "subnet", vpc.key, undefined);
    d = sub.design;
    const db = addNode(reg, d, "rds", vpc.key, undefined);
    d = db.design;
    const bucket = addNode(reg, d, "s3", null, undefined);
    d = bucket.design;
    const a = analyze(d, reg);
    expect(a.errors).toBeGreaterThan(0);
    expect(a.findings.filter((f) => f.severity === "error")).toHaveLength(a.errors);
    expect(a.files ?? a.generateError).toBeTruthy();
    if (a.files) expect(Object.values(a.files).join("\n")).toContain("aws_s3_bucket");
  });

  it("never leaves the person with neither Terraform nor a reason, in any template or variant", () => {
    for (const t of templates(reg)) for (const v of [undefined, ...t.variants.map((x) => x.id)]) {
      const a = analyze(fromTemplate(reg, t.id, v), reg);
      if (a.structural.length > 0) continue;
      expect(a.files !== null || a.generateError !== null, `${t.id}/${v ?? "base"}`).toBe(true);
      expect(a.errors, `${t.id}/${v ?? "base"}`).toBe(a.findings.filter((f) => f.severity === "error").length);
    }
  });
});

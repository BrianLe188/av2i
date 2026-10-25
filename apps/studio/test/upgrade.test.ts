import { describe, expect, it } from "vitest";
import { upgradeDesign, type Design } from "@av2i/model";
import { analyze } from "../src/logic/analyze.ts";
import { reg } from "../src/registry.ts";
import { fromTemplate } from "../src/logic/templates.ts";

/** The container backend as it was saved before the DB subnet group became a node: the database in a subnet, a line to the other. */
function legacy(): Design {
  const d = structuredClone(fromTemplate(reg, "container-backend"));
  d.nodes = d.nodes.filter((n) => n.key !== "db_group").map((n) => (n.key === "db" ? { ...n, parent: "db_a" } : n));
  d.edges = d.edges.filter((e) => !["e_dbg_a", "e_dbg_b", "e_db_group"].includes(e.id));
  d.edges.push({ id: "e_db_b", mechanism: "db-subnet-group", from: "db", to: "db_b" });
  return d;
}

describe("designs saved with the database in a subnet", () => {
  it("move the database to the VPC and give it a group of the subnets it spanned", () => {
    const up = upgradeDesign(legacy());
    const db = up.nodes.find((n) => n.key === "db")!;
    const group = up.nodes.find((n) => n.service === "db-subnet-group")!;
    expect(db.parent).toBe("vpc");
    expect(group.parent).toBe("vpc");
    expect(up.edges.filter((e) => e.mechanism === "containment" && e.to === group.key).map((e) => e.from).sort()).toEqual(["db_a", "db_b"]);
    expect(up.edges.some((e) => e.mechanism === "db-subnet-group" && e.from === "db" && e.to === group.key)).toBe(true);
    expect(up.edges.some((e) => e.mechanism === "db-subnet-group" && e.to === "db_b")).toBe(false);
  });

  it("have no structural problem afterwards and write the same subnet group as before", () => {
    const up = upgradeDesign(legacy());
    const a = analyze(up, reg);
    expect(a.structural).toEqual([]);
    expect(a.errors).toBe(0);
    const database = a.files?.["database.tf"] ?? "";
    expect(database).toContain('resource "aws_db_subnet_group"');
    expect(database).toMatch(/name\s+= "db"/);
    expect(database).toContain("aws_subnet.db_a.id");
    expect(database).toContain("aws_subnet.db_b.id");
  });

  it("leave a current design alone, and do not change the one it is given", () => {
    const current = fromTemplate(reg, "container-backend");
    expect(upgradeDesign(current)).toBe(current);
    const old = legacy();
    const copy = structuredClone(old);
    upgradeDesign(old);
    expect(old).toEqual(copy);
    const once = upgradeDesign(old);
    expect(upgradeDesign(once)).toBe(once);
  });
});

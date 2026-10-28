import { describe, expect, it } from "vitest";
import {
  ACTIONS, ADMINISTRATOR, checkNewPassword, BUILTIN_POLICIES, allowedActions, can, evaluate, matchesAction, matchesResource, memberStatements, ownerStatements, parseDocument, resource, restrictToActions, shareStatements,
  type Statement,
} from "../src/index.ts";

const allow = (actions: string[], resources: string[], sid?: string): Statement => ({ effect: "Allow", actions, resources, ...(sid ? { sid } : {}) });
const deny = (actions: string[], resources: string[], sid?: string): Statement => ({ effect: "Deny", actions, resources, ...(sid ? { sid } : {}) });

describe("matching", () => {
  it("lets * stand for any run of characters and nothing else", () => {
    expect(matchesAction("project:*", "project:Read")).toBe(true);
    expect(matchesAction("*", "user:Create")).toBe(true);
    expect(matchesAction("project:Read", "project:Write")).toBe(false);
    expect(matchesAction("project:Re.d", "project:Read")).toBe(false);
  });
  it("ignores case in actions but not in resources", () => {
    expect(matchesAction("PROJECT:read", "project:Read")).toBe(true);
    expect(matchesResource("av2i:project/ABC", "av2i:project/abc")).toBe(false);
  });
  it("matches a resource prefix", () => {
    expect(matchesResource("av2i:project/*", resource.project("p1"))).toBe(true);
    expect(matchesResource("av2i:project/p1", resource.project("p2"))).toBe(false);
  });
});

describe("evaluate", () => {
  it("refuses by default", () => {
    expect(evaluate([], { action: "project:Read", resource: resource.project("p") })).toEqual({ allowed: false, reason: "implicit-deny" });
  });
  it("allows what an Allow covers", () => {
    expect(can([allow(["project:Read"], ["av2i:project/*"])], "project:Read", resource.project("p"))).toBe(true);
    expect(can([allow(["project:Read"], ["av2i:project/*"])], "project:Write", resource.project("p"))).toBe(false);
  });
  it("lets a Deny win whatever the order", () => {
    const a = allow(["project:*"], ["*"]);
    const d = deny(["project:Delete"], ["av2i:project/keep"], "keep");
    for (const list of [[a, d], [d, a]]) {
      expect(evaluate(list, { action: "project:Delete", resource: resource.project("keep") })).toEqual({ allowed: false, reason: "explicit-deny", sid: "keep" });
      expect(can(list, "project:Delete", resource.project("other"))).toBe(true);
    }
  });
  it("adds the owner and the share role to the allows, and a Deny still wins over them", () => {
    expect(can(ownerStatements("p"), "project:Delete", resource.project("p"))).toBe(true);
    expect(can(ownerStatements("p"), "project:Delete", resource.project("q"))).toBe(false);
    expect(can(ownerStatements("p"), "run:ApplyDestructive", resource.project("p"))).toBe(true);
    expect(can(ownerStatements("p"), "state:Write", resource.project("p"))).toBe(true);
    expect(can(shareStatements("runner", "p"), "run:Plan", resource.project("p"))).toBe(true);
    expect(can(shareStatements("runner", "p"), "run:Apply", resource.project("p"))).toBe(false);
    expect(can(shareStatements("approver", "p"), "run:Approve", resource.project("p"))).toBe(true);
    expect(can(memberStatements(["project:Read", "run:ApplyDestructive"], "p"), "run:ApplyDestructive", resource.project("p"))).toBe(true);
    expect(can(shareStatements("viewer", "p"), "project:Write", resource.project("p"))).toBe(false);
    expect(can(shareStatements("editor", "p"), "project:Write", resource.project("p"))).toBe(true);
    expect(can([...shareStatements("editor", "p"), deny(["project:Write"], ["*"])], "project:Write", resource.project("p"))).toBe(false);
  });
});

describe("parseDocument", () => {
  it("reads a document and accepts a single statement object", () => {
    const r = parseDocument({ Statement: { Effect: "Allow", Action: "project:*", Resource: "av2i:project/*", Sid: "x" } });
    expect(r).toEqual({ ok: true, statements: [{ sid: "x", effect: "Allow", actions: ["project:*"], resources: ["av2i:project/*"] }] });
  });
  it("names every problem", () => {
    const r = parseDocument({ Statement: [{ Effect: "Maybe", Action: ["project:Reed"], Resource: ["arn:aws:s3:::x"] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toContain("Effect");
      expect(r.errors.join("\n")).toContain("matches no known action");
      expect(r.errors.join("\n")).toContain("av2i:");
    }
  });
  it("refuses an empty or missing Statement", () => {
    expect(parseDocument({}).ok).toBe(false);
    expect(parseDocument({ Statement: [] }).ok).toBe(false);
    expect(parseDocument(null).ok).toBe(false);
  });
});

describe("built-in policies", () => {
  it("are valid documents", () => {
    for (const p of BUILTIN_POLICIES) expect(parseDocument(p.document).ok, p.name).toBe(true);
  });
  it("give Administrator everything and the others only what they name", () => {
    const stmts = (name: string) => {
      const p = BUILTIN_POLICIES.find((x) => x.name === name)!;
      const r = parseDocument(p.document);
      return r.ok ? r.statements : [];
    };
    expect(allowedActions(stmts(ADMINISTRATOR)).length).toBe(Object.keys(ACTIONS).length);
    expect(allowedActions(stmts("ProjectViewer")).sort()).toEqual(["project:List", "project:Read"]);
    expect(allowedActions(stmts("ProjectEditor"))).toContain("project:Write");
    expect(allowedActions(stmts("ProjectEditor"))).not.toContain("project:Delete");
    expect(allowedActions(stmts("UserManager"))).toEqual(expect.arrayContaining(["user:Create", "user:ResetPassword", "group:Manage"]));
    expect(allowedActions(stmts("UserManager"))).not.toContain("audit:Read");
  });
});

describe("checkNewPassword", () => {
  it("asks for 12 characters and refuses the username and well known passwords", () => {
    expect(checkNewPassword("short", "ann")).toBe("too_short");
    expect(checkNewPassword("Ann-Ann-Ann1", "Ann-Ann-Ann1")).toBe("same_as_username");
    expect(checkNewPassword("administrator", "ann")).toBe("too_common");
    expect(checkNewPassword("x".repeat(300), "ann")).toBe("too_long");
    expect(checkNewPassword("a-good-long-one", "ann")).toBeNull();
  });
});

describe("restrictToActions", () => {
  const ask = (s: Statement[], action: string, res = "av2i:project/p1") => evaluate(s, { action: action as never, resource: res }).allowed;

  it("keeps only the scoped actions of a wildcard allow", () => {
    const narrowed = restrictToActions([allow(["project:*"], ["*"])], ["project:Read", "user:List"]);
    expect(ask(narrowed, "project:Read")).toBe(true);
    expect(ask(narrowed, "project:Write")).toBe(false);
    expect(ask(narrowed, "user:List", "av2i:user/u")).toBe(false);
  });

  it("never grants an action the statements did not", () => {
    expect(ask(restrictToActions([allow(["project:Read"], ["*"])], ["project:Read", "project:Write"]), "project:Write")).toBe(false);
  });

  it("keeps a Deny whole, and drops an Allow left with nothing", () => {
    const narrowed = restrictToActions([allow(["project:*"], ["*"]), deny(["project:Delete"], ["*"]), allow(["user:*"], ["*"])], ["project:Delete", "project:Read"]);
    expect(narrowed).toHaveLength(2);
    expect(ask(narrowed, "project:Delete")).toBe(false);
    expect(ask(narrowed, "project:Read")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { printBlocks, quote, ref } from "../src/hcl.ts";

describe("hcl printer", () => {
  it("aligns equals signs within a run of single-line attributes", () => {
    const out = printBlocks([{ type: "resource", labels: ["aws_x", "a"], args: [["a", 1], ["long_name", true]] }]);
    expect(out).toBe('resource "aws_x" "a" {\n  a         = 1\n  long_name = true\n}\n');
  });

  it("puts multi-line values and depends_on apart, and aligns map keys", () => {
    const out = printBlocks([{ type: "resource", labels: ["aws_x", "a"], args: [["id", ref("aws_y.b.id")], ["tags", { Name: "n", Environment: "e" }], ["depends_on", [ref("aws_z.c")]]] }]);
    expect(out).toBe('resource "aws_x" "a" {\n  id = aws_y.b.id\n\n  tags = {\n    Name        = "n"\n    Environment = "e"\n  }\n\n  depends_on = [aws_z.c]\n}\n');
  });

  it("escapes strings so interpolation cannot be injected", () => {
    expect(quote('a"b\\c${x}%{y}')).toBe('"a\\"b\\\\c$${x}%%{y}"');
    expect(quote("line\nbreak")).toBe('"line\\nbreak"');
  });

  it("quotes map keys that are not identifiers", () => {
    const out = printBlocks([{ type: "resource", labels: ["aws_x", "a"], args: [["tags", { "cost center": "1" }]] }]);
    expect(out).toContain('"cost center" = "1"');
  });

  it("prints nested blocks after the attributes", () => {
    const out = printBlocks([{ type: "resource", labels: ["aws_x", "a"], args: [["a", 1]], blocks: [{ type: "inner", labels: [], args: [["b", false]] }] }]);
    expect(out).toBe('resource "aws_x" "a" {\n  a = 1\n\n  inner {\n    b = false\n  }\n}\n');
  });
});

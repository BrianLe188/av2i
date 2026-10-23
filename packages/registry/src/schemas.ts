/**
 * JSON Schemas for each kind of specification file. They state what docs/spec/00-conventions.md requires and nothing
 * more: shapes the specification leaves free (property constraints, notes) stay open so a new service needs no schema
 * change.
 */
type Schema = Record<string, unknown>;

const i18n: Schema = {
  type: "object",
  required: ["vi", "en"],
  properties: { vi: { type: "string", minLength: 1 }, en: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

const kebab = { type: "string", pattern: "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" };
const status = { enum: ["verified", "unverified"] };
const ruleId = { type: "string", pattern: "^(VAL|SEC)-\\d{3}$" };
const stringList = { type: "array", items: { type: "string" } };

const service: Schema = {
  $id: "service",
  type: "object",
  required: ["id", "title", "terraform", "scope", "placement", "sources", "limits", "relations", "cost", "status"],
  properties: {
    id: kebab,
    title: i18n,
    terraform: {
      type: "object",
      required: ["resources"],
      properties: { resources: { type: "array", items: { type: "string", pattern: "^aws_[a-z0-9_]+$" } } },
    },
    scope: { enum: ["regional", "vpc", "az", "global"] },
    placement: {
      type: "object",
      required: ["requires", "subnet_type", "min_azs"],
      properties: {
        requires: { type: "array", items: kebab },
        subnet_type: { enum: ["public", "private", "any", null] },
        min_azs: { type: ["integer", "null"] },
      },
    },
    sources: { type: "object", additionalProperties: { type: "string", pattern: "^https://" } },
    properties: {
      type: "array",
      items: { type: "object", required: ["key"], properties: { key: { type: "string" }, status, src: stringList } },
    },
    limits: {
      type: "array",
      items: { type: "object", required: ["id"], properties: { id: { type: "string" }, status, src: stringList } },
    },
    relations: { type: "array", items: kebab },
    cost: {
      type: "object",
      required: ["model"],
      properties: { model: { enum: ["free", "usage", "hourly", "fixed", "mixed"] }, notes: { type: "string" } },
    },
    status,
  },
};

const mechanism: Schema = {
  $id: "mechanism",
  type: "object",
  required: ["id", "title", "participants", "direction", "same_vpc", "cardinality", "user_drawn", "invalid_when", "sources", "status"],
  properties: {
    id: kebab,
    title: i18n,
    participants: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        required: ["role", "service"],
        properties: { role: { type: "string" }, service: { type: ["string", "array"] } },
      },
    },
    direction: { type: "string", pattern: "^(undirected|[a-z_]+(->|<-)[a-z_]+)$" },
    same_vpc: { type: "boolean" },
    cardinality: { type: "object" },
    user_drawn: { enum: [true, false, "partly"] },
    invalid_when: { type: "array", items: ruleId },
    sources: { type: "object", additionalProperties: { type: "string", pattern: "^https://" } },
    status,
  },
};

const rule: Schema = {
  $id: "rule",
  type: "object",
  required: ["id", "severity", "applies_to", "check", "message", "fix", "source", "status"],
  properties: {
    id: ruleId,
    severity: { enum: ["error", "warning", "info"] },
    applies_to: { type: "array", minItems: 1, items: kebab },
    check: { type: "string", minLength: 10 },
    message: i18n,
    fix: i18n,
    source: { type: ["string", "null"] },
    status,
  },
  additionalProperties: false,
  // a verified rule must cite a source (conventions section 9)
  if: { properties: { status: { const: "verified" } } },
  then: { properties: { source: { type: "string", minLength: 1 } } },
};

const matrix: Schema = {
  $id: "matrix",
  type: "object",
  required: ["id", "services", "cell_values", "counts", "pairs", "status"],
  properties: {
    services: { type: "array", items: kebab },
    cell_values: { const: ["valid", "conditional", "invalid", "none"] },
    pairs: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to", "value", "mechanism", "note"],
        properties: {
          from: kebab,
          to: kebab,
          value: { enum: ["valid", "conditional", "invalid", "none"] },
          mechanism: { type: "string" },
          note: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    status,
  },
};

const scenario: Schema = {
  $id: "scenario",
  type: "object",
  required: ["id", "title", "services", "expect", "variants"],
  // a sketch scenario lists nodes and connections; an executable one carries a full design
  anyOf: [{ required: ["nodes", "connections"] }, { required: ["design", "executable"] }],
  properties: {
    id: kebab,
    title: i18n,
    services: { type: "array", items: kebab },
    executable: { type: "boolean" },
    design: { type: "object", required: ["schema", "name", "settings", "nodes", "edges"] },
    nodes: {
      type: "array",
      items: { type: "object", required: ["id", "service"], properties: { id: kebab, service: kebab } },
    },
    connections: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to", "mechanism", "kind"],
        properties: { from: kebab, to: kebab, mechanism: kebab, kind: { enum: ["drawn", "derived", "generated"] } },
      },
    },
    expect: {
      type: "object",
      required: ["errors", "findings"],
      properties: { errors: { type: "array", items: ruleId }, findings: { type: "array", items: ruleId } },
    },
    variants: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "change", "fires", "severity"],
        properties: {
          id: kebab,
          change: { type: "string", minLength: 5 },
          fires: { type: "array", items: ruleId },
          severity: { enum: ["error", "warning", "info"] },
          patch: { type: "array", items: { type: "object", required: ["op"], properties: { op: { enum: ["set", "unset", "add-node", "remove-node", "add-edge", "remove-edge"] } } } },
        },
      },
    },
  },
};

const cases: Schema = {
  $id: "cases",
  type: "object",
  required: ["id", "needs_split", "cases"],
  properties: {
    needs_split: { type: "array", items: { type: "object", required: ["rule", "why"], properties: { rule: ruleId } } },
    cases: {
      type: "array",
      items: {
        type: "object",
        required: ["rule", "cases"],
        properties: {
          rule: ruleId,
          cases: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["name", "in", "fires"],
              properties: { name: { type: "string" }, fires: { type: "boolean" }, base: { type: "string" }, patch: { type: "array" }, unrepresentable: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

const glossary: Schema = {
  $id: "glossary",
  type: "object",
  required: ["id", "terms"],
  properties: {
    terms: {
      type: "array",
      items: { type: "object", required: ["term", "vi", "en", "see"], properties: { term: { type: "string" }, vi: { type: "string" }, en: { type: "string" }, see: { type: "string" } } },
    },
  },
};

export const schemas: Record<string, Schema> = { service, mechanism, rule, matrix, scenario, cases, glossary };

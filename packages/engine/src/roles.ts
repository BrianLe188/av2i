/**
 * The role slots of relations/assume-role.md, one row per consumer slot. Adding a service that runs as a role means
 * adding a row; `roles.test.ts` in the testkit keeps this table equal to the specification.
 */
export type SlotId = "instance-profile" | "execution" | "task" | "monitoring";

export interface Slot {
  id: SlotId;
  service: string;
  trust: string;
  /** the platform derives a role for the slot when the design draws none (D-025) */
  required: boolean;
}

export const SLOTS: Slot[] = [
  { id: "instance-profile", service: "ec2", trust: "ec2.amazonaws.com", required: false },
  { id: "execution", service: "lambda", trust: "lambda.amazonaws.com", required: true },
  { id: "task", service: "ecs", trust: "ecs-tasks.amazonaws.com", required: false },
  { id: "execution", service: "ecs", trust: "ecs-tasks.amazonaws.com", required: true },
  { id: "monitoring", service: "rds", trust: "monitoring.rds.amazonaws.com", required: false },
];

const DEFAULT_SLOT: Record<string, SlotId> = { ec2: "instance-profile", lambda: "execution", ecs: "task", rds: "monitoring" };

export const slotFor = (service: string, id: SlotId): Slot | undefined => SLOTS.find((s) => s.service === service && s.id === id);

/** The slot an assume-role edge fills: its `slot` property, else the default slot of the consumer's service. */
export function slotOfEdge(consumerService: string, props: Record<string, unknown> | undefined): SlotId | undefined {
  const given = props?.slot;
  if (typeof given === "string") return slotFor(consumerService, given as SlotId)?.id;
  return DEFAULT_SLOT[consumerService];
}

export const MANAGED = {
  lambdaBasic: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  lambdaVpc: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
  ecsExecution: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  rdsMonitoring: "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole",
  administrator: "arn:aws:iam::aws:policy/AdministratorAccess",
} as const;

/** Managed policies a slot needs; `vpc` says the consumer is a Lambda function attached to a VPC. */
export function requiredManaged(service: string, slot: SlotId, vpc: boolean): string[] {
  if (service === "lambda" && slot === "execution") return vpc ? [MANAGED.lambdaBasic, MANAGED.lambdaVpc] : [MANAGED.lambdaBasic];
  if (service === "ecs" && slot === "execution") return [MANAGED.ecsExecution];
  if (service === "rds" && slot === "monitoring") return [MANAGED.rdsMonitoring];
  return [];
}

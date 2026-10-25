/** One colour per service, used by the palette swatches and the nodes on the canvas. */
export const SERVICE_COLOR: Record<string, string> = {
  vpc: "#5b6ee1", subnet: "#2e9d8f", "internet-gateway": "#e07b39", "nat-gateway": "#c9507d", "elastic-ip": "#8a63d2",
  "route-table": "#6b8e23", "vpc-endpoint-s3": "#d4a017", "security-group": "#c0392b", ec2: "#e67e22", ecs: "#d9622b",
  ecr: "#7a5cc9", s3: "#3a9d3f", rds: "#2f6fb5", "db-subnet-group": "#4f8fd0", lambda: "#f08a24", "iam-role": "#b0377a", "iam-policy": "#9a4d8e",
  alb: "#1a8cae", acm: "#4c9a6a", route53: "#7d5ba6", cloudfront: "#8c4fd0",
};

export const colorOf = (service: string) => SERVICE_COLOR[service] ?? "#8a96a8";

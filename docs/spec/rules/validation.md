# Validation rules

Rules about whether a design can be deployed. Format and severity scale are in
[../00-conventions.md](../00-conventions.md). This file covers the networking group (VAL-001 to 028), the compute and container group (VAL-029 to 049) and the storage and database group (VAL-050 to 070) and the delivery and certificate group (VAL-071 to 102) and the IAM group (VAL-103 to 121).
Rules for the other groups are added when their services are written, continuing the numbering.

Source aliases used below:

- AWS-CIDR: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
- AWS-SUBNET: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
- AWS-IGW: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
- AWS-NAT: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html
- AWS-RT: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html
- AWS-SG: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
- AWS-SGR: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html
- AWS-QUOTA: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
- TF-ROUTE: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route.html.markdown
- TF-SGR: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/vpc_security_group_ingress_rule.html.markdown

```yaml
- id: VAL-001
  severity: error
  applies_to: [vpc]
  check: "the VPC's IPv4 CIDR is valid and its netmask is between /16 and /28 inclusive"
  message: { vi: "CIDR của VPC phải có netmask từ /16 đến /28.", en: "The VPC CIDR must have a netmask between /16 and /28." }
  fix: { vi: "Dùng ví dụ 10.0.0.0/16.", en: "Use for example 10.0.0.0/16." }
  source: AWS-CIDR
  status: verified

- id: VAL-002
  severity: error
  applies_to: [vpc]
  check: "the VPC CIDR is not inside 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 or 224.0.0.0/4"
  message: { vi: "CIDR của VPC nằm trong dải AWS không cho phép.", en: "The VPC CIDR is in a range AWS does not allow." }
  fix: { vi: "Chọn dải RFC 1918 (10/8, 172.16/12, 192.168/16).", en: "Choose an RFC 1918 range (10/8, 172.16/12, 192.168/16)." }
  source: AWS-CIDR
  status: verified

- id: VAL-003
  severity: error
  applies_to: [subnet]
  check: "the subnet's IPv4 CIDR netmask is between /28 and /16 inclusive"
  message: { vi: "CIDR của subnet phải có netmask từ /28 đến /16.", en: "The subnet CIDR must have a netmask between /28 and /16." }
  fix: { vi: "Dùng ví dụ /24.", en: "Use for example /24." }
  source: AWS-SUBNET
  status: verified

- id: VAL-004
  severity: error
  applies_to: [subnet, containment]
  check: "the subnet CIDR is contained in at least one CIDR block of its VPC"
  message: { vi: "CIDR của subnet nằm ngoài CIDR của VPC.", en: "The subnet CIDR is outside the VPC CIDR." }
  fix: { vi: "Đổi CIDR của subnet hoặc của VPC.", en: "Change the subnet CIDR or the VPC CIDR." }
  source: AWS-SUBNET
  status: verified

- id: VAL-005
  severity: error
  applies_to: [subnet, containment]
  check: "no two subnets of the same VPC have overlapping IPv4 CIDRs"
  message: { vi: "Hai subnet trong cùng VPC bị chồng dải IP.", en: "Two subnets in the same VPC have overlapping IP ranges." }
  fix: { vi: "Đổi CIDR để không chồng nhau.", en: "Change a CIDR so they do not overlap." }
  source: AWS-SUBNET
  status: verified

- id: VAL-006
  severity: warning
  applies_to: [subnet]
  check: "the subnet has availability_zone (or availability_zone_id) set"
  message: { vi: "Subnet chưa chọn Availability Zone; AWS sẽ tự chọn nên kết quả không cố định.", en: "The subnet has no Availability Zone; AWS picks one, so the result is not deterministic." }
  fix: { vi: "Chọn AZ cho từng subnet.", en: "Choose an AZ for every subnet." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/subnet.html.markdown
  status: verified          # the argument is optional (verified); treating its absence as a warning is a platform policy

- id: VAL-007
  severity: error
  applies_to: [igw-attach]
  check: "a VPC has at most one internet gateway"
  message: { vi: "Một VPC chỉ gắn được một Internet Gateway.", en: "A VPC can have only one internet gateway." }
  fix: { vi: "Xoá bớt Internet Gateway.", en: "Remove the extra internet gateway." }
  source: AWS-QUOTA
  status: verified

- id: VAL-008
  severity: warning
  applies_to: [igw-attach]
  check: "every internet gateway is attached to a VPC"
  message: { vi: "Internet Gateway chưa gắn vào VPC nên không có tác dụng.", en: "The internet gateway is not attached to a VPC, so it does nothing." }
  fix: { vi: "Đặt nó vào một VPC hoặc xoá đi.", en: "Place it in a VPC or delete it." }
  source: AWS-IGW
  status: verified

- id: VAL-009
  severity: error
  applies_to: [route]
  check: "every route has exactly one destination and exactly one target"
  message: { vi: "Mỗi route phải có đúng một đích đến và một target.", en: "Every route needs exactly one destination and one target." }
  fix: { vi: "Giữ lại một destination và một target.", en: "Keep one destination and one target." }
  source: TF-ROUTE
  status: verified

- id: VAL-010
  severity: error
  applies_to: [route]
  check: "a route target is in the same VPC as the route table, and an internet gateway target is attached to that VPC"
  message: { vi: "Target của route phải thuộc cùng VPC với route table.", en: "The route target must be in the same VPC as the route table." }
  fix: { vi: "Nối tới gateway trong cùng VPC.", en: "Connect to a gateway in the same VPC." }
  source: AWS-RT
  status: verified

- id: VAL-011
  severity: error
  applies_to: [nat-placement]
  check: "a public zonal NAT gateway is in a subnet of the VPC and has an Elastic IP allocation"
  message: { vi: "NAT Gateway công khai cần một subnet trong VPC và một Elastic IP.", en: "A public NAT gateway needs a subnet in the VPC and an Elastic IP." }
  fix: { vi: "Đặt vào subnet; nền tảng tự tạo Elastic IP.", en: "Place it in a subnet; the platform creates the Elastic IP." }
  source: AWS-NAT
  status: verified

- id: VAL-012
  severity: warning
  applies_to: [nat-placement, route]
  check: "the subnet of a public zonal NAT gateway has a route table with a route to an internet gateway attached to the VPC"
  message: { vi: "Subnet chứa NAT Gateway không có route ra Internet Gateway, NAT sẽ không ra được Internet.", en: "The NAT gateway's subnet has no route to an internet gateway, so the NAT gateway cannot reach the internet." }
  fix: { vi: "Gắn subnet với route table có route 0.0.0.0/0 tới Internet Gateway.", en: "Associate the subnet with a route table that has a 0.0.0.0/0 route to the internet gateway." }
  source: AWS-NAT
  status: verified

- id: VAL-013
  severity: warning
  applies_to: [route, nat-placement]
  check: "a subnet whose route table targets a NAT gateway is in the same availability zone as that gateway"
  message: { vi: "Subnet đang dùng NAT Gateway ở AZ khác: tốn phí cross-AZ và phụ thuộc AZ đó.", en: "The subnet uses a NAT gateway in another AZ: cross-AZ cost and dependence on that AZ." }
  fix: { vi: "Tạo một NAT Gateway cho mỗi AZ.", en: "Create one NAT gateway per AZ." }
  source: AWS-NAT
  status: verified          # resilience guidance is verified; the cost part is unverified

- id: VAL-014
  severity: error
  applies_to: [route-association]
  check: "a subnet has at most one explicit route table association"
  message: { vi: "Một subnet chỉ dùng được một route table.", en: "A subnet can use only one route table." }
  fix: { vi: "Giữ một route table.", en: "Keep one route table." }
  source: AWS-RT
  status: verified

- id: VAL-015
  severity: error
  applies_to: [route-association]
  check: "a route table and the subnet it is associated with are in the same VPC"
  message: { vi: "Route table và subnet phải cùng VPC.", en: "The route table and subnet must be in the same VPC." }
  fix: { vi: "Dùng route table của cùng VPC.", en: "Use a route table from the same VPC." }
  source: null
  status: unverified

- id: VAL-016
  severity: error
  applies_to: [route]
  check: "a route table has no two routes with the same destination"
  message: { vi: "Route table có hai route cùng đích đến.", en: "The route table has two routes with the same destination." }
  fix: { vi: "Xoá route trùng.", en: "Remove the duplicate route." }
  source: null
  status: unverified

- id: VAL-017
  severity: error
  applies_to: [route]
  check: "no route destination equals or lies inside 169.254.168.0/22 or fd00:ec2::/32"
  message: { vi: "Không thể tạo route tới dải IP dành riêng cho AWS.", en: "You cannot add a route to an address range reserved for AWS." }
  fix: { vi: "Đổi đích đến.", en: "Change the destination." }
  source: AWS-RT
  status: verified

- id: VAL-018
  severity: error
  applies_to: [security-group]
  check: "the name is at most 255 characters, uses only a-z A-Z 0-9 space . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *, and does not start with sg-"
  message: { vi: "Tên Security Group không hợp lệ (độ dài, ký tự hoặc bắt đầu bằng sg-).", en: "The security group name is invalid (length, characters, or it starts with sg-)." }
  fix: { vi: "Đổi tên, ví dụ thêm tiền tố av2i-.", en: "Rename it, for example with an av2i- prefix." }
  source: AWS-SG
  status: verified

- id: VAL-019
  severity: error
  applies_to: [security-group]
  check: "security group names are unique within a VPC, compared without case"
  message: { vi: "Hai Security Group trong một VPC trùng tên (không phân biệt hoa thường).", en: "Two security groups in one VPC share a name (case-insensitive)." }
  fix: { vi: "Đổi tên một nhóm.", en: "Rename one group." }
  source: AWS-SG
  status: verified

- id: VAL-020
  severity: error
  applies_to: [security-group]
  check: "the description is not empty, is at most 255 characters and uses the allowed character set"
  message: { vi: "Mô tả Security Group không được để trống và phải đúng bộ ký tự.", en: "The security group description cannot be empty and must use the allowed characters." }
  fix: { vi: "Nhập mô tả hợp lệ.", en: "Enter a valid description." }
  source: AWS-SG
  status: verified

- id: VAL-021
  severity: error
  applies_to: [sg-attach]
  check: "a resource has at most the configured security groups per network interface (default 5)"
  message: { vi: "Một resource gắn quá số Security Group cho phép (mặc định 5).", en: "A resource has more security groups than allowed (default 5)." }
  fix: { vi: "Gộp bớt nhóm.", en: "Merge groups." }
  source: AWS-QUOTA
  status: verified

- id: VAL-022
  severity: error
  applies_to: [security-group]
  check: "each security group has at most the configured rules per direction and IP family (default 60), counting prefix lists by size"
  message: { vi: "Security Group vượt quá số rule cho phép (mặc định 60 mỗi chiều).", en: "The security group exceeds the allowed number of rules (default 60 per direction)." }
  fix: { vi: "Gộp rule hoặc tách nhóm.", en: "Merge rules or split the group." }
  source: AWS-QUOTA
  status: verified

- id: VAL-023
  severity: error
  applies_to: [sg-reference, security-group]
  check: "each rule has exactly one peer: IPv4 CIDR, IPv6 CIDR, prefix list or security group"
  message: { vi: "Mỗi rule cần đúng một nguồn/đích.", en: "Each rule needs exactly one source or destination." }
  fix: { vi: "Giữ lại một nguồn/đích.", en: "Keep one source or destination." }
  source: TF-SGR
  status: verified

- id: VAL-024
  severity: error
  applies_to: [security-group]
  check: "for tcp and udp rules, ports are integers from 0 to 65535 with from <= to; ports are absent for all-protocol rules; for icmp they are type and code"
  message: { vi: "Cổng của rule không hợp lệ.", en: "The rule's ports are not valid." }
  fix: { vi: "Nhập cổng 0-65535.", en: "Enter ports from 0 to 65535." }
  source: TF-SGR
  status: unverified          # the numeric bounds are general knowledge; the port requirements per protocol are verified

- id: VAL-025
  severity: error
  applies_to: [sg-reference]
  check: "a security group referenced by a rule is in the same VPC as the owning group"
  message: { vi: "Rule tham chiếu tới Security Group ở VPC khác.", en: "The rule references a security group in another VPC." }
  fix: { vi: "Dùng nhóm cùng VPC hoặc CIDR.", en: "Use a group in the same VPC or a CIDR." }
  source: AWS-SGR
  status: verified

- id: VAL-026
  severity: error
  applies_to: [sg-reference, security-group]
  check: "a security group has no two rules identical in direction, protocol, ports and peer"
  message: { vi: "Security Group có hai rule giống hệt nhau; AWS từ chối rule trùng.", en: "The security group has two identical rules; AWS rejects duplicates." }
  fix: { vi: "Xoá rule trùng.", en: "Remove the duplicate." }
  source: null
  status: unverified

- id: VAL-027
  severity: error
  applies_to: [sg-attach, containment]
  check: "a security group is attached only to resources in the same VPC"
  message: { vi: "Security Group chỉ gắn được cho resource cùng VPC.", en: "A security group can only be attached to resources in the same VPC." }
  fix: { vi: "Dùng nhóm của cùng VPC.", en: "Use a group from the same VPC." }
  source: AWS-SG
  status: verified

- id: VAL-028
  severity: error
  applies_to: [route, nat-placement]
  check: "the route table of a NAT gateway's own subnet does not send 0.0.0.0/0 to that NAT gateway"
  message: { vi: "Subnet của NAT Gateway đang route 0.0.0.0/0 về chính nó; lưu lượng bị lặp.", en: "The NAT gateway's own subnet routes 0.0.0.0/0 to itself, so traffic loops." }
  fix: { vi: "Route 0.0.0.0/0 của subnet này tới Internet Gateway.", en: "Route 0.0.0.0/0 of this subnet to the internet gateway." }
  source: null
  status: unverified          # follows from the verified requirement that the NAT subnet routes to an internet gateway

# Compute and containers

- id: VAL-029
  severity: error
  applies_to: [sg-attach, ec2, ecs, lambda, rds, alb]
  check: "every resource that takes security groups (EC2, ECS service, Lambda attached to a VPC, RDS, ALB) has at least one explicitly attached security group"
  message: { vi: "Resource chưa gắn Security Group nào. Nền tảng không dùng nhóm mặc định của VPC.", en: "The resource has no security group attached. The platform does not use the VPC default group." }
  fix: { vi: "Tạo và gắn một Security Group cho resource.", en: "Create and attach a security group." }
  source: https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
  status: verified            # AWS behaviour verified; making it an error is decision D-005

- id: VAL-030
  severity: error
  applies_to: [ec2]
  check: "an EC2 instance has ami, instance_type and exactly one subnet, and the subnet is in the same VPC as its security groups"
  message: { vi: "EC2 cần AMI, loại instance và đúng một subnet.", en: "An EC2 instance needs an AMI, an instance type and exactly one subnet." }
  fix: { vi: "Điền đủ ba thông tin và đặt vào một subnet.", en: "Fill in all three and place it in one subnet." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/instance.html.markdown
  status: verified            # the provider allows a launch template instead of ami and instance_type; the platform does not model it

- id: VAL-031
  severity: warning
  applies_to: [ec2, egress-path]
  check: "an EC2 instance that gets a public IPv4 address is in a subnet whose route table has a route to an attached internet gateway"
  message: { vi: "EC2 có IP công khai nhưng subnet không có route ra Internet Gateway.", en: "The instance has a public IP but its subnet has no route to an internet gateway." }
  fix: { vi: "Thêm route 0.0.0.0/0 tới Internet Gateway hoặc bỏ IP công khai.", en: "Add a 0.0.0.0/0 route to the internet gateway or remove the public IP." }
  source: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html
  status: verified

- id: VAL-032
  severity: info
  applies_to: [egress-path, ec2, ecs, lambda]
  check: "a workload attached to a private subnet whose route table has no route to a NAT gateway has internet_egress = false"
  message: { vi: "Workload này không có đường ra Internet; chỉ truy cập được tài nguyên trong VPC.", en: "This workload has no path to the internet; it can reach only resources in the VPC." }
  fix: { vi: "Thêm NAT Gateway và route 0.0.0.0/0 nếu workload cần ra Internet.", en: "Add a NAT gateway and a 0.0.0.0/0 route if the workload needs the internet." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html
  status: verified            # severity is info because a workload that only talks inside the VPC is valid

- id: VAL-033
  severity: error
  applies_to: [lambda]
  check: "a Lambda function has exactly one code source (filename, s3_bucket with s3_key, or image_uri); Zip functions have handler and runtime; Image functions have package_type = Image"
  message: { vi: "Lambda cần đúng một nguồn code; hàm Zip cần handler và runtime.", en: "A Lambda function needs exactly one code source; Zip functions need a handler and runtime." }
  fix: { vi: "Chọn một nguồn code và điền các trường bắt buộc.", en: "Choose one code source and fill the required fields." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lambda_function.html.markdown
  status: verified

- id: VAL-034
  severity: error
  applies_to: [lambda]
  check: "memory_size is 128 to 10240 MB, timeout is 1 to 900 seconds, ephemeral storage is 512 to 10240 MB, there are at most 5 layers, and environment variables total at most 4 KB"
  message: { vi: "Cấu hình Lambda vượt giới hạn của AWS.", en: "The Lambda configuration exceeds an AWS limit." }
  fix: { vi: "Giảm giá trị xuống trong giới hạn.", en: "Reduce the value to within the limit." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
  status: verified            # the provider page lists 32768 MB for memory, which applies to Managed Instances; the AWS quotas page is used for classic functions

- id: VAL-035
  severity: error
  applies_to: [image-source, lambda, ecr]
  check: "a Lambda function's container image is in an ECR repository in the same Region, targets one architecture matching architectures, and is at most 10 GB uncompressed"
  message: { vi: "Image của Lambda phải ở ECR cùng Region, một kiến trúc, tối đa 10 GB.", en: "A Lambda image must be in ECR in the same Region, one architecture, at most 10 GB." }
  fix: { vi: "Dùng repository cùng Region và build một kiến trúc.", en: "Use a repository in the same Region and build one architecture." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
  status: verified

- id: VAL-036
  severity: error
  applies_to: [lambda, sg-attach]
  check: "if a Lambda function has any of subnet_ids or security_group_ids, it has at least one of each"
  message: { vi: "Lambda gắn VPC cần ít nhất một subnet và một Security Group.", en: "A Lambda attached to a VPC needs at least one subnet and one security group." }
  fix: { vi: "Chọn subnet và Security Group, hoặc bỏ cấu hình VPC.", en: "Choose subnets and a security group, or remove the VPC configuration." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lambda_function.html.markdown
  status: verified

- id: VAL-037
  severity: warning
  applies_to: [lambda, ecs]
  check: "a Lambda function attached to a VPC, or an ECS service, uses subnets in at least two availability zones"
  message: { vi: "Chỉ dùng một AZ: nếu AZ đó lỗi thì dịch vụ dừng.", en: "Only one AZ is used: if it fails, the service stops." }
  fix: { vi: "Chọn subnet ở ít nhất hai AZ.", en: "Choose subnets in at least two AZs." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html
  status: verified            # the two-AZ recommendation is stated for Lambda; applying it to ECS is platform policy

- id: VAL-038
  severity: warning
  applies_to: [lambda, egress-path]
  check: "a Lambda function is not attached to a subnet whose route table has a route to an internet gateway"
  message: { vi: "Lambda trong subnet public không có Internet và không có IP công khai.", en: "A Lambda in a public subnet gets no internet access and no public IP." }
  fix: { vi: "Gắn vào subnet private có NAT Gateway.", en: "Attach to private subnets that have a NAT gateway." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  status: verified

- id: VAL-039
  severity: error
  applies_to: [lambda, vpc]
  check: "a Lambda function is not attached to a VPC whose instance_tenancy is dedicated"
  message: { vi: "Lambda không gắn được vào VPC có tenancy dedicated.", en: "Lambda cannot attach to a VPC with dedicated tenancy." }
  fix: { vi: "Dùng VPC tenancy mặc định.", en: "Use a VPC with default tenancy." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  status: verified

- id: VAL-040
  severity: error
  applies_to: [ecs]
  check: "the Fargate task cpu and memory form a valid pair from the Fargate task size table in services/ecs.md"
  message: { vi: "Cặp CPU và memory của task Fargate không hợp lệ.", en: "The Fargate CPU and memory pair is not valid." }
  fix: { vi: "Chọn cặp trong bảng kích thước task.", en: "Choose a pair from the task size table." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html
  status: verified

- id: VAL-041
  severity: error
  applies_to: [ecs, sg-attach]
  check: "an ECS Fargate service has 1 to 16 subnets and 1 to 5 security groups, all in one VPC"
  message: { vi: "Service ECS cần 1-16 subnet và 1-5 Security Group cùng VPC.", en: "An ECS service needs 1 to 16 subnets and 1 to 5 security groups in one VPC." }
  fix: { vi: "Điều chỉnh số lượng.", en: "Adjust the counts." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  status: verified

- id: VAL-042
  severity: warning
  applies_to: [ecs, image-source, egress-path]
  check: "an ECS Fargate task whose image is in a private registry has internet_egress = true or an ECR interface endpoint in its VPC"
  message: { vi: "Task Fargate không có đường để kéo image.", en: "The Fargate task has no path to pull its image." }
  fix: { vi: "Dùng subnet private có NAT Gateway, hoặc subnet public với IP công khai.", en: "Use private subnets with a NAT gateway, or public subnets with a public IP." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  status: verified            # the endpoint option exists but the endpoint is a Tier 2 service and is not modelled yet

- id: VAL-043
  severity: error
  applies_to: [ecs, listener-target]
  check: "an ECS Fargate service behind a load balancer uses an Application or Network Load Balancer and a target group of target type ip"
  message: { vi: "Service Fargate chỉ dùng ALB/NLB và target group kiểu ip.", en: "A Fargate service works only with ALB or NLB and an ip target group." }
  fix: { vi: "Dùng target group kiểu ip.", en: "Use an ip target group." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  status: verified

- id: VAL-044
  severity: error
  applies_to: [ecs, image-source, assume-role]
  check: "an ECS task definition has an execution role when its image is in a private ECR repository, it uses the awslogs driver, or it reads secrets"
  message: { vi: "Task definition cần execution role (kéo image, ghi log, đọc secret).", en: "The task definition needs an execution role (pull image, write logs, read secrets)." }
  fix: { vi: "Gắn một role với chính sách AmazonECSTaskExecutionRolePolicy.", en: "Attach a role with AmazonECSTaskExecutionRolePolicy." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
  status: verified

- id: VAL-045
  severity: warning
  applies_to: [ecs, egress-path]
  check: "an ECS service with assign_public_ip = true uses only subnets whose route table has a route to an internet gateway"
  message: { vi: "IP công khai không có tác dụng trong subnet private.", en: "A public IP has no effect in a private subnet." }
  fix: { vi: "Tắt IP công khai hoặc dùng subnet public.", en: "Turn off the public IP or use public subnets." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  status: verified

- id: VAL-046
  severity: error
  applies_to: [ecs]
  check: "an ECS service does not set both launch_type and capacity_provider_strategy, and does not use DAEMON scheduling on Fargate"
  message: { vi: "launch_type và capacity_provider_strategy xung đột; DAEMON không hỗ trợ Fargate.", en: "launch_type and capacity_provider_strategy conflict; DAEMON is not supported on Fargate." }
  fix: { vi: "Chọn một cách và dùng REPLICA.", en: "Choose one and use REPLICA." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_service.html.markdown
  status: verified

- id: VAL-047
  severity: error
  applies_to: [ecr]
  check: "an ECR repository has at most one lifecycle policy, with at most 50 rules and 30,720 characters"
  message: { vi: "Lifecycle policy của ECR vượt giới hạn (1 policy, 50 rule, 30.720 ký tự).", en: "The ECR lifecycle policy exceeds a limit (one policy, 50 rules, 30,720 characters)." }
  fix: { vi: "Gộp rule vào một policy và rút gọn.", en: "Merge rules into one policy and shorten it." }
  source: https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html
  status: verified

- id: VAL-048
  severity: error
  applies_to: [ecs, containment]
  check: "an ECS service references one cluster and one task definition, and the cluster and the service's subnets are in the same Region"
  message: { vi: "Service ECS cần một cluster và một task definition.", en: "An ECS service needs a cluster and a task definition." }
  fix: { vi: "Chọn cluster và task definition.", en: "Choose a cluster and a task definition." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_service.html.markdown
  status: verified

- id: VAL-049
  severity: error
  applies_to: [network-access, lambda]
  check: "a network-access connection whose caller is a Lambda function and whose callee is a resource in a VPC requires the function to be attached to that VPC"
  message: { vi: "Lambda chưa gắn VPC nên không gọi được tài nguyên riêng tư.", en: "The Lambda function is not attached to the VPC, so it cannot reach private resources." }
  fix: { vi: "Gắn Lambda vào subnet của VPC.", en: "Attach the function to subnets of the VPC." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  status: verified

# Storage and databases

- id: VAL-050
  severity: error
  applies_to: [s3]
  check: "the bucket name is 3 to 63 characters of lowercase letters, digits, periods and hyphens, begins and ends with a letter or digit, has no two adjacent periods, is not formatted as an IP address, does not start with xn--, sthree- or amzn-s3-demo-, and does not end with -s3alias, --ol-s3, .mrap, --x-s3 or --table-s3; the suffix -an is allowed only in the account regional namespace"
  message: { vi: "Tên bucket S3 không hợp lệ.", en: "The S3 bucket name is not valid." }
  fix: { vi: "Dùng chữ thường, số và dấu gạch ngang; 3-63 ký tự.", en: "Use lowercase letters, digits and hyphens; 3 to 63 characters." }
  source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
  status: verified            # global uniqueness cannot be checked at design time

- id: VAL-051
  severity: error
  applies_to: [resource-policy, s3]
  check: "the generated configuration has at most one bucket policy resource per bucket, built from all statements that relations require"
  message: { vi: "Một bucket chỉ có một bucket policy; các statement phải được gộp lại.", en: "A bucket has only one bucket policy; the statements must be merged." }
  fix: { vi: "Gộp các statement vào một policy.", en: "Merge the statements into one policy." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/s3_bucket_policy.html.markdown
  status: verified

- id: VAL-052
  severity: error
  applies_to: [resource-policy, s3]
  check: "when the bucket's block_public_policy is true, no bucket policy statement allows a wildcard principal without a fixed condition value"
  message: { vi: "Policy cho phép truy cập công khai nhưng Block Public Access đang chặn.", en: "The policy allows public access but Block Public Access forbids it." }
  fix: { vi: "Giới hạn principal hoặc điều kiện, hoặc cố ý tắt block_public_policy.", en: "Restrict the principal or condition, or turn off block_public_policy on purpose." }
  source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
  status: verified

- id: VAL-053
  severity: error
  applies_to: [resource-policy, s3]
  check: "the merged bucket policy document is at most 20 KB"
  message: { vi: "Bucket policy vượt 20 KB.", en: "The bucket policy exceeds 20 KB." }
  fix: { vi: "Rút gọn statement hoặc dùng nhiều bucket.", en: "Shorten the statements or split across buckets." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/s3_bucket_policy.html.markdown
  status: verified

- id: VAL-054
  severity: error
  applies_to: [resource-policy, s3, origin]
  check: "a bucket used as a CloudFront origin through origin access control is a regular bucket (not a website endpoint) and has Object Ownership BucketOwnerEnforced or BucketOwnerPreferred"
  message: { vi: "Bucket không dùng được với CloudFront OAC (website endpoint hoặc ownership ObjectWriter).", en: "The bucket cannot be used with CloudFront OAC (website endpoint or ObjectWriter ownership)." }
  fix: { vi: "Dùng endpoint thường và Object Ownership BucketOwnerEnforced.", en: "Use the regular endpoint and BucketOwnerEnforced ownership." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  status: verified

- id: VAL-055
  severity: error
  applies_to: [resource-policy, s3, alb]
  check: "a bucket receiving ALB access logs is in the same Region as the load balancer, uses SSE-S3 default encryption, and its policy allows logdelivery.elasticloadbalancing.amazonaws.com to s3:PutObject on <prefix>/AWSLogs/<account-id>/*"
  message: { vi: "Bucket nhận log ALB sai Region, sai kiểu mã hoá hoặc thiếu quyền ghi.", en: "The ALB log bucket is in the wrong Region, uses the wrong encryption, or lacks write permission." }
  fix: { vi: "Dùng bucket cùng Region, SSE-S3 và policy cho log delivery.", en: "Use a bucket in the same Region with SSE-S3 and the log delivery policy." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
  status: verified

- id: VAL-056
  severity: error
  applies_to: [s3]
  check: "a bucket has at most one lifecycle configuration; every rule has an id of at most 255 characters, a status and an action; its filter is empty or exactly one filter element; rules using noncurrent versions require versioning Enabled"
  message: { vi: "Lifecycle của bucket không hợp lệ.", en: "The bucket lifecycle configuration is not valid." }
  fix: { vi: "Một cấu hình lifecycle, mỗi rule một hành động, bật versioning nếu dùng noncurrent.", en: "One lifecycle configuration, an action per rule, versioning on for noncurrent rules." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/s3_bucket_lifecycle_configuration.html.markdown
  status: verified

- id: VAL-057
  severity: error
  applies_to: [s3]
  check: "a bucket with object_lock_enabled has versioning Enabled; versioning is never Disabled after having been Enabled"
  message: { vi: "Object Lock cần versioning bật và không thể tắt.", en: "Object Lock needs versioning on and it cannot be turned off." }
  fix: { vi: "Giữ versioning bật.", en: "Keep versioning enabled." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/s3_bucket.html.markdown
  status: verified

- id: VAL-058
  severity: error
  applies_to: [db-subnet-group, rds]
  check: "an RDS DB subnet group has 2 to 20 subnets, all in one VPC, covering at least two different availability zones"
  message: { vi: "Nhóm subnet của RDS cần 2-20 subnet cùng VPC, thuộc ít nhất hai AZ.", en: "An RDS DB subnet group needs 2 to 20 subnets in one VPC across at least two AZs." }
  fix: { vi: "Thêm subnet ở AZ thứ hai.", en: "Add a subnet in a second AZ." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  status: verified

- id: VAL-059
  severity: error
  applies_to: [rds]
  check: "the DB instance identifier is 1 to 63 alphanumeric characters or hyphens, starts with a letter, does not end with a hyphen, has no two consecutive hyphens, and is unique per account and Region"
  message: { vi: "Identifier của RDS không hợp lệ.", en: "The RDS identifier is not valid." }
  fix: { vi: "Bắt đầu bằng chữ cái; chỉ chữ, số và dấu gạch ngang.", en: "Start with a letter; use only letters, digits and hyphens." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
  status: verified

- id: VAL-060
  severity: error
  applies_to: [rds]
  check: "a DB instance has engine, instance_class, allocated_storage, username, a DB subnet group, and either a password or manage_master_user_password"
  message: { vi: "RDS thiếu thông tin bắt buộc.", en: "The RDS instance is missing required settings." }
  fix: { vi: "Điền engine, loại instance, dung lượng, tên người dùng, nhóm subnet và mật khẩu.", en: "Fill in engine, instance class, storage, username, subnet group and password." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown
  status: verified

- id: VAL-061
  severity: error
  applies_to: [rds]
  check: "a supplied master password uses printable ASCII without / ' \" @ or a space, and is 8 to 41 characters for MySQL or 8 to 128 for PostgreSQL"
  message: { vi: "Mật khẩu master không hợp lệ.", en: "The master password is not valid." }
  fix: { vi: "Dùng 8+ ký tự, tránh / ' \" @ và dấu cách; hoặc dùng mật khẩu do RDS quản lý.", en: "Use 8 or more characters avoiding / ' \" @ and spaces; or let RDS manage it." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html
  status: verified

- id: VAL-062
  severity: warning
  applies_to: [rds, db-subnet-group]
  check: "if publicly_accessible is true, every subnet in the DB subnet group has a route table with a route to an internet gateway, and the VPC has DNS support and DNS hostnames enabled"
  message: { vi: "RDS công khai nhưng subnet không public hoặc VPC tắt DNS, sẽ không truy cập được từ Internet.", en: "The RDS instance is public but its subnets are not public or VPC DNS is off, so it is unreachable from the internet." }
  fix: { vi: "Dùng subnet public và bật DNS, hoặc tắt publicly_accessible.", en: "Use public subnets and turn DNS on, or turn off publicly_accessible." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  status: verified

- id: VAL-063
  severity: error
  applies_to: [rds]
  check: "backup_retention_period is 0 to 35 and backup_window does not overlap maintenance_window"
  message: { vi: "Cửa sổ backup trùng cửa sổ bảo trì hoặc thời gian lưu backup ngoài 0-35.", en: "The backup window overlaps the maintenance window or retention is outside 0 to 35." }
  fix: { vi: "Đổi giờ để không trùng.", en: "Change the times so they do not overlap." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown
  status: verified

- id: VAL-064
  severity: error
  applies_to: [rds]
  check: "when skip_final_snapshot is false, final_snapshot_identifier is set, starts with a letter, uses only alphanumerics and hyphens, does not end with a hyphen and has no consecutive hyphens"
  message: { vi: "Thiếu hoặc sai tên snapshot cuối cùng.", en: "The final snapshot identifier is missing or invalid." }
  fix: { vi: "Đặt tên snapshot hợp lệ hoặc bật skip_final_snapshot.", en: "Set a valid snapshot name or set skip_final_snapshot." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown
  status: verified

- id: VAL-065
  severity: error
  applies_to: [rds]
  check: "max_allocated_storage, when set above 0, is greater than or equal to allocated_storage"
  message: { vi: "max_allocated_storage phải lớn hơn hoặc bằng allocated_storage.", en: "max_allocated_storage must be at least allocated_storage." }
  fix: { vi: "Tăng giá trị tối đa.", en: "Raise the maximum." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown
  status: verified

- id: VAL-066
  severity: error
  applies_to: [rds, vpc]
  check: "in a VPC with instance_tenancy dedicated, the DB instance class is an approved dedicated instance class"
  message: { vi: "VPC dedicated chỉ chạy được các instance class được hỗ trợ.", en: "A dedicated-tenancy VPC supports only approved dedicated instance classes." }
  fix: { vi: "Đổi instance class hoặc dùng VPC tenancy mặc định.", en: "Change the instance class or use a default-tenancy VPC." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  status: verified            # the list of approved classes is not held here

- id: VAL-067
  severity: error
  applies_to: [rds, db-subnet-group]
  check: "multi_az is true only when the DB subnet group has subnets in at least two availability zones"
  message: { vi: "Multi-AZ cần subnet ở ít nhất hai AZ.", en: "Multi-AZ needs subnets in at least two AZs." }
  fix: { vi: "Thêm subnet ở AZ khác.", en: "Add a subnet in another AZ." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  status: verified

- id: VAL-068
  severity: error
  applies_to: [network-access, rds]
  check: "for a network-access connection to an RDS instance, the generated ingress rule covers the instance's port (the configured port, else the engine default)"
  message: { vi: "Rule không mở đúng cổng của cơ sở dữ liệu.", en: "The rule does not open the database's port." }
  fix: { vi: "Dùng cổng của engine hoặc cổng đã cấu hình.", en: "Use the engine port or the configured port." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown
  status: unverified          # the engine default ports 5432 and 3306 are general knowledge

- id: VAL-069
  severity: error
  applies_to: [rds]
  check: "manage_master_user_password is not combined with password or password_wo, and is not combined with read replicas of that source or blue/green deployments"
  message: { vi: "Không dùng đồng thời mật khẩu tự đặt và mật khẩu do RDS quản lý.", en: "A supplied password and an RDS-managed password cannot be used together." }
  fix: { vi: "Chọn một cách.", en: "Choose one." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html
  status: verified

- id: VAL-070
  severity: warning
  applies_to: [s3, egress-path, grant]
  check: "a workload that uses an S3 bucket and is in a private subnet has internet_egress = true, or a gateway VPC endpoint for S3 is attached to its route table"
  message: { vi: "Workload ở subnet private không có đường tới S3 (cần NAT Gateway hoặc VPC endpoint).", en: "The workload in a private subnet has no path to S3 (needs a NAT gateway or a VPC endpoint)." }
  fix: { vi: "Thêm NAT Gateway hoặc VPC endpoint cho S3.", en: "Add a NAT gateway or an S3 VPC endpoint." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html
  status: verified            # S3 is a public endpoint and the gateway endpoint exists; the endpoint itself is a Tier 2 service and is not modelled yet

# Delivery and certificates

- id: VAL-071
  severity: error
  applies_to: [alb, containment]
  check: "an ALB has at least two subnets, each in a different availability zone, all in one VPC and of the same zone type"
  message: { vi: "ALB cần ít nhất hai subnet ở hai AZ khác nhau trong cùng VPC.", en: "An ALB needs at least two subnets in two different AZs of one VPC." }
  fix: { vi: "Thêm subnet ở AZ thứ hai.", en: "Add a subnet in a second AZ." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  status: verified

- id: VAL-072
  severity: warning
  applies_to: [alb, subnet]
  check: "every ALB subnet has an IPv4 netmask of /27 or larger and at least eight free addresses"
  message: { vi: "Subnet của ALB nhỏ hơn /27 hoặc thiếu IP trống, ALB không scale được.", en: "An ALB subnet is smaller than /27 or short of free IPs, so the ALB cannot scale." }
  fix: { vi: "Dùng subnet /27 trở lên với ít nhất 8 IP trống.", en: "Use a /27 or larger subnet with at least 8 free IPs." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  status: verified

- id: VAL-073
  severity: error
  applies_to: [alb]
  check: "the load balancer name is at most 32 characters, alphanumeric or hyphens, with no leading or trailing hyphen, and is unique in the account"
  message: { vi: "Tên ALB không hợp lệ.", en: "The ALB name is not valid." }
  fix: { vi: "Tối đa 32 ký tự, chỉ chữ, số và dấu gạch ngang.", en: "Use at most 32 characters of letters, digits and hyphens." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb.html.markdown
  status: verified

- id: VAL-074
  severity: warning
  applies_to: [alb, route-association]
  check: "an internet-facing ALB (internal = false) is in subnets whose route tables have a route to an attached internet gateway"
  message: { vi: "ALB hướng Internet nhưng subnet không public.", en: "An internet-facing ALB is in subnets that are not public." }
  fix: { vi: "Dùng subnet public hoặc đặt ALB là internal.", en: "Use public subnets or make the ALB internal." }
  source: null
  status: unverified          # follows from how a public subnet is defined; the ALB page read does not state it

- id: VAL-075
  severity: error
  applies_to: [alb, cert-attach]
  check: "an HTTPS listener has exactly one default certificate and an ssl_policy; the certificate key is not ED25519"
  message: { vi: "Listener HTTPS cần một chứng chỉ mặc định và một chính sách SSL.", en: "An HTTPS listener needs one default certificate and an SSL policy." }
  fix: { vi: "Gắn chứng chỉ ACM và chọn ssl_policy.", en: "Attach an ACM certificate and choose an ssl_policy." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html
  status: verified

- id: VAL-076
  severity: error
  applies_to: [alb, listener-target]
  check: "a listener default action is forward (1 to 5 target groups, weights 0 to 999), redirect (status HTTP_301 or HTTP_302) or fixed-response (content_type set, status 2XX, 4XX or 5XX); the protocol is HTTP or HTTPS and the port 1 to 65535"
  message: { vi: "Hành động mặc định của listener không hợp lệ.", en: "The listener default action is not valid." }
  fix: { vi: "Chọn forward, redirect hoặc fixed-response đúng giá trị.", en: "Choose forward, redirect or fixed-response with valid values." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_listener.html.markdown
  status: verified

- id: VAL-077
  severity: error
  applies_to: [alb, listener-target]
  check: "a target group of type instance or ip has port, protocol and vpc_id; a lambda target group has none of them and no health check protocol"
  message: { vi: "Target group thiếu hoặc thừa port, protocol, VPC so với kiểu target.", en: "The target group has missing or extra port, protocol or VPC for its target type." }
  fix: { vi: "instance/ip cần cả ba; lambda không dùng.", en: "instance and ip need all three; lambda uses none." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_target_group.html.markdown
  status: verified

- id: VAL-078
  severity: error
  applies_to: [alb, listener-target]
  check: "a target group is referenced by the listeners of exactly one load balancer"
  message: { vi: "Một target group chỉ dùng cho một ALB.", en: "A target group can be used by only one ALB." }
  fix: { vi: "Tạo target group riêng cho mỗi ALB.", en: "Create a separate target group for each ALB." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
  status: verified

- id: VAL-079
  severity: error
  applies_to: [alb, listener-target]
  check: "a target group holds targets of one type only (instance IDs or IP addresses, not both), and a lambda target group holds exactly one function"
  message: { vi: "Target group chứa lẫn kiểu target hoặc nhiều hơn một hàm Lambda.", en: "The target group mixes target types or holds more than one Lambda function." }
  fix: { vi: "Tách target group theo kiểu.", en: "Split target groups by type." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
  status: verified

- id: VAL-080
  severity: error
  applies_to: [alb, listener-target]
  check: "an ip target is in a subnet of the target group's VPC or in 10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12 or 192.168.0.0/16, and is never a public address"
  message: { vi: "Địa chỉ target nằm ngoài dải cho phép hoặc là IP công khai.", en: "The target address is outside the allowed ranges or is a public IP." }
  fix: { vi: "Dùng IP riêng trong VPC hoặc dải RFC 1918/6598.", en: "Use a private IP in the VPC or an RFC 1918 or 6598 range." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
  status: verified

- id: VAL-081
  severity: error
  applies_to: [alb, lambda, resource-policy]
  check: "a Lambda function used as an ALB target has an aws_lambda_permission allowing elasticloadbalancing.amazonaws.com, and the target group attachment depends on it"
  message: { vi: "Lambda làm target chưa cho phép ALB gọi.", en: "The Lambda target does not allow the ALB to invoke it." }
  fix: { vi: "Thêm quyền gọi hàm cho elasticloadbalancing.amazonaws.com.", en: "Add an invoke permission for elasticloadbalancing.amazonaws.com." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_target_group_attachment.html.markdown
  status: verified

- id: VAL-082
  severity: error
  applies_to: [alb, network-access, sg-attach]
  check: "the ALB security groups allow the listener ports inbound and the target and health check ports outbound, and each target's security groups allow the target port and the health check port from the ALB group"
  message: { vi: "Security Group của ALB hoặc target chặn cổng listener, cổng target hoặc cổng health check.", en: "A security group blocks the listener, target or health check port." }
  fix: { vi: "Mở các cổng đó giữa ALB và target.", en: "Open those ports between the ALB and its targets." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  status: verified            # the page states the two-way requirement; the exact rule form is derived

- id: VAL-083
  severity: error
  applies_to: [alb]
  check: "health check interval is 5 to 300 seconds, timeout 2 to 120, thresholds 2 to 10, a matcher in 200 to 499, a path for HTTP and HTTPS, and for lambda the interval exceeds the function timeout"
  message: { vi: "Cấu hình health check không hợp lệ.", en: "The health check settings are not valid." }
  fix: { vi: "Điều chỉnh về khoảng cho phép.", en: "Adjust to the allowed ranges." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lb_target_group.html.markdown
  status: verified

- id: VAL-084
  severity: error
  applies_to: [alb]
  check: "the design stays within 50 ALBs per Region, 50 listeners, 100 rules, 25 extra certificates and 1,000 targets per ALB, and 100 target groups per ALB (configurable settings)"
  message: { vi: "Vượt giới hạn của ALB.", en: "An ALB limit is exceeded." }
  fix: { vi: "Giảm số lượng hoặc nâng quota.", en: "Reduce the count or raise the quota." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
  status: verified

- id: VAL-085
  severity: error
  applies_to: [dns-alias, route53]
  check: "a record has exactly one of records or alias; an alias record has no ttl and no records"
  message: { vi: "Bản ghi alias không được kèm TTL hoặc giá trị.", en: "An alias record cannot also have a TTL or values." }
  fix: { vi: "Chỉ dùng alias hoặc chỉ dùng records.", en: "Use either alias or records." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route53_record.html.markdown
  status: verified

- id: VAL-086
  severity: error
  applies_to: [dns-alias]
  check: "an alias record's zone_id is the hosted zone ID of its target (the load balancer's zone, or CloudFront's global zone), and its name is the target's DNS name"
  message: { vi: "Alias dùng sai hosted zone ID của target.", en: "The alias uses the wrong hosted zone ID for its target." }
  fix: { vi: "Lấy zone ID và tên DNS từ chính target.", en: "Take the zone ID and DNS name from the target itself." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/route53_record.html.markdown
  status: verified            # the CloudFront zone ID constant itself is unverified

- id: VAL-087
  severity: error
  applies_to: [dns-alias, route53]
  check: "no CNAME record has the same name as its hosted zone"
  message: { vi: "Không tạo được CNAME ở apex của zone.", en: "A CNAME cannot be created at the zone apex." }
  fix: { vi: "Dùng bản ghi alias A/AAAA.", en: "Use an A or AAAA alias record." }
  source: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html
  status: verified

- id: VAL-088
  severity: error
  applies_to: [dns-alias, cloudfront, cert-attach]
  check: "an alias to a CloudFront distribution is in a public hosted zone, and the distribution lists the name in aliases with a certificate that covers it"
  message: { vi: "Tên chưa được CloudFront và chứng chỉ phủ, hoặc zone không public.", en: "The name is not listed in CloudFront with a covering certificate, or the zone is not public." }
  fix: { vi: "Thêm tên vào aliases của distribution và chứng chỉ.", en: "Add the name to the distribution aliases and certificate." }
  source: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
  status: verified

- id: VAL-089
  severity: warning
  applies_to: [dns-alias, cloudfront]
  check: "when a distribution has is_ipv6_enabled, each of its alias names has both an A and an AAAA alias record"
  message: { vi: "CloudFront bật IPv6 nhưng thiếu bản ghi AAAA.", en: "The distribution has IPv6 on but an AAAA record is missing." }
  fix: { vi: "Thêm bản ghi AAAA alias.", en: "Add an AAAA alias record." }
  source: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
  status: verified

- id: VAL-090
  severity: error
  applies_to: [route53]
  check: "the design stays within 500 hosted zones per account and 10,000 records per zone (configurable settings), and records of one name and type are unique unless they use a routing policy"
  message: { vi: "Vượt giới hạn Route 53 hoặc trùng bản ghi.", en: "A Route 53 limit is exceeded or a record is duplicated." }
  fix: { vi: "Giảm số bản ghi hoặc xoá bản ghi trùng.", en: "Reduce the records or remove the duplicate." }
  source: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/DNSLimitations.html
  status: verified

- id: VAL-091
  severity: error
  applies_to: [cloudfront, origin]
  check: "an S3 origin uses origin_access_control_id and the regular bucket endpoint; an S3 website endpoint or an ALB uses custom_origin_config; an origin never has both s3_origin_config and an OAC for the same need"
  message: { vi: "Origin S3 hoặc ALB cấu hình sai kiểu.", en: "The S3 or ALB origin is configured with the wrong type." }
  fix: { vi: "S3 thường dùng OAC; website endpoint và ALB dùng custom origin.", en: "Regular S3 uses OAC; website endpoints and ALBs use a custom origin." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  status: verified

- id: VAL-092
  severity: error
  applies_to: [cloudfront]
  check: "a distribution has at least one origin; the default behaviour has target_origin_id, viewer_protocol_policy, allowed_methods, cached_methods and a cache policy and no path_pattern; ordered behaviours have a path_pattern; every target_origin_id names an existing origin; custom_error_response sets response_code and response_page_path together"
  message: { vi: "Cấu hình behaviour của CloudFront thiếu trường bắt buộc.", en: "A CloudFront behaviour is missing required fields." }
  fix: { vi: "Điền đủ các trường bắt buộc.", en: "Fill in the required fields." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/cloudfront_distribution.html.markdown
  status: verified

- id: VAL-093
  severity: error
  applies_to: [cloudfront, cert-attach, acm]
  check: "every distribution alias is covered by the viewer certificate (an exact SAN match or a wildcard at the same level) and the ACM certificate is in us-east-1"
  message: { vi: "Alias chưa được chứng chỉ phủ hoặc chứng chỉ không ở us-east-1.", en: "An alias is not covered by the certificate or the certificate is not in us-east-1." }
  fix: { vi: "Tạo chứng chỉ ở us-east-1 phủ đủ tên.", en: "Create a certificate in us-east-1 that covers every name." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  status: verified

- id: VAL-094
  severity: error
  applies_to: [cloudfront, cert-attach]
  check: "a distribution has exactly one of acm_certificate_arn, iam_certificate_id and cloudfront_default_certificate, and ssl_support_method with an ACM or IAM certificate; a distribution with aliases does not use the default certificate"
  message: { vi: "viewer_certificate không hợp lệ.", en: "The viewer certificate is not valid." }
  fix: { vi: "Chọn đúng một nguồn chứng chỉ và đặt ssl_support_method.", en: "Choose one certificate source and set ssl_support_method." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/cloudfront_distribution.html.markdown
  status: verified

- id: VAL-095
  severity: error
  applies_to: [cloudfront]
  check: "a distribution has at most 100 aliases, 100 origins and 75 cache behaviours; an account at most 500 distributions and 100 origin access controls (configurable settings)"
  message: { vi: "Vượt giới hạn của CloudFront.", en: "A CloudFront limit is exceeded." }
  fix: { vi: "Giảm số lượng hoặc nâng quota.", en: "Reduce the count or raise the quota." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html
  status: verified

- id: VAL-096
  severity: error
  applies_to: [cloudfront, origin, resource-policy]
  check: "an origin access control for a private bucket has origin type s3, signing_behavior always (or no-override), signing_protocol sigv4, and the bucket policy allows the distribution"
  message: { vi: "OAC không hợp lệ hoặc bucket policy chưa cho phép distribution.", en: "The OAC is not valid or the bucket policy does not allow the distribution." }
  fix: { vi: "Dùng signing always và thêm statement cho distribution.", en: "Use signing always and add a statement for the distribution." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  status: verified

- id: VAL-097
  severity: error
  applies_to: [cloudfront, origin]
  check: "origin connection_attempts is 1 to 3, connection_timeout 1 to 10 seconds, and origin_read_timeout and origin_keepalive_timeout are within the account limits (60 seconds by default)"
  message: { vi: "Timeout hoặc số lần thử của origin ngoài giới hạn.", en: "An origin timeout or attempt count is out of range." }
  fix: { vi: "Đặt trong khoảng cho phép.", en: "Set within the allowed range." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/cloudfront_distribution.html.markdown
  status: verified

- id: VAL-098
  severity: warning
  applies_to: [cloudfront, origin, cert-attach]
  check: "when CloudFront reaches an ALB origin over HTTPS, a name in the ALB certificate matches the origin domain name"
  message: { vi: "Chứng chỉ của ALB không khớp tên origin, CloudFront sẽ trả 502.", en: "The ALB certificate does not match the origin name, so CloudFront returns 502." }
  fix: { vi: "Dùng tên origin có trong chứng chỉ của ALB.", en: "Use an origin name present in the ALB certificate." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  status: verified

- id: VAL-099
  severity: error
  applies_to: [acm]
  check: "an ACM certificate has a domain_name, at most the configured number of names (default 10), and DNS validation"
  message: { vi: "Chứng chỉ ACM thiếu tên miền, quá số tên cho phép hoặc không dùng DNS.", en: "The ACM certificate has no domain, too many names, or is not DNS-validated." }
  fix: { vi: "Điền tên miền, giảm số tên và dùng DNS.", en: "Set a domain, reduce the names and use DNS." }
  source: https://docs.aws.amazon.com/acm/latest/userguide/acm-limits.html
  status: verified

- id: VAL-100
  severity: error
  applies_to: [acm, cert-validation]
  check: "every distinct validation record of a certificate is created in the hosted zone the domain is delegated to, and the certificate validation resource depends on those records"
  message: { vi: "Thiếu bản ghi CNAME xác thực hoặc zone không được ủy quyền; chứng chỉ sẽ treo rồi hết hạn sau 72 giờ.", en: "A validation CNAME is missing or the zone is not delegated; the certificate hangs and times out after 72 hours." }
  fix: { vi: "Tạo bản ghi trong đúng hosted zone và trỏ NS của domain về zone đó.", en: "Create the records in the right hosted zone and delegate the domain to it." }
  source: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
  status: verified

- id: VAL-101
  severity: error
  applies_to: [acm, cert-attach]
  check: "an ACM certificate used by CloudFront is in us-east-1; a certificate used by an ALB listener is in the ALB's Region"
  message: { vi: "Chứng chỉ ACM sai Region cho dịch vụ dùng nó.", en: "The ACM certificate is in the wrong Region for the service using it." }
  fix: { vi: "CloudFront dùng us-east-1; ALB dùng cùng Region với ALB.", en: "Use us-east-1 for CloudFront and the ALB's own Region for an ALB." }
  source: https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html
  status: unverified          # us-east-1 for CloudFront is verified; the same-Region rule for load balancers is general knowledge

- id: VAL-102
  severity: error
  applies_to: [acm, cert-attach, dns-alias]
  check: "every name served by a listener or alias (an HTTPS listener's host names, a distribution alias, a DNS alias name for an HTTPS service) is covered by the attached certificate"
  message: { vi: "Chứng chỉ không phủ tên được dùng.", en: "The certificate does not cover a name in use." }
  fix: { vi: "Thêm tên vào chứng chỉ hoặc dùng wildcard cùng cấp.", en: "Add the name to the certificate or use a wildcard at the same level." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
  status: verified            # the coverage rule is stated for CloudFront; applying it to ALB names is standard TLS behaviour

# IAM

- id: VAL-103
  severity: error
  applies_to: [iam-role]
  check: "the role name is at most 64 characters of letters, digits and + = , . @ _ -, and is unique in the account when compared without case"
  message: { vi: "Tên role không hợp lệ hoặc trùng (không phân biệt hoa thường).", en: "The role name is invalid or duplicated (case-insensitive)." }
  fix: { vi: "Tối đa 64 ký tự, chỉ ký tự cho phép.", en: "Use at most 64 characters from the allowed set." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  status: verified

- id: VAL-104
  severity: error
  applies_to: [iam-role, assume-role]
  check: "a role's trust policy has at least one statement with Effect Allow, Action sts:AssumeRole and a Principal that is a service principal from the assume-role registry"
  message: { vi: "Trust policy của role thiếu hoặc không hợp lệ.", en: "The role's trust policy is missing or not valid." }
  fix: { vi: "Dùng service principal của dịch vụ dùng role và sts:AssumeRole.", en: "Use the consuming service's principal and sts:AssumeRole." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  status: verified

- id: VAL-105
  severity: error
  applies_to: [assume-role]
  check: "the trust policy of a role lists the service principal of every consumer that uses it in a given slot (ec2.amazonaws.com, lambda.amazonaws.com, ecs-tasks.amazonaws.com, monitoring.rds.amazonaws.com)"
  message: { vi: "Trust policy không có service principal của dịch vụ dùng role.", en: "The trust policy lacks the service principal of the service using the role." }
  fix: { vi: "Thêm service principal tương ứng.", en: "Add the matching service principal." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  status: verified

- id: VAL-106
  severity: warning
  applies_to: [iam-role, assume-role, grant]
  check: "every role is assumed by at least one consumer; a role with none is not emitted and its grants are dropped"
  message: { vi: "Role chưa được resource nào sử dụng nên sẽ không được tạo.", en: "No resource uses this role, so it will not be created." }
  fix: { vi: "Nối role với EC2, Lambda hoặc ECS.", en: "Connect the role to an EC2 instance, Lambda function or ECS service." }
  source: null
  status: unverified          # platform policy, not an AWS rule

- id: VAL-107
  severity: error
  applies_to: [iam-role, iam-policy]
  check: "a role has at most 20 managed policies attached (default quota, raisable to 25)"
  message: { vi: "Role gắn quá số managed policy cho phép.", en: "The role has more managed policies than allowed." }
  fix: { vi: "Gộp policy hoặc dùng inline policy.", en: "Merge policies or use an inline policy." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  status: verified

- id: VAL-108
  severity: error
  applies_to: [iam-role, iam-policy]
  check: "a role's trust policy is at most 2,048 characters, all its inline policies together at most 10,240 characters and each managed policy at most 6,144 characters, white space not counted"
  message: { vi: "Policy vượt giới hạn kích thước.", en: "A policy exceeds its size limit." }
  fix: { vi: "Rút gọn hoặc tách policy.", en: "Shorten or split the policy." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  status: verified

- id: VAL-109
  severity: error
  applies_to: [iam-role, ec2]
  check: "an instance profile contains exactly one role and has a unique name of at most 128 characters; an EC2 instance uses at most one instance profile, referenced by name"
  message: { vi: "Instance profile chỉ chứa một role và tên phải duy nhất.", en: "An instance profile holds one role and needs a unique name." }
  fix: { vi: "Tạo instance profile riêng cho mỗi role.", en: "Create a separate instance profile for each role." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html
  status: verified

- id: VAL-110
  severity: error
  applies_to: [lambda, assume-role]
  check: "every Lambda function has exactly one execution role"
  message: { vi: "Hàm Lambda bắt buộc có execution role.", en: "A Lambda function requires an execution role." }
  fix: { vi: "Gắn một role cho hàm.", en: "Attach a role to the function." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/lambda_function.html.markdown
  status: verified

- id: VAL-111
  severity: error
  applies_to: [lambda, assume-role]
  check: "the execution role of a Lambda function attached to a VPC holds the network interface permissions (AWSLambdaVPCAccessExecutionRole, or ec2:CreateNetworkInterface, DescribeNetworkInterfaces, DescribeSubnets, DeleteNetworkInterface, AssignPrivateIpAddresses, UnassignPrivateIpAddresses on *)"
  message: { vi: "Role của Lambda trong VPC thiếu quyền quản lý network interface.", en: "The Lambda role lacks the network interface permissions a VPC-attached function needs." }
  fix: { vi: "Gắn AWSLambdaVPCAccessExecutionRole.", en: "Attach AWSLambdaVPCAccessExecutionRole." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  status: verified

- id: VAL-112
  severity: error
  applies_to: [ecs, assume-role, grant]
  check: "an ECS service whose application is the target of a grant, or is meant to call other AWS services, has a task role"
  message: { vi: "Service ECS cần task role để ứng dụng gọi dịch vụ AWS khác.", en: "The ECS service needs a task role for the application to call other AWS services." }
  fix: { vi: "Gắn task role và cấp quyền cho nó.", en: "Attach a task role and grant it the permissions." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  status: verified

- id: VAL-113
  severity: error
  applies_to: [ecs, assume-role, grant]
  check: "when enable_execute_command is true, the task role allows ssmmessages:CreateControlChannel, CreateDataChannel, OpenControlChannel and OpenDataChannel"
  message: { vi: "ECS Exec bật nhưng task role thiếu quyền ssmmessages.", en: "ECS Exec is on but the task role lacks the ssmmessages permissions." }
  fix: { vi: "Thêm bốn quyền ssmmessages vào task role.", en: "Add the four ssmmessages permissions to the task role." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  status: verified

- id: VAL-114
  severity: error
  applies_to: [rds, assume-role]
  check: "a DB instance with monitoring_interval above 0 has a monitoring role that trusts monitoring.rds.amazonaws.com and holds AmazonRDSEnhancedMonitoringRole"
  message: { vi: "RDS bật Enhanced Monitoring nhưng thiếu role giám sát hợp lệ.", en: "RDS Enhanced Monitoring is on but there is no valid monitoring role." }
  fix: { vi: "Tạo role giám sát hoặc đặt monitoring_interval = 0.", en: "Create a monitoring role or set monitoring_interval to 0." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
  status: verified            # trust principal and policy name verified; the ARN path of the managed policy is not

- id: VAL-115
  severity: error
  applies_to: [assume-role]
  check: "a role and the service it is passed to are in the same AWS account"
  message: { vi: "Chỉ truyền được role cho dịch vụ trong cùng tài khoản.", en: "A role can be passed only to a service in the same account." }
  fix: { vi: "Dùng role trong cùng tài khoản.", en: "Use a role from the same account." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
  status: verified

- id: VAL-116
  severity: error
  applies_to: [ecs, assume-role, image-source]
  check: "an ECS task execution role holds AmazonECSTaskExecutionRolePolicy, or the equivalent ECR pull (ecr:GetAuthorizationToken, ecr:BatchGetImage, ecr:GetDownloadUrlForLayer) and CloudWatch Logs actions, plus secretsmanager:GetSecretValue or ssm:GetParameters for referenced secrets"
  message: { vi: "Execution role của ECS thiếu quyền kéo image, ghi log hoặc đọc secret.", en: "The ECS execution role lacks permissions to pull the image, write logs or read secrets." }
  fix: { vi: "Gắn AmazonECSTaskExecutionRolePolicy và bổ sung quyền secret nếu cần.", en: "Attach AmazonECSTaskExecutionRolePolicy and add secret permissions if needed." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
  status: verified

- id: VAL-117
  severity: error
  applies_to: [iam-policy, resource-policy]
  check: "an identity policy statement has Effect, Action (or NotAction) and Resource (or NotResource); a trust or resource-based policy statement has a Principal; the version is 2012-10-17 and the text uses only allowed characters"
  message: { vi: "Cấu trúc policy không hợp lệ.", en: "The policy structure is not valid." }
  fix: { vi: "Điền đủ Effect, Action, Resource (hoặc Principal với trust/resource policy).", en: "Fill in Effect, Action, Resource (or Principal for trust and resource policies)." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/d/iam_policy_document.html.markdown
  status: unverified          # the elements and the Resource requirement are verified; that an identity policy must not carry a Principal was not stated on the pages read

- id: VAL-118
  severity: error
  applies_to: [iam-role]
  check: "a role's policies are managed either with inline_policy and managed_policy_arns on the role or with aws_iam_role_policy and aws_iam_role_policy_attachment, never both; the platform uses the separate resources only, and never aws_iam_policy_attachment"
  message: { vi: "Không trộn cách quản lý policy của role.", en: "Do not mix the ways of managing a role's policies." }
  fix: { vi: "Chỉ dùng aws_iam_role_policy và aws_iam_role_policy_attachment.", en: "Use only aws_iam_role_policy and aws_iam_role_policy_attachment." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/iam_role.html.markdown
  status: verified

- id: VAL-119
  severity: error
  applies_to: [grant]
  check: "a grant names a target kind and level from the grant registry, and its generated statements use the target's exact ARN (bucket versus objects, repository, database user)"
  message: { vi: "Grant không hợp lệ: sai loại target, mức quyền hoặc ARN.", en: "The grant is not valid: wrong target kind, level or ARN." }
  fix: { vi: "Chọn mức quyền có trong danh sách của target.", en: "Choose a level from the target's list." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  status: verified

- id: VAL-120
  severity: error
  applies_to: [iam-role, iam-policy]
  check: "an inline policy name is at most 128 characters, unique within its role, and contains none of backslash, slash, asterisk, question mark or white space; a managed policy name is at most 128 characters"
  message: { vi: "Tên inline policy không hợp lệ.", en: "The inline policy name is not valid." }
  fix: { vi: "Bỏ các ký tự \\ / * ? và dấu cách.", en: "Remove the characters \\ / * ? and spaces." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  status: verified

- id: VAL-121
  severity: error
  applies_to: [iam-role, iam-policy]
  check: "the design stays within 1,000 roles, 1,500 customer managed policies and 1,000 instance profiles per account (configurable settings)"
  message: { vi: "Vượt giới hạn IAM của tài khoản.", en: "An account IAM limit is exceeded." }
  fix: { vi: "Giảm số lượng hoặc nâng quota.", en: "Reduce the count or raise the quota." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
  status: verified
```

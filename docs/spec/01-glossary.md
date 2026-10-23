---
id: glossary
title: { vi: "Thuật ngữ", en: "Glossary" }
status: unverified
note: "Definitions restate the service and relation files, which hold the sources. Terms stay in English in the Vietnamese text (see conventions section 3)."
terms:
  - { term: Availability Zone, abbr: AZ, vi: "Một cụm trung tâm dữ liệu tách biệt trong một Region. Subnet nằm trong đúng một AZ.", en: "An isolated group of data centres within a Region. A subnet lives in exactly one AZ.", see: services/subnet.md }
  - { term: Region, vi: "Vùng địa lý của AWS. Hầu hết resource thuộc đúng một Region; ACM cho CloudFront phải ở us-east-1.", en: "An AWS geographic area. Most resources belong to one Region; an ACM certificate for CloudFront must be in us-east-1.", see: relations/cert-attach.md }
  - { term: VPC, vi: "Mạng ảo riêng của bạn trong một Region, với một hoặc nhiều khối CIDR.", en: "Your private virtual network in a Region, with one or more CIDR blocks.", see: services/vpc.md }
  - { term: CIDR block, vi: "Dải địa chỉ IP viết dạng 10.0.0.0/16. Số sau dấu gạch là netmask.", en: "An IP address range written like 10.0.0.0/16. The number after the slash is the netmask.", see: services/vpc.md }
  - { term: Subnet, vi: "Một phần của VPC trong một AZ. Public hay private do route table quyết định, không phải do subnet.", en: "A slice of a VPC in one AZ. Public or private is decided by the route table, not by the subnet.", see: services/subnet.md }
  - { term: public subnet, vi: "Subnet có route table chứa route tới một Internet Gateway đã gắn vào VPC.", en: "A subnet whose route table has a route to an internet gateway attached to the VPC.", see: relations/route-association.md }
  - { term: private subnet, vi: "Subnet không có route tới Internet Gateway. Có thể ra Internet qua NAT Gateway.", en: "A subnet with no route to an internet gateway. It can reach the internet through a NAT gateway.", see: relations/egress-path.md }
  - { term: Internet Gateway, abbr: IGW, vi: "Cổng cho phép lưu lượng giữa VPC và Internet. Mỗi VPC có tối đa một.", en: "The gateway that carries traffic between a VPC and the internet. A VPC has at most one.", see: services/internet-gateway.md }
  - { term: NAT Gateway, vi: "Cho phép workload ở subnet private khởi tạo kết nối ra Internet mà không nhận kết nối vào. Zonal đặt trong subnet public và cần Elastic IP; regional không cần subnet.", en: "Lets workloads in private subnets start connections to the internet without accepting inbound ones. Zonal sits in a public subnet and needs an Elastic IP; regional needs no subnet.", see: services/nat-gateway.md }
  - { term: Elastic IP, abbr: EIP, vi: "Địa chỉ IPv4 công khai cố định. NAT Gateway công khai kiểu zonal cần một cái.", en: "A fixed public IPv4 address. A public zonal NAT gateway needs one.", see: decisions.md }
  - { term: Route Table, vi: "Danh sách route quyết định lưu lượng của subnet đi đâu. Một subnet dùng đúng một route table.", en: "A list of routes deciding where a subnet's traffic goes. A subnet uses exactly one.", see: services/route-table.md }
  - { term: route, vi: "Một dòng trong route table: đích (CIDR) và target (gateway).", en: "One entry in a route table: a destination (CIDR) and a target (a gateway).", see: relations/route.md }
  - { term: local route, vi: "Route mặc định cho lưu lượng bên trong VPC; không xoá được.", en: "The built-in route for traffic inside the VPC; it cannot be removed.", see: services/route-table.md }
  - { term: VPC endpoint, vi: "Đường riêng từ VPC tới một dịch vụ AWS mà không đi qua Internet. Có hai loại: gateway và interface.", en: "A private path from a VPC to an AWS service that does not cross the internet. Two kinds: gateway and interface.", see: services/vpc-endpoint-s3.md }
  - { term: gateway endpoint, vi: "Loại endpoint miễn phí đi qua route table, chỉ cho S3 và DynamoDB. Spec này chỉ có bản cho S3.", en: "The free endpoint type that works through route tables, for S3 and DynamoDB only. This spec has the S3 one only.", see: services/vpc-endpoint-s3.md }
  - { term: prefix list, vi: "Danh sách CIDR do AWS duy trì cho một dịch vụ. Endpoint S3 dùng nó làm đích route; security group có thể tham chiếu nó.", en: "A list of CIDRs AWS maintains for a service. The S3 endpoint uses it as the route destination; a security group can reference it.", see: services/vpc-endpoint-s3.md }
  - { term: endpoint policy, vi: "Policy gắn trên endpoint, thêm một lớp cho phép; mặc định cho phép tất cả. Với gateway endpoint Principal phải là *.", en: "A policy on the endpoint, one more layer that must allow; the default allows everything. For a gateway endpoint the Principal must be *.", see: services/vpc-endpoint-s3.md }
  - { term: Security Group, abbr: SG, vi: "Tường lửa có trạng thái gắn vào network interface. Chỉ có rule cho phép; mặc định chặn vào.", en: "A stateful firewall attached to a network interface. It has allow rules only and blocks inbound by default.", see: services/security-group.md }
  - { term: ingress rule, vi: "Rule cho phép lưu lượng vào.", en: "A rule that allows inbound traffic.", see: services/security-group.md }
  - { term: egress rule, vi: "Rule cho phép lưu lượng ra. Terraform xoá rule allow-all mặc định nên phải khai báo tường minh.", en: "A rule that allows outbound traffic. Terraform removes the default allow-all, so egress is declared explicitly.", see: terraform/pitfalls.md }
  - { term: network interface, abbr: ENI, vi: "Card mạng ảo. Security Group gắn vào ENI, không gắn vào instance. Mỗi task Fargate có một ENI.", en: "A virtual network card. Security groups attach to it, not to the instance. Each Fargate task has one.", see: services/ecs.md }
  - { term: EC2 instance, vi: "Máy ảo. Cần AMI, loại instance và một subnet.", en: "A virtual machine. Needs an AMI, an instance type and one subnet.", see: services/ec2.md }
  - { term: AMI, vi: "Ảnh máy ảo dùng để khởi tạo instance.", en: "A machine image an instance starts from.", see: services/ec2.md }
  - { term: instance profile, vi: "Vỏ bọc đưa một IAM role vào EC2. Mỗi profile chứa đúng một role.", en: "The wrapper that passes an IAM role to EC2. A profile holds exactly one role.", see: services/iam-role.md }
  - { term: Lambda function, vi: "Hàm chạy theo sự kiện, không quản lý server. Tối đa 900 giây mỗi lần gọi.", en: "Event-driven code with no server to manage. At most 900 seconds per invocation.", see: services/lambda.md }
  - { term: execution role, vi: "Role Lambda dùng để ghi log và, trong VPC, tạo network interface.", en: "The role Lambda uses to write logs and, in a VPC, to create network interfaces.", see: relations/assume-role.md }
  - { term: ECS, vi: "Dịch vụ chạy container. Spec này chỉ dùng launch type Fargate.", en: "The container service. This spec uses the Fargate launch type only.", see: services/ecs.md }
  - { term: Fargate, vi: "Chạy container không quản lý server. Luôn dùng awsvpc và một ENI cho mỗi task.", en: "Runs containers with no servers to manage. Always awsvpc, one ENI per task.", see: services/ecs.md }
  - { term: cluster, vi: "Nhóm logic các service ECS.", en: "A logical grouping of ECS services.", see: services/ecs.md }
  - { term: task definition, vi: "Bản thiết kế của task: image, CPU, bộ nhớ, role, port. Mỗi thay đổi tạo một revision mới.", en: "The blueprint of a task: image, CPU, memory, roles, ports. Every change creates a new revision.", see: services/ecs.md }
  - { term: ECS service, vi: "Giữ N task chạy, có thể sau load balancer.", en: "Keeps N tasks running, optionally behind a load balancer.", see: services/ecs.md }
  - { term: task role, vi: "Role mà code ứng dụng trong container dùng để gọi dịch vụ AWS.", en: "The role the application code inside the container uses to call AWS services.", see: relations/assume-role.md }
  - { term: task execution role, vi: "Role mà agent Fargate dùng để kéo image, ghi log, đọc secret. Container không thấy credential này.", en: "The role the Fargate agent uses to pull images, write logs and read secrets. Containers cannot see it.", see: relations/assume-role.md }
  - { term: ECR, vi: "Kho container image riêng. Dùng image qua repository_url.", en: "A private container image registry. Images are used through repository_url.", see: services/ecr.md }
  - { term: S3 bucket, vi: "Kho đối tượng. Tên bucket là duy nhất toàn cục.", en: "Object storage. A bucket name is globally unique.", see: services/s3.md }
  - { term: Block Public Access, vi: "Bốn cờ chặn truy cập công khai vào bucket. Provider mặc định là false nên phải đặt tường minh.", en: "Four flags that block public access to a bucket. The provider defaults them to false, so set them explicitly.", see: services/s3.md }
  - { term: bucket policy, vi: "Policy gắn trên bucket. Mỗi bucket chỉ có một; gộp mọi statement vào một tài liệu.", en: "A policy attached to the bucket. A bucket has only one; merge every statement into one document.", see: relations/resource-policy.md }
  - { term: RDS, vi: "Cơ sở dữ liệu quan hệ do AWS quản lý. Spec này chỉ dùng single instance PostgreSQL và MySQL.", en: "A managed relational database. This spec covers single instances of PostgreSQL and MySQL.", see: services/rds.md }
  - { term: DB subnet group, vi: "Nhóm 2 đến 20 subnet ở ít nhất hai AZ mà RDS dùng.", en: "The group of 2 to 20 subnets, in at least two AZs, that RDS uses.", see: relations/db-subnet-group.md }
  - { term: Multi-AZ, vi: "Bản dự phòng đồng bộ ở AZ khác để chuyển đổi khi lỗi.", en: "A synchronous standby in another AZ for failover.", see: services/rds.md }
  - { term: ALB, vi: "Application Load Balancer, cân bằng tải lớp 7. Cần ít nhất hai subnet ở hai AZ.", en: "Application Load Balancer, layer 7. Needs at least two subnets in two AZs.", see: services/alb.md }
  - { term: listener, vi: "Cổng và giao thức mà ALB lắng nghe, với một default action.", en: "The port and protocol an ALB listens on, with a default action.", see: services/alb.md }
  - { term: target group, vi: "Tập đích mà listener chuyển tiếp tới: kiểu instance, ip hoặc lambda. Chỉ dùng cho một ALB.", en: "The set of targets a listener forwards to: instance, ip or lambda. Used by exactly one ALB.", see: relations/listener-target.md }
  - { term: Route 53, vi: "Dịch vụ DNS. Spec này dùng public hosted zone, alias record và record xác thực.", en: "The DNS service. This spec uses public hosted zones, alias records and validation records.", see: services/route53.md }
  - { term: hosted zone, vi: "Bộ bản ghi DNS của một domain.", en: "The set of DNS records of a domain.", see: services/route53.md }
  - { term: alias record, vi: "Bản ghi DNS trỏ thẳng tới ALB hoặc CloudFront, không có TTL.", en: "A DNS record pointing straight at an ALB or CloudFront, with no TTL.", see: relations/dns-alias.md }
  - { term: CloudFront, vi: "CDN của AWS. Phục vụ S3 hoặc ALB làm origin.", en: "The AWS CDN. Serves S3 or an ALB as origin.", see: services/cloudfront.md }
  - { term: origin, vi: "Nơi CloudFront lấy nội dung.", en: "Where CloudFront fetches content from.", see: relations/origin.md }
  - { term: origin access control, abbr: OAC, vi: "Cách CloudFront ký request tới S3 để bucket giữ ở chế độ private.", en: "How CloudFront signs requests to S3 so the bucket stays private.", see: relations/origin.md }
  - { term: ACM, vi: "Dịch vụ cấp chứng chỉ TLS. Xác thực bằng DNS; apex và wildcard dùng chung một bản ghi CNAME.", en: "The TLS certificate service. Validates through DNS; an apex and its wildcard share one CNAME.", see: services/acm.md }
  - { term: DNS validation, vi: "Chứng minh quyền sở hữu domain bằng một bản ghi CNAME. Phải giữ lại để tự gia hạn.", en: "Proves domain ownership with a CNAME record. It must stay for renewal.", see: relations/cert-validation.md }
  - { term: IAM role, vi: "Danh tính có quyền tạm thời mà workload đảm nhận. Gồm trust policy và permission policy.", en: "An identity with temporary permissions that a workload assumes. Has a trust policy and permission policies.", see: services/iam-role.md }
  - { term: trust policy, vi: "Policy nói ai được đảm nhận role (service principal như ec2.amazonaws.com).", en: "The policy saying who may assume the role (a service principal such as ec2.amazonaws.com).", see: relations/assume-role.md }
  - { term: permission policy, vi: "Policy nói role được làm gì trên tài nguyên nào.", en: "The policy saying what the role may do on which resources.", see: services/iam-policy.md }
  - { term: managed policy, vi: "Policy có sẵn do AWS cung cấp, ví dụ AWSLambdaBasicExecutionRole.", en: "A policy supplied by AWS, for example AWSLambdaBasicExecutionRole.", see: services/iam-policy.md }
  - { term: iam:PassRole, vi: "Quyền giao một role cho một service. Quyền này cùng quyền tạo role là đường leo thang đặc quyền.", en: "The permission to hand a role to a service. With role-creation permissions it is a privilege escalation path.", see: decisions.md }
  - { term: service principal, vi: "Danh tính của một dịch vụ AWS trong policy, ví dụ lambda.amazonaws.com.", en: "The identity of an AWS service in a policy, for example lambda.amazonaws.com.", see: relations/assume-role.md }
  - { term: least privilege, vi: "Chỉ cấp đúng quyền cần thiết, đúng tài nguyên cần thiết.", en: "Grant only the permissions needed, on only the resources needed.", see: rules/security.md }
  - { term: grant, vi: "Khái niệm của nền tảng: quyền của một role trên một đích, sinh thành statement IAM.", en: "A platform concept: a role's permissions on a target, generated into IAM statements.", see: relations/grant.md }
  - { term: mechanism, vi: "Một kiểu kết nối giữa resource, như route hay assume-role.", en: "A kind of connection between resources, such as route or assume-role.", see: relations/00-mechanisms.md }
  - { term: derived connection, vi: "Kết nối nền tảng tự tính và báo cáo, người dùng không vẽ (egress-path).", en: "A connection the platform computes and reports; the user does not draw it (egress-path).", see: relations/00-mechanisms.md }
  - { term: generated connection, vi: "Kết nối nền tảng sinh ra từ kết nối khác, như rule sg-reference từ network-access.", en: "A connection the platform produces from other connections, such as sg-reference rules from network-access.", see: 00-conventions.md }
  - { term: provider alias, vi: "Cấu hình provider thứ hai cho Region khác, cần cho chứng chỉ CloudFront ở us-east-1.", en: "A second provider configuration for another Region, needed for the CloudFront certificate in us-east-1.", see: decisions.md }
  - { term: ForceNew, vi: "Thuộc tính mà đổi giá trị sẽ huỷ và tạo lại resource.", en: "An argument whose change destroys and recreates the resource.", see: terraform/pitfalls.md }
  - { term: unverified, vi: "Mục chưa đối chiếu được với tài liệu AWS hoặc provider.", en: "An item not yet checked against the AWS or provider documentation.", see: README.md }
---

# Glossary

Terms the specification uses, in English as AWS writes them, with a short explanation in Vietnamese and English. The
front matter is the source of truth; the owning file in `see` holds the detail and the sources.

Terms appear here once. Where a term has a rule attached, the rule lives in [rules/validation.md](rules/validation.md) or
[rules/security.md](rules/security.md), never in the glossary.

---
id: security-rules
title: { vi: "Luật bảo mật", en: "Security rules" }
source_aliases:
  AWS-SG: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  AWS-DEFSG: https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html
---
# Security rules

Rules about whether a design is safe, not whether it deploys. Severity scale is in
[../00-conventions.md](../00-conventions.md). This file covers the networking group (SEC-001 to 005), the compute and container group (SEC-006 to 011) and the storage and database group (SEC-012 to 023) and the delivery and certificate group (SEC-024 to 034) and the IAM group (SEC-035 to 042) and the S3 gateway endpoint group (SEC-043 to 044).

Source aliases: AWS-SG https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html,
AWS-DEFSG https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html.

```yaml
- id: SEC-001
  severity: error
  applies_to: [security-group]
  check: "an ingress rule allows protocol all, or every TCP/UDP port, from 0.0.0.0/0 or ::/0"
  message: { vi: "Security Group mở mọi cổng cho toàn bộ Internet.", en: "The security group opens every port to the whole internet." }
  fix: { vi: "Chỉ mở cổng cần thiết, giới hạn nguồn.", en: "Open only needed ports and restrict the source." }
  source: AWS-SG          # guidance: do not open large port ranges; restrict access
  status: verified        # the guidance is verified; classifying it as an error is platform policy

- id: SEC-002
  severity: warning
  applies_to: [security-group]
  check: "an ingress rule allows port 22 (SSH) or 3389 (RDP) from 0.0.0.0/0 or ::/0"
  message: { vi: "SSH hoặc RDP đang mở cho toàn bộ Internet.", en: "SSH or RDP is open to the whole internet." }
  fix: { vi: "Giới hạn theo dải IP của bạn hoặc dùng Session Manager.", en: "Restrict to your IP range or use Session Manager." }
  source: AWS-SG
  status: verified        # AWS states to authorise only specific ranges for 22 and 3389

- id: SEC-003
  severity: warning
  applies_to: [security-group]
  check: "an ingress rule from an address range or the internet covers more than 100 ports"
  message: { vi: "Rule mở dải cổng rộng.", en: "The rule opens a wide port range." }
  fix: { vi: "Thu hẹp dải cổng.", en: "Narrow the port range." }
  source: AWS-SG
  status: verified        # AWS advises against large port ranges; the 100-port threshold is a platform choice

- id: SEC-004
  severity: warning
  applies_to: [sg-attach]
  check: "a resource has no explicit security group and so falls back to the VPC default group"
  message: { vi: "Resource đang dùng Security Group mặc định của VPC.", en: "The resource uses the VPC's default security group." }
  fix: { vi: "Tạo Security Group riêng cho resource hoặc nhóm resource.", en: "Create a dedicated security group for the resource or group of resources." }
  source: AWS-DEFSG       # AWS recommends specific groups instead of the default group
  status: verified

- id: SEC-005
  severity: info
  applies_to: [vpc]
  check: "the VPC's default security group is not managed by the design, so it still has its default rules (allow all from itself, allow all outbound)"
  message: { vi: "Security Group mặc định của VPC vẫn cho phép mọi lưu lượng trong nhóm và ra ngoài.", en: "The VPC default security group still allows all traffic within the group and all outbound." }
  fix: { vi: "Quản lý nhóm mặc định bằng aws_default_security_group và không khai báo rule nào (D-006).", en: "Manage the default group with aws_default_security_group and declare no rules (D-006)." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/default_security_group.html.markdown
  status: verified      # the resource and its adopt-and-clear behaviour are verified; the CIS benchmark number is not cited

# Compute and containers

- id: SEC-006
  severity: warning
  applies_to: [ec2]
  check: "an instance's metadata_options.http_tokens is not required (IMDSv1 is accepted)"
  message: { vi: "EC2 vẫn cho phép IMDSv1.", en: "The instance still accepts IMDSv1." }
  fix: { vi: "Đặt http_tokens = required.", en: "Set http_tokens = required." }
  source: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
  status: verified        # AWS offers an IMDSv2-only setting; classifying IMDSv1 as a warning is platform policy

- id: SEC-007
  severity: warning
  applies_to: [ec2]
  check: "an instance's root_block_device.encrypted is false"
  message: { vi: "Ổ đĩa gốc của EC2 chưa mã hoá.", en: "The instance root volume is not encrypted." }
  fix: { vi: "Bật encrypted. Đổi giá trị này sau khi tạo sẽ thay thế instance.", en: "Enable encrypted. Changing it later replaces the instance." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/instance.html.markdown
  status: verified        # default false is verified; the warning is platform policy

- id: SEC-008
  severity: info
  applies_to: [lambda]
  check: "a Lambda function attached to a VPC has an execution role with the interface-management EC2 actions and no deny on lambda:SourceFunctionArn"
  message: { vi: "Code của Lambda cũng được cấp các quyền EC2 dùng để quản lý network interface.", en: "The function's code also holds the EC2 permissions used to manage network interfaces." }
  fix: { vi: "Thêm câu lệnh Deny với điều kiện lambda:SourceFunctionArn.", en: "Add a Deny statement with the lambda:SourceFunctionArn condition." }
  source: https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html
  status: verified

- id: SEC-009
  severity: info
  applies_to: [ecr]
  check: "image_scanning_configuration.scan_on_push is false"
  message: { vi: "ECR chưa quét image khi push.", en: "ECR does not scan images on push." }
  fix: { vi: "Bật scan_on_push.", en: "Enable scan_on_push." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecr_repository.html.markdown
  status: verified

- id: SEC-010
  severity: info
  applies_to: [ecr, image-source]
  check: "an ECR repository has image_tag_mutability = MUTABLE, or a consumer references the tag latest"
  message: { vi: "Tag có thể bị ghi đè nên cùng một tag có thể trỏ tới image khác.", en: "Tags can be overwritten, so the same tag can point to a different image." }
  fix: { vi: "Dùng IMMUTABLE hoặc tham chiếu theo digest.", en: "Use IMMUTABLE or reference by digest." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/ecr_repository.html.markdown
  status: verified

- id: SEC-011
  severity: warning
  applies_to: [ecs]
  check: "an ECS service has assign_public_ip = true"
  message: { vi: "Task ECS có IP công khai nên có thể truy cập từ Internet nếu Security Group cho phép.", en: "The ECS tasks have public IPs and are reachable from the internet if security groups allow it." }
  fix: { vi: "Dùng subnet private và ALB hoặc NAT Gateway.", en: "Use private subnets with an ALB or a NAT gateway." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html
  status: verified

# Storage and databases

- id: SEC-012
  severity: warning
  applies_to: [s3]
  check: "any of block_public_acls, ignore_public_acls, block_public_policy, restrict_public_buckets is false on a bucket that is not intentionally public"
  message: { vi: "Bucket chưa bật đủ bốn thiết lập Block Public Access.", en: "The bucket does not have all four Block Public Access settings on." }
  fix: { vi: "Bật cả bốn thiết lập.", en: "Turn on all four settings." }
  source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
  status: verified            # AWS recommends all four, and cites Security Hub control S3.8; the provider default for each is false

- id: SEC-013
  severity: info
  applies_to: [s3]
  check: "versioning is not Enabled"
  message: { vi: "Bucket chưa bật versioning nên ghi đè hoặc xoá là mất dữ liệu.", en: "Versioning is off, so an overwrite or delete loses data." }
  fix: { vi: "Bật versioning cho dữ liệu cần giữ.", en: "Turn on versioning for data that must be kept." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/s3_bucket_versioning.html.markdown
  status: verified            # the capability and its limits are verified; flagging it is platform policy

- id: SEC-014
  severity: info
  applies_to: [s3]
  check: "object_ownership is not BucketOwnerEnforced (ACLs are enabled)"
  message: { vi: "Bucket còn bật ACL.", en: "ACLs are enabled on the bucket." }
  fix: { vi: "Dùng BucketOwnerEnforced và quản lý quyền bằng policy.", en: "Use BucketOwnerEnforced and manage access with policies." }
  source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ensure-object-ownership.html
  status: verified

- id: SEC-015
  severity: info
  applies_to: [s3, resource-policy]
  check: "the bucket policy has no statement that denies requests where aws:SecureTransport is false"
  message: { vi: "Bucket chưa bắt buộc truy cập qua HTTPS.", en: "The bucket does not require HTTPS." }
  fix: { vi: "Thêm statement Deny khi aws:SecureTransport là false.", en: "Add a Deny statement when aws:SecureTransport is false." }
  source: null
  status: unverified          # general knowledge; confirm against the S3 documentation and the merge rule for the single policy

- id: SEC-016
  severity: info
  applies_to: [s3]
  check: "a bucket name contains information that identifies a person, project or secret"
  message: { vi: "Tên bucket hiện trong URL; đừng đưa thông tin nhạy cảm vào.", en: "The bucket name is visible in URLs; do not put sensitive information in it." }
  fix: { vi: "Đổi tên trung tính.", en: "Use a neutral name." }
  source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
  status: verified            # the guidance is verified; the check cannot be automated and is shown as a hint

- id: SEC-017
  severity: warning
  applies_to: [rds]
  check: "publicly_accessible is true"
  message: { vi: "Cơ sở dữ liệu có địa chỉ công khai.", en: "The database has a public address." }
  fix: { vi: "Đặt trong subnet private và truy cập qua ứng dụng.", en: "Put it in private subnets and reach it through the application." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html
  status: verified            # AWS shows the private-database pattern; the severity is platform policy

- id: SEC-018
  severity: warning
  applies_to: [rds]
  check: "storage_encrypted is false"
  message: { vi: "Ổ lưu trữ RDS chưa mã hoá; không thể bật sau khi tạo.", en: "RDS storage is not encrypted, and it cannot be turned on after creation." }
  fix: { vi: "Bật storage_encrypted ngay khi tạo.", en: "Turn on storage_encrypted at creation." }
  source: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html
  status: verified

- id: SEC-019
  severity: info
  applies_to: [rds]
  check: "deletion_protection is false"
  message: { vi: "RDS chưa bật bảo vệ xoá.", en: "Deletion protection is off." }
  fix: { vi: "Bật deletion_protection cho môi trường quan trọng.", en: "Turn on deletion_protection for important environments." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
  status: verified

- id: SEC-020
  severity: warning
  applies_to: [rds]
  check: "the master password is supplied through password instead of manage_master_user_password or password_wo"
  message: { vi: "Mật khẩu RDS nằm dạng văn bản thường trong Terraform state.", en: "The RDS password is stored in plain text in the Terraform state." }
  fix: { vi: "Dùng manage_master_user_password.", en: "Use manage_master_user_password." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
  status: verified

- id: SEC-021
  severity: warning
  applies_to: [rds]
  check: "backup_retention_period is 0"
  message: { vi: "RDS không có backup tự động.", en: "RDS has no automated backups." }
  fix: { vi: "Đặt backup_retention_period từ 1 trở lên.", en: "Set backup_retention_period to 1 or more." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
  status: verified

- id: SEC-022
  severity: info
  applies_to: [rds]
  check: "skip_final_snapshot is true"
  message: { vi: "Xoá RDS sẽ không tạo snapshot cuối cùng.", en: "Deleting the instance will not take a final snapshot." }
  fix: { vi: "Đặt skip_final_snapshot = false cho dữ liệu cần giữ.", en: "Set skip_final_snapshot to false for data that must be kept." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/db_instance.html.markdown
  status: verified

- id: SEC-023
  severity: error
  applies_to: [rds, security-group]
  check: "an ingress rule allows the database port of an instance (5432 PostgreSQL, 3306 MySQL, or the configured port) from 0.0.0.0/0 or ::/0"
  message: { vi: "Cổng cơ sở dữ liệu đang mở cho toàn bộ Internet.", en: "The database port is open to the whole internet." }
  fix: { vi: "Chỉ cho phép từ Security Group của ứng dụng.", en: "Allow only from the application's security group." }
  source: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html
  status: unverified          # the guidance on restricting sources is verified; the engine port numbers are general knowledge

# Delivery and certificates

- id: SEC-024
  severity: warning
  applies_to: [alb]
  check: "an internet-facing ALB has an HTTP listener whose default action is forward, or has no HTTPS listener"
  message: { vi: "ALB phục vụ HTTP thường, chưa chuyển hướng sang HTTPS.", en: "The ALB serves plain HTTP and does not redirect to HTTPS." }
  fix: { vi: "Thêm listener HTTPS và đặt hành động mặc định của HTTP là redirect.", en: "Add an HTTPS listener and make the HTTP default action a redirect." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_listener.html.markdown
  status: verified            # the redirect action is verified; requiring HTTPS is platform policy

- id: SEC-025
  severity: warning
  applies_to: [alb]
  check: "an HTTPS listener uses ssl_policy ELBSecurityPolicy-2016-08 (the provider default) or another policy older than a TLS 1.2 minimum"
  message: { vi: "Listener HTTPS dùng chính sách SSL cũ.", en: "The HTTPS listener uses an old SSL policy." }
  fix: { vi: "Dùng ELBSecurityPolicy-TLS13-1-2-2021-06.", en: "Use ELBSecurityPolicy-TLS13-1-2-2021-06." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb_listener.html.markdown
  status: verified            # the default is verified; calling it old is platform policy

- id: SEC-026
  severity: info
  applies_to: [alb]
  check: "drop_invalid_header_fields is false"
  message: { vi: "ALB chưa loại bỏ header không hợp lệ.", en: "The ALB does not drop invalid header fields." }
  fix: { vi: "Bật drop_invalid_header_fields.", en: "Turn on drop_invalid_header_fields." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
  status: verified

- id: SEC-027
  severity: info
  applies_to: [alb]
  check: "enable_deletion_protection is false"
  message: { vi: "ALB chưa bật bảo vệ xoá.", en: "ALB deletion protection is off." }
  fix: { vi: "Bật enable_deletion_protection cho môi trường quan trọng.", en: "Turn on enable_deletion_protection for important environments." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/lb.html.markdown
  status: verified

- id: SEC-028
  severity: info
  applies_to: [alb]
  check: "access logs are not enabled"
  message: { vi: "ALB chưa bật access log.", en: "ALB access logs are off." }
  fix: { vi: "Bật access_logs với bucket đúng yêu cầu.", en: "Turn on access_logs with a bucket that meets the requirements." }
  source: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
  status: verified

- id: SEC-029
  severity: warning
  applies_to: [cloudfront]
  check: "a cache behaviour has viewer_protocol_policy allow-all"
  message: { vi: "CloudFront cho phép viewer dùng HTTP thường.", en: "CloudFront allows viewers to use plain HTTP." }
  fix: { vi: "Dùng redirect-to-https hoặc https-only.", en: "Use redirect-to-https or https-only." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_distribution.html.markdown
  status: verified            # the values are verified; requiring HTTPS is platform policy

- id: SEC-030
  severity: warning
  applies_to: [cloudfront, cert-attach]
  check: "viewer_certificate.minimum_protocol_version is TLSv1 (the provider default) or below TLSv1.2_2019"
  message: { vi: "CloudFront chấp nhận phiên bản TLS cũ.", en: "CloudFront accepts old TLS versions." }
  fix: { vi: "Đặt TLSv1.2_2021.", en: "Set TLSv1.2_2021." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_distribution.html.markdown
  status: verified

- id: SEC-031
  severity: warning
  applies_to: [cloudfront, origin, s3]
  check: "an S3 origin does not use origin access control, so the bucket must be public for CloudFront to read it"
  message: { vi: "Origin S3 không dùng OAC nên bucket phải public.", en: "The S3 origin does not use OAC, so the bucket has to be public." }
  fix: { vi: "Dùng OAC và giữ bucket private.", en: "Use OAC and keep the bucket private." }
  source: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
  status: verified

- id: SEC-032
  severity: info
  applies_to: [cloudfront]
  check: "web_acl_id is not set"
  message: { vi: "Distribution chưa gắn WAF.", en: "The distribution has no WAF web ACL." }
  fix: { vi: "Cân nhắc gắn WAF (dịch vụ Tier 2).", en: "Consider attaching WAF (a Tier 2 service)." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/cloudfront_distribution.html.markdown
  status: verified

- id: SEC-033
  severity: info
  applies_to: [route53]
  check: "force_destroy is true on a hosted zone"
  message: { vi: "Xoá zone sẽ xoá mọi bản ghi, kể cả bản ghi tạo ngoài Terraform.", en: "Destroying the zone deletes every record, including ones created outside Terraform." }
  fix: { vi: "Giữ force_destroy là false cho zone quan trọng.", en: "Keep force_destroy false for important zones." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/r/route53_zone.html.markdown
  status: verified

- id: SEC-034
  severity: info
  applies_to: [acm, cert-validation, route53]
  check: "a validation CNAME record of a certificate in use is managed in a way that lets it be deleted without the certificate being replaced"
  message: { vi: "Xoá bản ghi CNAME xác thực sẽ làm ACM ngừng tự gia hạn chứng chỉ.", en: "Deleting the validation CNAME stops ACM from renewing the certificate." }
  fix: { vi: "Giữ bản ghi xác thực cùng vòng đời với chứng chỉ.", en: "Keep the validation record for as long as the certificate is in use." }
  source: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html
  status: verified

# IAM

- id: SEC-035
  severity: error
  applies_to: [iam-role, iam-policy]
  check: "a role has the AdministratorAccess managed policy attached"
  message: { vi: "Role đang có toàn quyền trên tài khoản (AdministratorAccess).", en: "The role has full account access (AdministratorAccess)." }
  fix: { vi: "Cấp đúng quyền cần thiết bằng grant.", en: "Grant only the permissions needed, using grants." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  status: verified            # the policy is full access by AWS's description; making it an error is platform policy

- id: SEC-036
  severity: error
  applies_to: [iam-policy, grant]
  check: "a policy statement allows Action * (or service:*) on Resource *"
  message: { vi: "Policy cho phép mọi hành động trên mọi resource.", en: "The policy allows every action on every resource." }
  fix: { vi: "Giới hạn action và resource.", en: "Restrict the actions and resources." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  status: verified

- id: SEC-037
  severity: warning
  applies_to: [iam-policy, grant]
  check: "a statement uses Resource * for actions that support resource-level permissions (other than ecr:GetAuthorizationToken, ssmmessages and the Lambda VPC interface actions, which require it)"
  message: { vi: "Statement dùng Resource * cho hành động có thể giới hạn theo ARN.", en: "The statement uses Resource * for actions that can be limited to ARNs." }
  fix: { vi: "Dùng ARN cụ thể.", en: "Use specific ARNs." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  status: verified

- id: SEC-038
  severity: warning
  applies_to: [iam-policy, grant]
  check: "a statement uses a service-wide wildcard action such as s3:* or ecr:*"
  message: { vi: "Policy dùng action wildcard theo cả dịch vụ.", en: "The policy uses a service-wide wildcard action." }
  fix: { vi: "Liệt kê các action cần dùng.", en: "List only the actions needed." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
  status: verified

- id: SEC-039
  severity: error
  applies_to: [iam-role, assume-role]
  check: "a role trust policy has Principal * or {AWS: *} without a restricting condition"
  message: { vi: "Trust policy cho phép bất kỳ ai assume role.", en: "The trust policy lets anyone assume the role." }
  fix: { vi: "Chỉ liệt kê service principal cần dùng.", en: "List only the service principals that need it." }
  source: https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.66.0/website/docs/d/iam_policy_document.html.markdown
  status: unverified          # the page says the two forms differ in a trust policy; the risk itself is general knowledge

- id: SEC-040
  severity: info
  applies_to: [iam-role, assume-role, ecs]
  check: "an ECS task role trust policy lacks aws:SourceAccount and aws:SourceArn conditions"
  message: { vi: "Trust policy của task role chưa giới hạn theo tài khoản và ARN (confused deputy).", en: "The task role trust policy is not limited by account and ARN (confused deputy)." }
  fix: { vi: "Thêm aws:SourceAccount và aws:SourceArn = arn:aws:ecs:<region>:<account>:*.", en: "Add aws:SourceAccount and aws:SourceArn = arn:aws:ecs:<region>:<account>:*." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  status: verified

- id: SEC-041
  severity: info
  applies_to: [iam-role, assume-role]
  check: "one role is assumed by workloads of different services or by more than one ECS task definition or Lambda function"
  message: { vi: "Một role dùng chung cho nhiều workload, khó giữ least privilege.", en: "One role is shared by several workloads, which makes least privilege harder." }
  fix: { vi: "Tạo role riêng cho từng task definition hoặc service.", en: "Create a role for each task definition or service." }
  source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
  status: verified

- id: SEC-042
  severity: error
  applies_to: [iam-policy, grant]
  check: "a workload role's policies allow iam:PassRole, iam:CreateRole, iam:AttachRolePolicy, iam:PutRolePolicy or iam:*"
  message: { vi: "Role của workload có quyền tự cấp thêm quyền (leo thang đặc quyền).", en: "A workload role can grant permissions (privilege escalation)." }
  fix: { vi: "Bỏ các quyền IAM khỏi role của ứng dụng.", en: "Remove IAM permissions from application roles." }
  source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-service.html
  status: verified            # the escalation risk of creating roles and attaching policies is stated; PassRole risk from the PassRole page

- id: SEC-043
  severity: info
  applies_to: [vpc-endpoint-s3]
  check: "a gateway endpoint for S3 has no policy, or the default full-access policy"
  message: { vi: "Endpoint S3 đang cho phép mọi thao tác trên mọi bucket.", en: "The S3 endpoint allows every action on every bucket." }
  fix: { vi: "Giới hạn theo bucket, tài khoản (s3:ResourceAccount) hoặc role (aws:PrincipalArn).", en: "Limit by bucket, by account (s3:ResourceAccount) or by role (aws:PrincipalArn)." }
  source: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html
  status: verified

- id: SEC-044
  severity: warning
  applies_to: [vpc-endpoint-s3, s3, iam-policy]
  check: "a bucket policy or identity policy statement uses the aws:SourceIp condition key and the bucket is reached from a VPC that has an S3 gateway endpoint"
  message: { vi: "aws:SourceIp không áp dụng cho request đi qua VPC endpoint.", en: "aws:SourceIp does not apply to requests that go through a VPC endpoint." }
  fix: { vi: "Dùng aws:VpcSourceIp, aws:SourceVpc hoặc aws:SourceVpce.", en: "Use aws:VpcSourceIp, aws:SourceVpc or aws:SourceVpce." }
  source: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html
  status: verified
```

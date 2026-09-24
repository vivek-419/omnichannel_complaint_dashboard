# ☁️ AWS Cloud Architecture Blueprint: CCMRS Enterprise

**Omnichannel Customer Complaint Management & Resolution System (CCMRS)**
*B.Tech Software Engineering (SEM-5) Enterprise Cloud Architecture Specification*

---

## 1. High-Level Cloud Architecture Overview

```
                      [ External Customer Channels ]
               Telegram Bot  │  Discord Gateway  │  Gmail API
                             │          │          │
                             ▼          ▼          ▼
             ┌──────────────────────────────────────────────┐
             │       Amazon Route 53 (DNS Management)       │
             └──────────────────────┬───────────────────────┘
                                    │
                                    ▼
             ┌──────────────────────────────────────────────┐
             │      AWS WAF (Web Application Firewall)      │
             │           & CloudFront (Edge CDN)            │
             └──────────────────────┬───────────────────────┘
                                    │
                                    ▼
             ┌──────────────────────────────────────────────┐
             │     Application Load Balancer (ALB / HTTPS)  │
             └──────────────────────┬───────────────────────┘
                                    │
            ┌───────────────────────┴────────────────────────┐
            │                                                │
            ▼                                                ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ AWS ECS Fargate: Core API Node│        │ AWS ECS Fargate: Worker Node  │
│ • Express Unified API         │        │ • Telegram/Discord Gateway    │
│ • Web Portal (index.html)     │        │ • SLA Escalation Poller (20s) │
│ • RBAC / JWT Authentication   │        │ • Omnichannel Auto-Responder  │
└───────────────┬───────────────┘        └───────────────┬───────────────┘
                │                                        │
                └───────────────────┬────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
       ▼                            ▼                            ▼
┌───────────────┐            ┌───────────────┐            ┌───────────────┐
│   AWS RDS     │            │Amazon DynamoDB│            │   Amazon S3   │
│ (PostgreSQL)  │     OR     │ (Single-Table)│            │• Attachments  │
│ Multi-AZ Rel. │            │ Sub-ms NoSQL  │            │• Export Data  │
└───────────────┘            └───────────────┘            └───────────────┘
       │                            │                            │
       └────────────────────────────┼────────────────────────────┘
                                    │
            ┌───────────────────────┴────────────────────────┐
            │                                                │
            ▼                                                ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│   Amazon SES & Amazon SNS     │        │  Google Gemini / AWS Bedrock  │
│ • SLA Escalation Email Alerts │        │ • 1-Click Smart Resolution    │
│ • SMS Multi-Factor Auth (MFA) │        │ • Executive Root-Cause AI     │
└───────────────────────────────┘        └───────────────────────────────┘
```

---

## 2. Core AWS Cloud Components & Mapping

| AWS Service | Architectural Role in CCMRS | Project Implementation Mapping |
| :--- | :--- | :--- |
| **Amazon Route 53** | Global DNS routing with health checks & latency-based routing. | Routes `ccmrs.enterprise.com` to the Application Load Balancer. |
| **AWS WAF** | Layer-7 Web Application Firewall protecting against SQLi, XSS, and DDoS attacks. | Filters malicious payloads before reaching Express API routes. |
| **Application Load Balancer (ALB)** | Distributes incoming HTTPS traffic across ECS Fargate container tasks. | SSL termination and load balancing on port 5001. |
| **AWS ECS Fargate** | Serverless, autoscaling container runtime (Docker). | Runs `ccmrs-production-task` defined in [`task-definition.json`](./task-definition.json). |
| **AWS Elastic Beanstalk** | Alternative PaaS deployment option for rapid provisioning. | Configured via [`.ebextensions/node.config`](./.ebextensions/node.config). |
| **AWS RDS (PostgreSQL)** | Managed relational database with Multi-AZ automated failover and encryption at rest. | Implements relational schema defined in [`schema.sql`](./schema.sql). |
| **Amazon DynamoDB** | Ultra high-throughput serverless NoSQL database with Global Secondary Indexes. | Implements single-table design in [`dynamodb-schema.json`](./dynamodb-schema.json). |
| **Amazon S3** | Secure object storage for customer proof media and audit logs. | Stores uploaded screenshot attachments and PDF report exports. |
| **Amazon SES / SNS** | Simple Email & Notification Service for transactional alerting. | Dispatches automated SLA breach alerts and 2FA SMS tokens. |
| **AWS Secrets Manager** | Encrypted secret storage. | Stores Telegram tokens, Discord tokens, and Gemini API keys. |
| **Amazon CloudWatch** | Real-time monitoring, metrics, and centralized log aggregation. | Collects SLA audit metrics and container health telemetry. |

---

## 3. High Availability & Disaster Recovery (HA/DR)

1. **Multi-AZ Deployment**: ECS Fargate tasks are distributed across 2 Availability Zones (`us-east-1a` and `us-east-1b`).
2. **Auto-Scaling Policy**:
   * Scale-out trigger: CPU utilization > 70% or Memory utilization > 75%.
   * Minimum tasks: 2 | Maximum tasks: 10.
3. **Database Resilience**: AWS RDS PostgreSQL configured with **Multi-AZ Read Replicas** for zero-data-loss failover in < 60 seconds.

---

## 4. Security & Compliance Architecture

* **VPC Isolation**: ECS tasks and RDS database run inside **Private Subnets** with no direct public internet access; outbound traffic is routed through **AWS NAT Gateways**.
* **Zero-Trust IAM**: Role-based permissions (`ecsTaskExecutionRole`) adhering to the Principle of Least Privilege.
* **Encryption**:
  * In Transit: TLS 1.3 encryption across all public and internal service boundaries.
  * At Rest: AES-256 KMS customer-managed key encryption on RDS, DynamoDB, and S3.

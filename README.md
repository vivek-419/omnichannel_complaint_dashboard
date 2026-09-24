# CCMRS — Omnichannel Customer Complaint Management & Resolution System

An enterprise-grade, omnichannel customer complaint triage, automated resolution, and executive analytics platform integrating **Telegram, Discord, and Gmail** with **PostgreSQL**, **AI NLP Sentiment Analysis**, and **Role-Based Access Control (RBAC)**.

---

## 👥 Team Quickstart Guide

### 1. Clone the Repository
```bash
git clone <YOUR_GITHUB_REPO_URL>
cd software_project
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
*(Ask the team lead for the active Railway PostgreSQL `DATABASE_URL` or use a local PostgreSQL instance).*

### 4. Database Setup & Initialization
The system automatically initializes and migrates the PostgreSQL database schema on first boot.
You can also run the migration manually:
```bash
node -e "require('./src/config/database.config').initDatabase().then(() => console.log('Database Ready!'))"
```

### 5. Start the Server
```bash
# Development mode (with auto-reload):
npm run dev

# Production mode:
npm start
```

Open **`http://localhost:5001/index.html`** in your browser.

---

## 🔑 Pre-Configured Team Test Accounts

| Role | Email | Password | Allowed Permissions |
| :--- | :--- | :--- | :--- |
| **Support Agent** | `agent@ccmrs.com` | `agent123` | Triage complaints, AI smart reply, issue digital wallet apology credits |
| **Support Agent (2)**| `agent2@ccmrs.com` | `agent123` | Multi-agent collaboration, ticket resolution |
| **Delivery Head** | `head@ccmrs.com` | `head123` | Executive analytics, AI root-cause analysis, SLA escalations, agent reassignments |
| **Administrator** | `admin@ccmrs.com` | `admin123` | Full access: Bot API tokens, live database inspector, RBAC management |

---

## 🏛️ Project Architecture & Directory Structure

Follows the **Layered Architecture (Controller - Service - Store/Repository Pattern)**:

```text
software_project/
├── .env                             # Environment variables & secrets (ignored by Git)
├── .env.example                     # Environment template for teammates
├── .gitignore                       # Git ignore rules for node_modules and secrets
├── package.json                     # Dependencies and run scripts
├── schema.sql                       # Enterprise PostgreSQL Database Schema (AWS RDS / Railway)
│
├── config/                          # Third-party OAuth2 config & token storage
│   └── paths.config.js              # Centralized cross-platform path resolver
│
├── data/                            # Default seed data and schemas
│   ├── tickets.json                 # Ingested grievance tickets cache
│   ├── users.json                   # RBAC user accounts
│   ├── wallets.json                 # Customer digital wallet loyalty balances
│   └── notifications.json           # SLA escalation alerts
│
├── docs/                            # Architecture & Requirements Documentation
│   ├── SRS_CCMRS.md                 # Software Requirements Specification (SRS)
│   ├── AWS_ARCHITECTURE.md          # AWS Cloud Infrastructure Blueprint
│   └── AWS_FREE_TIER_DEPLOYMENT.md  # Deployment walkthrough
│
├── public/                          # Frontend Web Application (SPA)
│   └── index.html                   # Jira-styled workspace, Kanban board & Admin panel
│
└── src/                             # Backend Application Source Code
    ├── app.js                       # Express application configuration & middlewares
    ├── server.js                    # Server startup, database connection & background jobs
    │
    ├── config/                      # Database & Environment configuration
    │   ├── database.config.js       # PostgreSQL connection pool & auto-migrator
    │   └── env.config.js            # Environment loader & validator
    │
    ├── constants/                   # Domain constants & SLA thresholds
    │   ├── sla.constants.js         # SLA window durations (Critical: 15m, High: 1h, etc.)
    │   └── ticket.constants.js      # Priorities, Channels, Categories, Sentiments
    │
    ├── controllers/                 # HTTP Request Handlers
    │   ├── ai.controller.js         # Smart replies, sentiment & root-cause handlers
    │   ├── analytics.controller.js  # Executive metrics & SLA KPIs
    │   ├── auth.controller.js       # JWT Authentication & RBAC profiles
    │   ├── channel.controller.js    # Telegram/Discord/Gmail gateway status
    │   ├── ticket.controller.js     # Ticket CRUD & omnichannel replies
    │   └── wallet.controller.js     # Customer compensation & loyalty points
    │
    ├── middlewares/                 # Express Middlewares
    │   ├── auth.middleware.js       # JWT & Role-Based Access Control
    │   ├── error.middleware.js      # Error handler
    │   └── logger.middleware.js     # HTTP request logger
    │
    ├── routes/                      # Modular API Routes
    │   ├── index.js                 # Master router (/api)
    │   ├── auth.routes.js           # /api/auth
    │   ├── ticket.routes.js         # /api/tickets
    │   ├── ai.routes.js             # /api/ai
    │   ├── analytics.routes.js      # /api/analytics
    │   ├── channel.routes.js        # /api/channels
    │   └── wallet.routes.js         # /api/wallets
    │
    ├── services/                    # Business Logic & Omnichannel Dispatchers
    │   ├── ai.service.js            # Gemini 1.5 Flash NLP + fallback heuristic engine
    │   ├── db.service.js            # PostgreSQL query repository
    │   ├── discord.service.js       # Discord Bot client & reply dispatcher
    │   ├── gmail.service.js         # Google Gmail API client & RFC-2047 MIME dispatcher
    │   ├── notification.service.js  # SLA escalation monitor (background cron)
    │   └── telegram.service.js      # Telegram Bot client & reply dispatcher
    │
    └── stores/                      # Data Access Layer & Memory Caching
        ├── ticket.store.js          # Ticket storage & priority detector
        ├── user.store.js            # User accounts store
        └── wallet.store.js          # Customer digital wallet store
```

---

## 🛠️ Key REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/tickets` | Fetch all omnichannel complaint tickets |
| `POST` | `/api/tickets/:id/reply` | Dispatch reply back to customer's native channel (Gmail/Telegram/Discord) |
| `POST` | `/api/tickets/:id/reward` | Issue apology discount voucher & credit loyalty wallet |
| `POST` | `/api/tickets/:id/reassign` | Reassign ticket to another agent (Delivery Head / Admin) |
| `GET` | `/api/analytics/metrics` | Real-time SLA compliance, resolution rate & category breakdown |
| `GET` | `/api/system/database-status` | PostgreSQL live database health, engine version & table row counts |
| `GET` | `/api/system/db-inspect/:table` | Query live records from PostgreSQL tables |
| `POST` | `/api/auth/login` | Authenticate user & generate JWT token |

---

## 🌿 Git Branching & Team Contribution Workflow

1. Always create a new branch from `main` before starting work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your commits with clear messages:
   ```bash
   git commit -m "feat: add customer satisfaction feedback rating"
   ```
3. Push your branch to GitHub and open a Pull Request:
   ```bash
   git push origin feature/your-feature-name
   ```
4. Never commit `.env`, `credentials.json`, or `token.json` (they are protected in `.gitignore`).

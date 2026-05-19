# Diamond CRM — Sales Tracking & Receivables Analytics

&gt; Production CRM and analytics platform for B2B institutional account management in security printing.

## The Problem

25+ institutional B2B accounts tracked in Excel. No visibility into:
- Real-time pipeline value and deal velocity
- Client-level profitability vs. payment behavior
- Aging receivables and non-performing debt exposure
- Document workflows (tenders, LC tracking, artwork approvals)

## The Solution

Full-stack CRM built independently:

### Backend: PostgreSQL/Supabase
- Relational schema with null-safe architecture
- Client tables with pipeline stage tracking
- Transaction logging with date arithmetic for aging analysis
- Document vault and workflow modules (Kanban, LC/logistics tracker, artwork approval)

### Frontend: Vanilla JS + Tailwind CSS
- Lightweight interface for daily sales operations
- Integrated with Supabase real-time subscriptions

### Analytics: Power BI
- Live dashboards connected to PostgreSQL backend
- Revenue pipeline value, stage conversion rates, revenue forecasting
- Client activity metrics and profitability analysis

## Key Technical Achievement

**60-Day Customer Aging Report**

Isolated **14.7 Million LKR** in high-risk, non-performing debt:
- BURO: 7.59M LKR
- DIMO: 4.32M LKR
- NIBM: 2.81M LKR

Resolved PostgreSQL ambiguity errors (42702, 42P01) while writing multi-table JOINs across live transaction and CRM tables on a mobile development setup.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | PostgreSQL (Supabase) |
| Backend | Supabase Auth & Realtime |
| Frontend | Vanilla JavaScript, Tailwind CSS |
| Analytics | Power BI, DAX |
| Tools | MS Excel, QuickBooks |

## Note

This repository contains sanitized portfolio examples. The production system manages live B2B accounts and is hosted separately.

## About

Built independently as sole developer, 2026–present. Production system managing live B2B accounts.

**Seeking:** Revenue Operations, Sales Operations, or BI Analyst roles where business domain knowledge and technical execution intersect.

# Traveluxe OS

## Overview

Traveluxe OS is a complete internal luxury travel concierge operations platform built as a PWA for Traveluxe London (Mayfair). It is a 14-module system used by operators and admins for managing VIP clients, airport transfers, tours, drivers, commissions, invoices, and internal communications.

## Architecture

pnpm workspace monorepo with TypeScript throughout.

### Artifacts
- **`artifacts/traveluxe-os`** — React + Vite PWA frontend (port 18368, preview at `/`)
- **`artifacts/api-server`** — Express 5 API server (port 8080, preview at `/api`)
- **`artifacts/mockup-sandbox`** — Component preview server (port 8081)

### Shared Libraries
- **`lib/api-spec`** — OpenAPI YAML spec (source of truth for the API contract)
- **`lib/api-client-react`** — Generated Orval + TanStack Query hooks
- **`lib/api-zod`** — Generated Zod schemas
- **`lib/db`** — Shared database types

## Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS v4, shadcn/ui, TanStack Query, Wouter
- **Backend**: Express 5, Node.js 24
- **Database**: Supabase (PostgreSQL) — schema in `artifacts/traveluxe-os/supabase-schema.sql`
- **Auth**: Supabase Auth (JWT tokens, 30-minute inactivity lock)
- **Flight Tracking**: AviationStack API with 5-minute cache
- **PDF**: jsPDF + html2canvas for invoice generation
- **API codegen**: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)

## Environment Variables (Secrets)
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key
- `VITE_AVIATIONSTACK_KEY` — AviationStack API key for flight tracking
- `SESSION_SECRET` — Session secret

## Design System
- Dark mode forced always — `#0a0a0a` background, `#C9A84C` gold primary
- Inter font, mobile-first with desktop sidebar + mobile bottom navigation

## Modules (14 total) — All Complete
1. Dashboard — KPI metrics, alerts, top clients/drivers
2. Clients — CRM with duplicate detection, VIP tiers (Standard/VIP/VVIP), booking history
3. Quotes — Create/send quotes, convert to booking, accept/decline, WhatsApp share
4. Bookings — Job sheets with TVL-XXXX refs, WhatsApp templates, cancel/amend/waiting-time, tours & apartments
5. Jobs Board — Live jobs with real time-based filter (Today / Tomorrow / This Week / All Upcoming)
6. Flight Tracker — Live arrival tracking with AviationStack for today/tomorrow
7. Drivers — Directory with ratings, vehicle info, commission ledger
8. Commissions — Cash vs Bank Transfer split, settlement tracking
9. Invoices — INV-XXXX numbered invoices, generate from booking, downloadable HTML invoice
10. Messages — Internal team chat (realtime) + task board
11. Finance — Revenue reports, operator performance (admin only)
12. Search — Global search across clients, bookings, drivers
13. Admin — User management, audit log, CRM API hub (admin only)
14. Tours & Apartments — Extended booking types with full tour/accommodation details

## Privacy Rules
- Client WhatsApp numbers are NEVER shared with drivers
- Driver WhatsApp numbers are NEVER shown to clients
- Operators always use separate WhatsApp templates

## Commission Logic
- **Cash payments** → Driver owes TVL commission (Outstanding status)
- **Bank Transfer** → TVL owes driver their share (Pending Payout status)

## Key Commands
- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/traveluxe-os run dev` — run frontend
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm run typecheck` — check all TypeScript across packages

## Supabase Setup
Run `artifacts/traveluxe-os/supabase-schema.sql` in the Supabase SQL editor to create all tables, RLS policies, triggers, and indexes.

Auto-features in schema:
- TVL-XXXX booking reference auto-generated via PostgreSQL sequence
- INV-XXXX invoice numbers auto-generated via sequence
- Commission type auto-set based on payment method (trigger)
- User profile auto-created on auth.users creation (trigger)
- updated_at auto-updated on booking changes (trigger)

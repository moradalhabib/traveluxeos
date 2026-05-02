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
- `RAPIDAPI_KEY` — RapidAPI key for AeroDataBox flight tracking (replaces AviationStack)
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

## Products & Order Lines
- **Products catalogue** (`products` table): Vehicles, Meet & Greet (Silver/Gold/Diamond), Tours, Add-ons, Accommodation — all with unit prices
- **Booking order lines** (`booking_products` table): each booking can have multiple products with quantity; `total` is a GENERATED column (unit_price × quantity)
- **ProductPicker** component in new booking form lets operators pick products by category; auto-calculates total price
- **Booking detail** shows order lines with subtotal above the Financials card
- **Admin → Products tab** (scrollable): full CRUD for super_admin; operators can view. Category tabs: Vehicle, Meet & Greet, Tour, Add-on, Accommodation
- Run `migration-products.sql` in Supabase SQL editor to set up tables + seed data

## User Management (in-app, no Supabase dashboard needed)
- **Invite Member** — POST /api/users/invite (admin/super_admin). Sends Supabase invite email + creates `public.users` row with `active=false`.
- **Change Role** — PUT /api/users/:id/role (super_admin only, can't demote last super_admin).
- **Suspend / Reactivate** — direct supabase client toggle of `users.active`. `useAuth` boots inactive sessions.
- **Remove Member** — DELETE /api/users/:id (super_admin only). Revokes auth identity via service role + soft-deletes `public.users` row (`active=false`, `name="[removed]"`, email rewritten to `removed+xxxxxxxx@traveluxe.local`). Historical FKs preserved.
- **Super Admin lock** — UI hides Suspend/Remove buttons on super_admin rows; backend refuses to demote/remove the last active super_admin.
- **Authz hardening** — every privileged users route checks `actor.active === true` before role check, so suspending an admin instantly revokes their management privileges.
- **Permissions grid** + **Recent activity panel** rendered in Admin → Users tab.

## Supabase Setup
Run `artifacts/traveluxe-os/supabase-schema.sql` in the Supabase SQL editor to create all tables, RLS policies, triggers, and indexes.
Then run `artifacts/traveluxe-os/migration-service-types.sql` and `artifacts/traveluxe-os/migration-products.sql` for the Services and Products modules.

**Apr 2026 batch — must run in Supabase SQL editor before features work:**
- `migration-booking-referral-split.sql` — adds `referral_partner_name`, `referral_commission_type`, `referral_commission_value` to `bookings` (Commission Split / TVL Net after referral).
- `migration-supplier-balance.sql` — adds `supplier_paid_at`, `supplier_payment_ref` to `bookings` + partial index (Supplier Balance Tracker).

**May 2026 batch — must run in Supabase SQL editor:**
- `cancellation_status.sql` (in `artifacts/api-server/migrations/`) — adds `Cancelled` to `requests.status` + `follow_ups.status` enums and adds `cancellation_reason`, `cancelled_at`, `cancelled_by` columns. Required by the Cancel Request / Cancel Follow-Up flows (UI refuses to call without a structured reason).

## Cancellation Lifecycle (May 2026)
- **Requests** — `Cancelled` is now a first-class status alongside Declined / Expired. Cancel button on `/requests/:id` opens a dialog (radio reasons from `CANCELLATION_REASONS` + free-text). PUT `/api/requests/:id` validates that a reason is supplied; banner on the detail page surfaces `cancellation_reason` + `cancelled_at`.
- **Follow-ups** — same shape: action row on each pending follow-up has a Cancel button → dialog with the same reason taxonomy → PATCH `/api/follow-ups/:id` writes `cancelled_at` / `cancelled_by` and refuses without a reason.
- **Why a separate status, not just delete?** Deleting hides the lost lead from finance reporting. Cancelled rows stay queryable so we can roll up "lost lead reasons" across requests + follow-ups in one query.
- **Lost-Leads report (Analytics)** — `/analytics` "Lost Leads — Why" card calls `GET /api/dashboard/lost-leads?period=this_month|last_30|this_year|all`. Endpoint groups cancelled requests + cancelled follow-ups by `cancellation_reason` (NULL/blank → "Unspecified"), clamped to the `STATS_CUTOFF_ISO` (20-Apr-2026) so legacy data never leaks. Card shows period chips, source-split totals, a horizontal Recharts bar chart, and a tap-to-drill row list that opens `/requests?status=Cancelled` (reason-level filter not yet implemented — list is by status only).
- **Re-open Cancelled (May 2026)** — Both surfaces support reviving a lost lead: cancellation banner on `/requests/:id` shows a Re-open button (Cancelled → New); each cancelled card on `/follow-ups` shows a Re-open button (cancelled → pending). PUT `/api/requests/:id` and PATCH `/api/follow-ups/:id` detect the transition server-side and append `Re-opened (DD MMM HH:mm) — was cancelled for: <reason>` to `notes`. `cancellation_reason` / `cancelled_at` / `cancelled_by` are intentionally **preserved** as an append-only audit so the Lost-Leads rollup still attributes the original loss correctly. Follow-ups additionally clear `completed_at` / `completed_by` so dashboard counters treat the row as live work again. Both flows sit behind a confirm dialog. Hooks: `useReopenRequest` in `requests-api.ts`; follow-ups reuse the existing `patchFollowUp` helper. Out of scope: re-opening Converted requests / `booked_return` follow-ups, bulk re-open, dedicated history page.

## Jobs Board Declutter (May 2026)
- Search bar at top — fast text filter across TVL ref, client, driver, route, vehicle, flight number.
- "Hide completed" toggle on by default (operators rarely scroll past finished jobs); auto-disables when the URL filters by `?status=Completed` so the completed view still works.
- Compact / Standard row toggle.
- Day-group headers are now collapsible buttons. Past days + "Date TBC" start collapsed so the board opens on the operator's actionable horizon.

## Supplier-Driven Job Rendering (May 2026)
- Dashboard "Starting soon" + "Today's Jobs", Services list, Jobs board upcoming strip, AND backend scheduler (1-hour push, 08:00 digest) now all read `supplier_id` + `as_directed_supplier_driver` and render the supplier company instead of "Driver TBC" / "No Driver" when the supplier is providing the vehicle. The "needs assigning" digest also excludes supplier-driven jobs so operators aren't chased for a phantom driver.

For invite emails to deliver, configure SMTP in Supabase Dashboard → Auth → SMTP (or rely on Supabase's built-in email for low volume).

Auto-features in schema:
- TVL-XXXX booking reference auto-generated via PostgreSQL sequence
- INV-XXXX invoice numbers auto-generated via sequence
- Commission type auto-set based on payment method (trigger)
- User profile auto-created on auth.users creation (trigger)
- updated_at auto-updated on booking changes (trigger)

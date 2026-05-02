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
- **Cancelled-by attribution (May 2026)** — Both the request cancellation banner on `/requests/:id` and the cancelled card row on `/follow-ups` show a single-line `Cancelled by <Name> · <d MMM HH:mm> · Reason: <reason>` audit line. Timestamps are formatted via `fmtLondon` (Europe/London) so UK + Egypt admins always see the same wall clock. The actor name is wrapped in the existing tooltip primitive showing their email (or the name itself as fallback when email is unavailable) so two-admin teams can disambiguate when display names collide. Server enrichment: `GET /api/requests/:id` and `GET /api/follow-ups` join `users` on `cancelled_by` and return `cancelled_by_name` + `cancelled_by_email`; `follow-ups` list includes `cancelled_by`, `cancelled_at`, `cancellation_reason` in its base SELECT so the attribution is hydratable for cancelled rows. **Privacy gate**: `routes/users.ts` has two distinct soft-delete flows — `deactivate` flips `active=false` but keeps the real email, while `remove` also overwrites email with a safe placeholder + `name="[removed]"`. Both backend routes therefore null out `cancelled_by_email` when the actor's `active=false`, so a merely-deactivated operator's address is never leaked through the attribution line. The display name is still safe to show. Falls back to plain "Cancelled · …" if the actor row is missing (legacy rows from before `cancelled_by` existed).
- **Re-open Cancelled (May 2026)** — Both surfaces support reviving a lost lead: cancellation banner on `/requests/:id` shows a Re-open button (Cancelled → New); each cancelled card on `/follow-ups` shows a Re-open button (cancelled → pending). PUT `/api/requests/:id` and PATCH `/api/follow-ups/:id` detect the transition server-side and append `Re-opened (DD MMM HH:mm) — was cancelled for: <reason>` to `notes`. `cancellation_reason` / `cancelled_at` / `cancelled_by` are intentionally **preserved** as an append-only audit so the Lost-Leads rollup still attributes the original loss correctly. Follow-ups additionally clear `completed_at` / `completed_by` so dashboard counters treat the row as live work again. Both flows sit behind a confirm dialog. Hooks: `useReopenRequest` and `useReopenFollowUp` in `requests-api.ts` — cancellation-lifecycle helpers grouped together. The follow-ups page also calls `fetchData()` and invalidates the dashboard-summary key in its `submitReopen` success handler so the page list and bell counters refresh in lockstep. **Server-side transition guard**: Cancelled is treated as near-terminal — both routes reject status changes out of Cancelled to anything other than `New`/`pending` (returns 400 with "Use the Re-open action"), so the generic edit form can't accidentally jump a cancelled row to Quoted / Booked / done. Out of scope: re-opening Converted requests / `booked_return` follow-ups, bulk re-open (proposed as #36), dedicated history page.

## Jobs Board Declutter (May 2026)
- Search bar at top — fast text filter across TVL ref, client, driver, route, vehicle, flight number.
- "Hide completed" toggle on by default (operators rarely scroll past finished jobs); auto-disables when the URL filters by `?status=Completed` so the completed view still works.
- Compact / Standard row toggle.
- Day-group headers are now collapsible buttons. Past days + "Date TBC" start collapsed so the board opens on the operator's actionable horizon.

## Mobile Sweep — Jobs & Follow-Ups (May 2026)
- **Scope**: layout-only polish for 360–420px viewports on `/jobs` and `/follow-ups`. No behaviour changes, no new features.
- **Jobs Board** — outer wrapper adds `pb-32 sm:pb-4` only when bulk select-mode is active so the floating `BulkActionBar` doesn't sit on top of the last day-group's cards. The two inline filter-row toggles (`Completed hidden` / `Compact`) bump from `h-8` → `h-9` on mobile (revert to `h-8` from `sm:` up). Day-group collapse buttons get `min-h-9` and the chevron grows to `w-4 h-4` on mobile so a full-row tap is comfortable; desktop preserves the slimmer `h-3` chevron.
- **Follow-Ups** — same outer-wrapper bottom-padding pattern. The per-card pending-action row (WhatsApp / Done / Book Return / No Response / Snooze / Cancel) switches from `flex flex-wrap` to `grid grid-cols-2 sm:flex sm:flex-wrap` on mobile, with each button `w-full sm:w-auto h-9 sm:h-8` so they stack into a clean 2×3 grid with thumb-sized targets. The Snooze popover continues to anchor to its `relative` wrapper which is now `w-full sm:w-auto`.
- **Dialog/Sheet primitives** — `DialogContent` gains `max-h-[90vh] overflow-y-auto` and the `bottom` `SheetContent` variant gains `max-h-[85vh] overflow-y-auto`. Defensive change that prevents tall dialogs (Cancel-Follow-Up's 8 reason buttons + textarea, the bookings cancellation dialog, etc.) from running off-screen on short mobile viewports; benefits every dialog/sheet across the app with no API change.

## Supplier-Driven Job Rendering (May 2026)
- Dashboard "Starting soon" + "Today's Jobs", Services list, Jobs board upcoming strip, AND backend scheduler (1-hour push, 08:00 digest) now all read `supplier_id` + `as_directed_supplier_driver` and render the supplier company instead of "Driver TBC" / "No Driver" when the supplier is providing the vehicle. The "needs assigning" digest also excludes supplier-driven jobs so operators aren't chased for a phantom driver.

For invite emails to deliver, configure SMTP in Supabase Dashboard → Auth → SMTP (or rely on Supabase's built-in email for low volume).

Auto-features in schema:
- TVL-XXXX booking reference auto-generated via PostgreSQL sequence
- INV-XXXX invoice numbers auto-generated via sequence
- Commission type auto-set based on payment method (trigger)
- User profile auto-created on auth.users creation (trigger)
- updated_at auto-updated on booking changes (trigger)

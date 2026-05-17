# Valsentra Restaurant

Valsentra Restaurant is an autonomous operations and revenue protection system for restaurants. It is not a booking admin panel. The app models orders, payment truth, collapse risk, waitlist recovery, operational memory, communication orchestration, and owner/staff workflows so the business can detect unsafe revenue states before they become losses.

The current product is provider-ready in several places, with selected live infrastructure paths for Supabase and Twilio WhatsApp sandbox verification.

## Current Routes

- `/restaurant` - Staff Revenue Control Room for order creation, payment actions, recovery, Payment Truth, and Autopilot visibility.
- `/restaurant/owner` - Owner Control Center for KPIs, Operational Brain, Intelligence Timeline, Autopilot queue, organization intelligence, and settings.
- `/intelligence` - Operational Intelligence page.
- `/actions` - Autonomous action center.
- `/settings` - Settings surface.
- `/pay/[id]` - Customer payment page for an order.
- `/landing` - Product landing page.

API routes:

- `/api/orders`
- `/api/audit`
- `/api/settings`
- `/api/staff`
- `/api/waitlist`
- `/api/waitlist/cascade`
- `/api/autopilot/feed`
- `/api/operational/continuous`
- `/api/operational/runtime`
- `/api/operational/mesh`
- `/api/operational/live-sync`
- `/api/intelligence/brain`
- `/api/intelligence/timeline`
- `/api/intelligence/organization`
- `/api/communication/send`
- `/api/communication/dev-send-whatsapp`
- `/api/communication/test-autonomous`
- `/api/communication/test-whatsapp`
- `/api/webhooks/whatsapp`
- `/api/demo/reset`

## Staff Dashboard

The staff dashboard at `/restaurant` is the operational workspace for live service.

It supports:

- Service Flow Booking with service day, period, operational slot, and canonical `reservationTime`.
- Quick Add order creation.
- Payment link and payment screenshot workflows.
- Payment verification and mismatch blocking.
- No-show and cancellation handling.
- Waitlist recovery and recovered-order setup.
- Payment Truth sections for unpaid, pending, verified, and blocked orders.
- Autopilot visibility for actions Valsentra handled or recommended.

## Owner Dashboard

The owner dashboard at `/restaurant/owner` is the command center for operational intelligence.

It includes:

- Overview KPIs and live risk alerting.
- Operational Brain insights from real orders, audit logs, payment truth, collapse probability, waitlist recovery, memory, and organization intelligence.
- Intelligence Timeline event stream.
- Autopilot queue and decision visibility.
- Organization and multi-location operational signals when location context is available.
- Owner settings and operating rules.

## Supabase Setup

Valsentra uses Supabase for server-side persistence.

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Safety notes:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe public values.
- `SUPABASE_SERVICE_ROLE_KEY` is privileged and must stay server-only.
- Server-only privileged access is isolated through the admin client in `app/lib/admin.ts`.
- Never expose the service-role key through client components, browser bundles, logs, or `NEXT_PUBLIC_*` variables.

## WhatsApp / Twilio Setup

The communication provider layer lives under `app/lib/providers/communication`.

Required environment variables for live Twilio WhatsApp sandbox sending:

```env
COMMUNICATION_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
```

`TWILIO_WHATSAPP_FROM` should be the Twilio WhatsApp sandbox sender, usually in E.164 format or prefixed by the provider adapter as needed.

Important safety behavior:

- Without `COMMUNICATION_PROVIDER=twilio` and valid Twilio credentials, communication defaults to internal/mock recording.
- Engines do not call Twilio directly.
- Route handlers do not hardcode Twilio API calls; they use the provider abstraction.
- Real WhatsApp sending happens only through the server-side provider adapter.
- No Twilio secret is exposed to the frontend.

## Running Locally

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Fill in local Supabase and optional Twilio sandbox values in `.env.local`.

Start development:

```bash
npm run dev -- --webpack
```

Run checks:

```bash
npm run lint
npm run build
```

## External Operational Worker

Valsentra can run operational jobs outside normal dashboard traffic through a server-side worker process.

Required worker environment:

```env
WORKER_ORGANIZATION_SCOPE=your-organization-id
WORKER_LOCATION_SCOPE=
WORKER_ID=local-worker-1
WORKER_POLL_INTERVAL_MS=15000
WORKER_MAX_JOBS_PER_TICK=5
WORKER_HEARTBEAT_INTERVAL_MS=10000
```

Run continuously:

```bash
npm run worker:dev
```

Run one safe processing tick:

```bash
npm run worker:once
```

Check runtime and mesh health without claiming jobs:

```bash
npm run worker:health
```

Worker safety boundaries:

- The worker executes only through existing durable job and runtime engines.
- It does not confirm payments, release blocked orders, refund, or cancel paid/high-risk reservations.
- It respects existing retry, dead-letter, idempotency, provider, payment truth, and manager-review protections.
- Worker heartbeat, mesh state, failover, and degradation are written through the operational command bus and timeline memory.

## Testing Autonomous WhatsApp Safely

There are two separate testing paths.

Direct provider verification:

```bash
curl -X POST http://localhost:3000/api/communication/dev-send-whatsapp \
  -H "Content-Type: application/json" \
  -H "x-dev-whatsapp-test: true" \
  -d "{\"phone\":\"+60123456789\",\"message\":\"Valsentra WhatsApp live test\"}"
```

This endpoint:

- Works only outside production.
- Requires `x-dev-whatsapp-test: true`.
- Uses the existing provider abstraction.
- Bypasses orchestration, cooldown, fatigue, and escalation logic only for infrastructure verification.
- Has an in-memory rate limit.
- Returns provider metadata, Twilio SID when available, and `realMessageSent`.

Autonomous orchestration test:

1. Set Twilio sandbox variables in `.env.local`.
2. Set `COMMUNICATION_PROVIDER=twilio`.
3. Create an unpaid/pending test order with a sandbox-joined phone number.
4. Run:

```bash
curl -X POST http://localhost:3000/api/operational/continuous \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"run\"}"
```

Quiet hours remain active by default. For local nighttime testing only:

```env
DEV_ALLOW_QUIET_HOURS_WHATSAPP=true
```

This override:

- Works only when `NODE_ENV !== "production"`.
- Applies only to explicit development quiet-hour test orders.
- Applies only to autonomous `PAYMENT_REMINDER` WhatsApp decisions.
- Does not disable fatigue, cooldown, fraud, VIP, provider, or duplicate-safety architecture globally.

## Real vs Provider-Ready / Dev-Only

Real today:

- Supabase-backed orders, audit logs, settings, staff, waitlist, and intelligence routes.
- Canonical order/payment/risk mapping and enrichment.
- Payment Truth state handling.
- Collapse probability and Ghost Ping evaluation.
- Continuous operational pass.
- Operational Brain and Intelligence Timeline from real app data.
- Twilio WhatsApp sandbox sending when live provider env vars are configured.

Provider-ready or development-only:

- Internal/mock communication provider records intent without sending customer messages.
- WhatsApp webhook route records structured payloads but does not assume a specific production provider contract yet.
- `/api/communication/dev-send-whatsapp` is development-only infrastructure verification.
- `DEV_AUTONOMOUS_TEST_OVERRIDE` and `DEV_ALLOW_QUIET_HOURS_WHATSAPP` are development-only test controls.
- Real production SMS/email providers are not connected yet.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

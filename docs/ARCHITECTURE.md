# Valsentra Restaurant Architecture

Valsentra Restaurant is structured as an autonomous operational intelligence system. UI surfaces read from centralized domain models, engines, API routes, and provider adapters instead of duplicating business behavior in page components.

## Order Flow

Orders enter the system through `/restaurant` or API routes.

Core path:

1. Staff creates an order in the Staff Revenue Control Room.
2. Service Flow Booking normalizes service day, period, slot, or manual time into canonical ISO `reservationTime`.
3. `/api/orders` validates and maps the order into Supabase.
4. Domain mapping in `app/lib/domain/orderMapper.ts` normalizes database rows into camelCase `RestaurantOrder`.
5. Order enrichment runs collapse probability and Ghost Ping intelligence.
6. Dashboards, operational routes, and intelligence engines consume the canonical enriched order shape.

Important files:

- `app/restaurant/page.tsx`
- `app/api/orders/route.ts`
- `app/lib/domain/restaurant.ts`
- `app/lib/domain/orderMapper.ts`
- `app/lib/domain/reservationTimeParser.ts`

## Payment Truth Layer

Payment Truth is the canonical payment safety layer.

It protects the app from treating screenshots, pending links, or mismatched payments as verified payment.

Core states:

- `UNPAID`
- `PENDING`
- `VERIFIED`
- `FAILED`
- `BLOCKED`

Verified payments are safe to release. Failed, blocked, mismatched, or unverified payments remain protected by operational guardrails.

Important files:

- `app/lib/domain/restaurant.ts`
- `app/lib/engines/paymentEngine.ts`
- `app/lib/paymentVerificationEngine.ts`
- `app/lib/domain/orderMapper.ts`

## Continuous Operational Engine

The continuous operational engine evaluates live operating conditions without requiring a dashboard refresh.

It evaluates:

- unpaid and pending orders
- expired slot holds
- Ghost Ping escalation
- recovery decay
- waitlist opportunity
- fraud/payment pressure
- collapse escalation
- autonomous communication eligibility

It writes canonical operational events through the shared event model, preventing repeated spam through stable event keys.

Important files:

- `app/lib/continuousOperationalEngine.ts`
- `app/lib/continuousOperationalScheduler.ts`
- `app/api/operational/continuous/route.ts`
- `app/lib/intelligence/operationalEventModel.ts`

## Communication Orchestration

Communication orchestration decides what Valsentra should communicate and why. It does not own provider credentials and does not call Twilio directly.

It decides:

- `PAYMENT_REMINDER`
- `ESCALATE_PAYMENT`
- `URGENCY_INCREASE`
- `RELEASE_WARNING`
- `FINAL_RECOVERY_ATTEMPT`
- `WAITLIST_REPLACEMENT_ACTIVATION`
- `FRAUD_VERIFICATION`
- `OWNER_STAFF_INTERVENTION`

The decision includes:

- selected channel
- selected step
- suppression reasons
- cooldown state
- fatigue state
- quiet-hour state
- customer-facing vs internal-only diagnostics
- explainability

Payment-unresolved orders with a phone prioritize WhatsApp payment reminder before waitlist activation unless the slot is already unrecoverable.

Important files:

- `app/lib/communicationOrchestrationEngine.ts`
- `app/lib/providers/communication/communicationExecutionService.ts`
- `app/lib/providers/communication/communicationProviderTypes.ts`

## WhatsApp Provider

Provider execution is isolated behind the communication provider layer.

Twilio WhatsApp sandbox sending is implemented in:

- `app/lib/providers/communication/whatsappProvider.ts`

Internal/mock behavior is implemented in:

- `app/lib/providers/communication/internalProvider.ts`

Execution routing is implemented in:

- `app/lib/providers/communication/communicationExecutionService.ts`

Rules:

- Engines do not hardcode Twilio.
- UI does not receive Twilio secrets.
- Provider credentials are read server-side from `process.env`.
- Without live provider configuration, communication records internally and does not send customer messages.
- Development-only routes can verify provider infrastructure without weakening production orchestration.

## Service Flow Booking

Service Flow Booking replaces fragile rush-hour time typing with operational slot placement.

Staff select:

1. Service day
2. Service period
3. Operational slot

The manual fallback still exists for edge cases but is validated. Ambiguous values such as `8:30`, `830`, or `9` are rejected unless the selected service period can safely resolve them.

All paths produce canonical ISO `reservationTime`, which downstream systems use for:

- reminders
- slot hold expiry
- collapse probability
- Ghost Ping
- WhatsApp scheduling
- Operational Brain reasoning

Important files:

- `app/restaurant/page.tsx`
- `app/lib/domain/reservationTimeParser.ts`
- `app/api/orders/route.ts`

## Intelligence Layers

Operational intelligence is built from real orders, audit logs, payment state, risk, recovery, communication, memory, policy, and organization signals.

Core layers:

- Operational Brain
- Intelligence Timeline
- multi-location intelligence
- operational memory
- operational simulation and policy
- digital twin
- autonomous decision engine

Important files:

- `app/api/intelligence/brain/route.ts`
- `app/api/intelligence/timeline/route.ts`
- `app/api/intelligence/organization/route.ts`
- `app/lib/intelligence/operationalBrainEngine.ts`
- `app/lib/intelligence/timelineClassifier.ts`
- `app/lib/intelligence/multiLocationIntelligenceEngine.ts`
- `app/lib/operationalMemoryEngine.ts`
- `app/lib/operationalSimulationEngine.ts`
- `app/lib/policyEngine.ts`
- `app/lib/operationalDigitalTwinEngine.ts`

## Safety Guardrails

Valsentra has multiple layers of safety before autonomous execution:

- Payment Truth blocks unsafe release when payment is not verified.
- Fraud uncertainty routes to internal verification.
- Quiet hours suppress external outreach by default.
- Communication fatigue prevents over-contacting customers.
- Cooldowns prevent repeated sends.
- Duplicate event keys prevent continuous-loop log spam.
- VIP and high-value orders receive stricter trust protection.
- Irreversible actions require stronger confidence.
- Production cannot use development-only WhatsApp testing overrides.

Development-only controls:

- `DEV_AUTONOMOUS_TEST_OVERRIDE`
- `DEV_ALLOW_QUIET_HOURS_WHATSAPP`
- `/api/communication/dev-send-whatsapp`

These controls must never be used as production automation settings.

## Environment Safety

`.env.local` is gitignored and must contain real local secrets only.

`.env.example` is safe to commit because it contains empty placeholders only.

Private values must never use `NEXT_PUBLIC_*`. Only browser-safe public Supabase values belong in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

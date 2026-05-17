"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  ChevronDown,
  CircleDot,
  MessageSquare,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

type TimelineCategory =
  | "Risk"
  | "Recovery"
  | "Communication"
  | "Simulation"
  | "Payment"
  | "Staff"
  | "Customer"
  | "Intelligence"
  | "Escalation";

type TimelineSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

type AuditItem = {
  id: number | string;
  action: string;
  staff: string;
  orderId?: string;
  meta?: Record<string, any>;
  createdAt?: string;
};

type TimelineMemoryItem = {
  id: string;
  orderId?: string | null;
  actorSource?: string | null;
  eventType: string;
  summary: string;
  severity: TimelineSeverity;
  category: string;
  timestamp: string;
  metadata?: Record<string, any>;
  traceId?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
};

type OperationalTimelineEvent = {
  id: string;
  eventType: string;
  category: TimelineCategory;
  operationalImpact: string;
  confidence: number | null;
  timestamp: string;
  orderId?: string;
  customerName?: string;
  causalReasoning: string[];
  autonomous: boolean;
  projectedRevenueImpact: number | null;
  severity: TimelineSeverity;
  causalChain: string[];
  relatedSimulation: Record<string, any> | null;
  relatedRecoveryAction: Record<string, any> | null;
  operationalSeverity: TimelineSeverity;
  intelligenceSource: string;
  raw: AuditItem;
};

type FilterMode = "ALL" | TimelineCategory;
type ActorFilter = "ALL" | "AUTONOMOUS" | "MANUAL";
type RevenueFilter = "ALL" | "HAS_REVENUE";
type SeverityFilter = "ALL" | TimelineSeverity;

type OperationalTimelineProps = {
  compact?: boolean;
  initialEvents?: AuditItem[];
};

const CATEGORY_FILTERS: FilterMode[] = [
  "ALL",
  "Risk",
  "Recovery",
  "Communication",
  "Simulation",
  "Payment",
  "Staff",
  "Customer",
  "Intelligence",
  "Escalation",
];

function formatMoney(value?: number | null) {
  if (!value) return "RM 0";
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

function formatTime(value?: string) {
  const parsed = new Date(value ?? "").getTime();
  if (!Number.isFinite(parsed)) return "Live";
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(parsed));
}

function normalizeSeverity(value: unknown): TimelineSeverity {
  const severity = String(value ?? "").toUpperCase();
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "WARNING" || severity === "SUCCESS") return "WARNING";
  if (severity === "WATCH") return "WATCH";
  return "INFO";
}

function categoryFor(item: AuditItem): TimelineCategory {
  const meta = item.meta ?? {};
  const source = `${item.action} ${meta.category ?? ""} ${meta.title ?? ""} ${JSON.stringify(meta)}`.toLowerCase();

  if (meta.operationalSimulation || source.includes("simulation") || source.includes("trajectory")) return "Simulation";
  if (meta.autonomousRecoveryAction || source.includes("recovery") || source.includes("waitlist")) return "Recovery";
  if (source.includes("whatsapp") || source.includes("communication") || source.includes("reminder")) return "Communication";
  if (source.includes("payment") || source.includes("deposit") || source.includes("verified")) return "Payment";
  if (source.includes("collapse") || source.includes("risk") || source.includes("fraud") || source.includes("blocked")) return "Risk";
  if (source.includes("customer") || source.includes("inbound")) return "Customer";
  if (source.includes("escalat") || source.includes("owner review") || source.includes("staff review")) return "Escalation";
  if (source.includes("memory") || source.includes("agent") || source.includes("brain") || source.includes("learning")) return "Intelligence";
  return item.staff?.toLowerCase().includes("valsentra") ? "Intelligence" : "Staff";
}

function iconFor(category: TimelineCategory) {
  if (category === "Risk") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (category === "Recovery") return <ShieldCheck className="h-3.5 w-3.5" />;
  if (category === "Communication") return <MessageSquare className="h-3.5 w-3.5" />;
  if (category === "Payment") return <Wallet className="h-3.5 w-3.5" />;
  if (category === "Customer" || category === "Staff") return <Users className="h-3.5 w-3.5" />;
  if (category === "Escalation") return <Activity className="h-3.5 w-3.5" />;
  return <Brain className="h-3.5 w-3.5" />;
}

function severityClasses(severity: TimelineSeverity) {
  if (severity === "CRITICAL") {
    return {
      dot: "bg-red-500 ring-red-50",
      badge: "border-red-100 bg-red-50 text-red-700",
      rail: "border-l-red-500",
    };
  }
  if (severity === "WARNING") {
    return {
      dot: "bg-amber-500 ring-amber-50",
      badge: "border-amber-100 bg-amber-50 text-amber-700",
      rail: "border-l-amber-500",
    };
  }
  if (severity === "WATCH") {
    return {
      dot: "bg-blue-500 ring-blue-50",
      badge: "border-blue-100 bg-blue-50 text-blue-700",
      rail: "border-l-blue-500",
    };
  }
  return {
    dot: "bg-emerald-500 ring-emerald-50",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    rail: "border-l-emerald-500",
  };
}

function getConfidence(meta: Record<string, any>) {
  const value =
    meta.confidence ??
    meta.simulationConfidence ??
    meta.operationalSimulation?.confidence ??
    meta.autonomousRecoveryAction?.confidence ??
    meta.communicationOrchestration?.recoveryConfidence ??
    meta.multiAgentOperationalBrain?.confidence ??
    meta.communicationDiagnostics?.multiAgentOperationalBrain?.confidence ??
    null;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : null;
}

function getRevenueImpact(meta: Record<string, any>) {
  const value =
    meta.operationalSimulation?.estimatedRevenueLoss ??
    meta.operationalSimulation?.scenarios?.[0]?.estimatedRevenueLoss ??
    meta.autonomousRecoveryAction?.projectedRevenueImpact ??
    meta.recoverableRevenue ??
    meta.orderAmount ??
    meta.communicationOrchestration?.message?.metadata?.recoverableRevenue ??
    meta.learningEntry?.amount ??
    null;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function summarizeImpact(item: AuditItem) {
  const meta = item.meta ?? {};
  return (
    meta.summary ??
    meta.operationalSimulation?.predictedOutcome ??
    meta.autonomousRecoveryAction?.operationalImpact ??
    meta.communicationDiagnostics?.selectedReason ??
    meta.communicationOrchestration?.priorityDiagnostics?.selectedReason ??
    item.action
  );
}

function getReasoning(item: AuditItem) {
  const meta = item.meta ?? {};
  const reasoning = [
    ...(Array.isArray(meta.reasoning) ? meta.reasoning : []),
    ...(Array.isArray(meta.operationalSimulation?.likelyOperationalPath)
      ? meta.operationalSimulation.likelyOperationalPath
      : []),
    ...(Array.isArray(meta.autonomousRecoveryDiagnostics?.recoveryConsensusSignals)
      ? meta.autonomousRecoveryDiagnostics.recoveryConsensusSignals
      : []),
    ...(Array.isArray(meta.communicationDiagnostics?.suppressionReasons)
      ? meta.communicationDiagnostics.suppressionReasons
      : []),
    ...(Array.isArray(meta.dominantSimulationFactors) ? meta.dominantSimulationFactors : []),
  ];

  return reasoning.length > 0 ? reasoning.map(String).slice(0, 6) : [String(summarizeImpact(item))];
}

function isAutonomous(item: AuditItem) {
  return (
    item.staff?.toLowerCase().includes("valsentra") ||
    Boolean(item.meta?.operationalEvent) ||
    Boolean(item.meta?.autonomousRecoveryAction) ||
    Boolean(item.meta?.communicationOrchestration)
  );
}

function normalizeEvent(item: AuditItem): OperationalTimelineEvent {
  const meta = item.meta ?? {};
  const category = categoryFor(item);
  const severity = normalizeSeverity(meta.severity);
  const reasoning = getReasoning(item);

  return {
    id: String(item.id),
    eventType: meta.title ?? item.action,
    category,
    operationalImpact: String(summarizeImpact(item)),
    confidence: getConfidence(meta),
    timestamp: item.createdAt ?? new Date().toISOString(),
    orderId: item.orderId,
    customerName:
      meta.customerName ??
      meta.customerOperationalMemory?.customerName ??
      meta.communicationOrchestration?.message?.metadata?.customerName ??
      undefined,
    causalReasoning: reasoning,
    autonomous: isAutonomous(item),
    projectedRevenueImpact: getRevenueImpact(meta),
    severity,
    causalChain: [
      meta.inboundIntent ? `Customer intent: ${meta.inboundIntent}` : "",
      meta.operationalSimulation?.dominantRisk
        ? `Dominant simulation risk: ${meta.operationalSimulation.dominantRisk}`
        : "",
      meta.autonomousRecoveryAction?.actionType
        ? `Recovery action: ${meta.autonomousRecoveryAction.actionType}`
        : "",
      meta.communicationDiagnostics?.selectedStep
        ? `Communication step: ${meta.communicationDiagnostics.selectedStep}`
        : "",
      meta.multiAgentOperationalBrain?.fusionDecision
        ? `Agent fusion: ${meta.multiAgentOperationalBrain.fusionDecision}`
        : "",
    ].filter(Boolean),
    relatedSimulation: meta.operationalSimulation ?? null,
    relatedRecoveryAction: meta.autonomousRecoveryAction ?? null,
    operationalSeverity: severity,
    intelligenceSource:
      meta.operationalSimulation
        ? "Operational Simulation Engine"
        : meta.autonomousRecoveryAction
          ? "Autonomous Recovery Engine"
          : meta.communicationOrchestration
            ? "Communication System Action"
            : meta.customerOperationalMemory
              ? "Customer Operational Memory"
              : meta.multiAgentOperationalBrain
                ? "Multi-Agent Operational Brain"
                : item.staff ?? "Audit Log",
    raw: item,
  };
}

function auditFromTimelineMemory(item: TimelineMemoryItem): AuditItem {
  return {
    id: item.id,
    action: item.eventType.replaceAll("_", " "),
    staff: item.actorSource ?? "Valsentra Timeline Memory",
    orderId: item.orderId ?? undefined,
    createdAt: item.timestamp,
    meta: {
      ...(item.metadata ?? {}),
      timelineMemory: true,
      title: item.eventType.replaceAll("_", " "),
      summary: item.summary,
      severity: item.severity,
      category: item.category,
      traceId: item.traceId,
      executionId: item.executionId,
      correlationId: item.correlationId,
    },
  };
}

function buildNarrative(events: OperationalTimelineEvent[]) {
  const ordered = [...events].reverse();
  const chain = ordered
    .filter(
      (event) =>
        event.category === "Risk" ||
        event.category === "Simulation" ||
        event.category === "Recovery" ||
        event.category === "Communication"
    )
    .slice(-4);

  if (chain.length === 0) {
    return "Valsentra is monitoring the operation. No connected operational chain has formed yet.";
  }

  return chain
    .map((event) => {
      if (event.category === "Risk") return `Risk changed: ${event.operationalImpact}`;
      if (event.category === "Simulation") return `Simulation projected: ${event.operationalImpact}`;
      if (event.category === "Communication") return `Communication decision: ${event.operationalImpact}`;
      return `Recovery action: ${event.operationalImpact}`;
    })
    .join(" ");
}

export default function OperationalTimeline({
  compact = false,
  initialEvents,
}: OperationalTimelineProps) {
  const [auditEvents, setAuditEvents] = useState<AuditItem[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(!initialEvents);
  const [openId, setOpenId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<FilterMode>("ALL");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("ALL");
  const [revenueFilter, setRevenueFilter] = useState<RevenueFilter>("ALL");
  const [query, setQuery] = useState("");

  async function loadAudit() {
    try {
      const timelineRes = await fetch("/api/operational/timeline?limit=80", { cache: "no-store" });
      const timelineData = await timelineRes.json();
      if (timelineRes.ok && Array.isArray(timelineData.events) && timelineData.events.length > 0) {
        setAuditEvents(timelineData.events.map(auditFromTimelineMemory));
        return;
      }

      const res = await fetch("/api/audit", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setAuditEvents(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialEvents) return;
    loadAudit();
    const interval = setInterval(loadAudit, 8000);
    return () => clearInterval(interval);
  }, [initialEvents]);

  const events = useMemo(() => auditEvents.map(normalizeEvent), [auditEvents]);
  const summary = useMemo(() => {
    const activeRisks = events.filter((event) => event.category === "Risk" && event.severity !== "INFO").length;
    const recoveries = events.filter((event) => event.category === "Recovery").length;
    const projectedLossesPrevented = events
      .filter((event) => event.projectedRevenueImpact)
      .reduce((sum, event) => sum + Number(event.projectedRevenueImpact ?? 0), 0);
    const escalations = events.filter((event) => event.category === "Escalation" || event.severity === "CRITICAL").length;
    const pressureScore = Math.min(100, activeRisks * 18 + escalations * 14 + recoveries * 3);

    return {
      activeRisks,
      recoveries,
      projectedLossesPrevented,
      escalations,
      pressureLabel: pressureScore >= 80 ? "CRITICAL" : pressureScore >= 55 ? "ELEVATED" : pressureScore >= 30 ? "WATCH" : "STABLE",
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const haystack = `${event.orderId ?? ""} ${event.customerName ?? ""} ${event.eventType} ${event.operationalImpact}`.toLowerCase();
      if (categoryFilter !== "ALL" && event.category !== categoryFilter) return false;
      if (severityFilter !== "ALL" && event.severity !== severityFilter) return false;
      if (actorFilter === "AUTONOMOUS" && !event.autonomous) return false;
      if (actorFilter === "MANUAL" && event.autonomous) return false;
      if (revenueFilter === "HAS_REVENUE" && !event.projectedRevenueImpact) return false;
      if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
      return true;
    });
  }, [actorFilter, categoryFilter, events, query, revenueFilter, severityFilter]);

  const visibleEvents = compact ? filteredEvents.slice(0, 5) : filteredEvents.slice(0, 40);
  const narrative = buildNarrative(filteredEvents);

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="sticky top-0 z-10 -mx-2 mb-5 rounded-[26px] border border-neutral-200 bg-white/90 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
              <CircleDot className="h-3.5 w-3.5 animate-pulse text-emerald-600" />
              Operational Timeline Command Center
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
              Live operational chain of events
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
              {narrative}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5 xl:min-w-[560px]">
            <SummaryPill label="Active risks" value={summary.activeRisks} />
            <SummaryPill label="Recoveries" value={summary.recoveries} />
            <SummaryPill label="Prevented" value={formatMoney(summary.projectedLossesPrevented)} />
            <SummaryPill label="Escalations" value={summary.escalations} />
            <SummaryPill label="Pressure" value={summary.pressureLabel} />
          </div>
        </div>

        {!compact ? (
          <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_auto_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by order, customer, event"
              className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none transition focus:border-neutral-400"
            />
            <FilterSelect value={categoryFilter} onChange={(value) => setCategoryFilter(value as FilterMode)} options={CATEGORY_FILTERS} />
            <FilterSelect value={severityFilter} onChange={(value) => setSeverityFilter(value as SeverityFilter)} options={["ALL", "INFO", "WATCH", "WARNING", "CRITICAL"]} />
            <div className="flex gap-2">
              <FilterSelect value={actorFilter} onChange={(value) => setActorFilter(value as ActorFilter)} options={["ALL", "AUTONOMOUS", "MANUAL"]} />
              <FilterSelect value={revenueFilter} onChange={(value) => setRevenueFilter(value as RevenueFilter)} options={["ALL", "HAS_REVENUE"]} />
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          Loading operational timeline...
        </div>
      ) : null}

      {!loading && visibleEvents.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          No matching operational events yet.
        </div>
      ) : null}

      <div className="space-y-3">
        {visibleEvents.map((event, index) => {
          const visual = severityClasses(event.severity);
          const open = openId === event.id;

          return (
            <article
              key={`${event.id}-${event.category}-${event.timestamp}-${index}`}
              className={`rounded-[24px] border border-l-4 border-neutral-200 bg-neutral-50/80 p-4 ${visual.rail}`}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : event.id)}
                className="w-full text-left"
              >
                <div className="grid gap-4 md:grid-cols-[88px_18px_minmax(0,1fr)_auto] md:items-start">
                  <div className="pt-1 text-xs text-neutral-500">
                    <p className="font-semibold text-neutral-800">{formatTime(event.timestamp)}</p>
                    <p className="mt-1">{event.autonomous ? "Autonomous" : "Manual"}</p>
                  </div>
                  <div className="relative hidden justify-center pt-2 md:flex">
                    <span className={`h-3 w-3 rounded-full ring-8 ${visual.dot}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${visual.badge}`}>
                        {iconFor(event.category)}
                        {event.category}
                      </span>
                      {event.orderId ? (
                        <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                          {event.orderId}
                        </span>
                      ) : null}
                      {event.confidence !== null ? (
                        <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                          {event.confidence}% confidence
                        </span>
                      ) : null}
                      {event.projectedRevenueImpact ? (
                        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                          {formatMoney(event.projectedRevenueImpact)}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-neutral-950">{event.eventType}</h3>
                    <p className="mt-1 text-sm leading-6 text-neutral-600">{event.operationalImpact}</p>
                  </div>
                  <div className="flex items-center gap-2 md:justify-end">
                    <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-600">
                      {event.intelligenceSource}
                    </span>
                    <ChevronDown className={`h-4 w-4 text-neutral-500 transition ${open ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </button>

              {open ? (
                <div className="mt-4 grid gap-3 border-t border-neutral-200 pt-4 lg:grid-cols-[1fr_0.9fr]">
                  <DetailBlock title="Causal reasoning" items={event.causalReasoning} />
                  <DetailBlock
                    title="Timeline diagnostics"
                    items={[
                      `Operational severity: ${event.operationalSeverity}.`,
                      `Intelligence source: ${event.intelligenceSource}.`,
                      event.relatedSimulation ? "Related simulation attached." : "No related simulation attached.",
                      event.relatedRecoveryAction ? "Related recovery action attached." : "No related recovery action attached.",
                      ...event.causalChain,
                    ]}
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SummaryPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm font-medium text-neutral-700 outline-none transition focus:border-neutral-400"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}

function DetailBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-5 text-neutral-600">
        {items.slice(0, 8).map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

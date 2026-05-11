"use client";

import { useEffect, useState } from "react";
import AutonomousDecisionPanel, {
  type AutonomousDecision,
  type DecisionRelatedEvent,
} from "./AutonomousDecisionPanel";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  ShieldCheck,
} from "lucide-react";

type TimelineSeverity = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

type TimelineEvent = {
  id: number;
  orderId?: string;
  staff?: string;
  title: string;
  summary: string;
  category: string;
  severity: TimelineSeverity;
  collapseProbability?: number | null;
  collapseRiskTier?: string | null;
  ghostPingUrgency?: string | null;
  createdAt: string;
};

function getVisualSystem(severity: TimelineSeverity) {
  if (severity === "CRITICAL") {
    return {
      dot: "bg-red-500 ring-red-50",
      category: "text-red-700",
      impact: "bg-red-50 text-red-700 border-red-100",
      label: "High Impact",
    };
  }

  if (severity === "WARNING") {
    return {
      dot: "bg-amber-400 ring-amber-50",
      category: "text-amber-700",
      impact: "bg-amber-50 text-amber-700 border-amber-100",
      label: "Medium Impact",
    };
  }

  if (severity === "SUCCESS") {
    return {
      dot: "bg-emerald-500 ring-emerald-50",
      category: "text-emerald-700",
      impact: "bg-emerald-50 text-emerald-700 border-emerald-100",
      label: "Protected",
    };
  }

  return {
    dot: "bg-blue-500 ring-blue-50",
    category: "text-blue-700",
    impact: "bg-blue-50 text-blue-700 border-blue-100",
    label: "Learning",
  };
}

function ImpactIcon({ severity }: { severity: TimelineSeverity }) {
  if (severity === "CRITICAL") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (severity === "WARNING") return <Activity className="h-3.5 w-3.5" />;
  if (severity === "SUCCESS") return <ShieldCheck className="h-3.5 w-3.5" />;
  return <Brain className="h-3.5 w-3.5" />;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleTimeString("en-MY", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function IntelligenceTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDecision, setOpenDecision] = useState<AutonomousDecision | null>(null);

  async function loadTimeline() {
    try {
      const res = await fetch("/api/intelligence/timeline", {
        cache: "no-store",
      });

      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setEvents(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTimeline();

    const interval = setInterval(loadTimeline, 8000);

    return () => clearInterval(interval);
  }, []);

  function openTimelineDecision(event: TimelineEvent) {
    const relatedEvents: DecisionRelatedEvent[] = events
      .filter((candidate) => !event.orderId || candidate.orderId === event.orderId)
      .slice(0, 7)
      .map((candidate) => ({
        id: String(candidate.id),
        title: candidate.title,
        summary: candidate.summary,
        category: candidate.category,
        severity: candidate.severity,
        createdAt: candidate.createdAt,
      }));

    setOpenDecision({
      id: `timeline-${event.id}`,
      title: event.title,
      summary: event.summary,
      severity: event.severity,
      category: event.category.replaceAll("_", " "),
      confidence: event.collapseProbability ?? 68,
      orderId: event.orderId,
      createdAt: event.createdAt,
      riskFactors: [
        event.collapseProbability !== null && event.collapseProbability !== undefined
          ? `Collapse probability is ${event.collapseProbability}%.`
          : "",
        event.collapseRiskTier ? `Collapse risk tier is ${event.collapseRiskTier}.` : "",
        event.ghostPingUrgency ? `Ghost Ping urgency is ${event.ghostPingUrgency}.` : "",
        event.summary,
      ].filter(Boolean),
      reliabilityAnalysis:
        "This timeline event did not include a full customer reliability profile, so Valsentra is presenting the audit-backed decision context available in this stream.",
      paymentState: undefined,
      paymentVerified: undefined,
      relatedEvents,
      revenueImpact: 0,
      noShowProbability: event.collapseProbability ?? undefined,
      recommendedActions: [
        event.ghostPingUrgency
          ? "Continue the Ghost Ping intervention path."
          : "Keep this intelligence event visible in the owner review stream.",
      ],
      reasoning: [
        event.summary,
        event.collapseProbability !== null && event.collapseProbability !== undefined
          ? `The collapse engine attached a ${event.collapseProbability}% probability.`
          : "The audit stream recorded this operational decision.",
      ],
      nextSteps: [
        "Valsentra will keep polling the operational timeline for follow-up events.",
        event.orderId
          ? "Related events for this order will be linked into this decision view."
          : "Future related audit events will appear in this stream.",
      ],
    });
  }

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            Intelligence Timeline
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            Live operational reasoning stream
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            Audit-backed decisions, risk movement, and autonomous revenue protection activity.
          </p>
        </div>

        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          LIVE
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white">
        {loading ? (
          <div className="p-6 text-sm text-neutral-500">
            Loading intelligence timeline...
          </div>
        ) : null}

        {!loading && events.length === 0 ? (
          <div className="p-6 text-sm text-neutral-500">
            No intelligence events yet.
          </div>
        ) : null}

        {events.slice(0, 6).map((event) => {
          const visual = getVisualSystem(event.severity);

          return (
            <button
              type="button"
              onClick={() => openTimelineDecision(event)}
              key={event.id}
              className="grid w-full gap-4 border-b border-neutral-100 px-5 py-4 text-left transition hover:bg-neutral-50/70 last:border-b-0 md:grid-cols-[86px_28px_minmax(0,1fr)_auto] md:items-start"
            >
              <div className="text-xs leading-tight text-neutral-500 md:pt-1">
                <p className="font-semibold text-neutral-800">
                  {formatTime(event.createdAt)}
                </p>
                <p className="mt-1">Today</p>
              </div>

              <div className="relative hidden h-full min-h-[76px] items-start justify-center md:flex">
                <span className="absolute left-1/2 top-4 h-[calc(100%+28px)] w-px -translate-x-1/2 bg-neutral-100" />
                <span
                  className={`relative z-10 mt-2 h-3 w-3 rounded-full ring-8 ${visual.dot}`}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={`text-[11px] font-bold uppercase tracking-[0.14em] ${visual.category}`}
                  >
                    {event.category.replaceAll("_", " ")}
                  </p>

                  {event.orderId ? (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                      {event.orderId}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 text-sm font-semibold text-neutral-950">
                  {event.title}
                </p>

                <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
                  {event.summary}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {event.collapseProbability !== null &&
                  event.collapseProbability !== undefined ? (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                      Collapse {event.collapseProbability}%
                    </span>
                  ) : null}

                  {event.ghostPingUrgency ? (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                      Ghost Ping {event.ghostPingUrgency}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex md:justify-end md:pt-1">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${visual.impact}`}
                >
                  <ImpactIcon severity={event.severity} />
                  {visual.label}
                </span>
              </div>
            </button>
          );
        })}

        {events.length > 6 ? (
          <div className="flex justify-center border-t border-neutral-100 bg-neutral-50/50 px-5 py-4">
            <button className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-8 py-2.5 text-xs font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50">
              View full timeline
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      <AutonomousDecisionPanel
        decision={openDecision}
        onClose={() => setOpenDecision(null)}
      />
    </section>
  );
}

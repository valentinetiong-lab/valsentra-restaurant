import type { RestaurantOrder } from "@/app/lib/domain/restaurant";

export type OperationalClusterType =
  | "STABLE_OPERATION"
  | "CASCADING_LATENESS"
  | "COLLAPSE_CLUSTER"
  | "CONGESTION_PROPAGATION"
  | "GHOST_CUSTOMER_PATTERN"
  | "PAYMENT_BOTTLENECK_WAVE"
  | "RESERVATION_COLLISION_ZONE"
  | "CHAIN_REACTION_CANCELLATION"
  | "HIGH_RISK_OPERATIONAL_PERIOD"
  | "OVERLOADED_RECOVERY_QUEUE"
  | "COMMUNICATION_FATIGUE_HOTSPOT";

export type OperationalKnowledgeGraphCluster = {
  id: string;
  clusterType: OperationalClusterType;
  label: string;
  operationalPressureScore: number;
  collapsePropagationRisk: number;
  serviceWaveRisk: number;
  congestionSeverity: number;
  linkedOrders: string[];
  customerKeys: string[];
  serviceWindow: string;
  systemicRevenueRisk: number;
  operationalStability: "STABLE" | "WATCH" | "ELEVATED" | "CRITICAL";
  chainReactionProbability: number;
  hotspotReasoning: string[];
};

export type OperationalKnowledgeGraphInsight = {
  operationalPressureScore: number;
  collapsePropagationRisk: number;
  serviceWaveRisk: number;
  congestionSeverity: number;
  clusterType: OperationalClusterType;
  linkedOrders: string[];
  dominantOperationalSignals: string[];
  systemicRevenueRisk: number;
  operationalStability: "STABLE" | "WATCH" | "ELEVATED" | "CRITICAL";
  chainReactionProbability: number;
  hotspotReasoning: string[];
  graphSignalsUsed: string[];
  clusters: OperationalKnowledgeGraphCluster[];
  relationshipSummary: {
    orderLinks: number;
    customerLinks: number;
    serviceWaveLinks: number;
    paymentBottleneckLinks: number;
    waitlistDependencyLinks: number;
    escalationClusterLinks: number;
    hotspotCount: number;
  };
  visibility: {
    operationalHeatZones: Array<{ label: string; score: number; orderIds: string[] }>;
    liveCongestionClusters: OperationalKnowledgeGraphCluster[];
    recoveryPressureMap: Array<{ label: string; pressure: number; orderIds: string[] }>;
    serviceWaveHealth: Array<{ serviceWindow: string; health: number; orderIds: string[] }>;
    chainReactionWarnings: string[];
    operationalStabilityIndicators: string[];
  };
};

type AuditRow = Record<string, any>;

type WaveBucket = {
  key: string;
  label: string;
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function isClosed(order: RestaurantOrder) {
  return order.status === "CANCELLED" || order.status === "NO_SHOW";
}

function isVerified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function customerKey(order: RestaurantOrder) {
  return order.phone?.replace(/\D/g, "") || order.customerName.trim().toLowerCase() || order.id;
}

function getMalaysiaParts(value?: string | null) {
  const parsed = new Date(value ?? "").getTime();
  if (!Number.isFinite(parsed)) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(parsed)).map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function serviceWindowFor(order: RestaurantOrder) {
  const parts = getMalaysiaParts(order.reservationTime);
  if (!parts) return "unknown-window";
  const startHour = Math.floor(parts.hour / 2) * 2;
  return `${parts.date} ${String(startHour).padStart(2, "0")}:00-${String(startHour + 2).padStart(2, "0")}:00`;
}

function countAudit(rows: AuditRow[], orderIds: Set<string>, patterns: string[]) {
  return rows.filter((row) => {
    const rowOrderId = String(row.order_id ?? row.orderId ?? "");
    if (rowOrderId && !orderIds.has(rowOrderId)) return false;
    const source = `${row.action ?? ""} ${JSON.stringify(row.meta ?? {})}`.toLowerCase();
    return patterns.some((pattern) => source.includes(pattern));
  }).length;
}

function stabilityFromScore(score: number): OperationalKnowledgeGraphInsight["operationalStability"] {
  if (score >= 78) return "CRITICAL";
  if (score >= 58) return "ELEVATED";
  if (score >= 34) return "WATCH";
  return "STABLE";
}

function clusterTypeFromSignals(input: {
  collapseRisk: number;
  congestion: number;
  paymentBottleneck: number;
  ghostPattern: number;
  lateness: number;
  cancellations: number;
  recoveryPressure: number;
  communicationFatigue: number;
}): OperationalClusterType {
  const sorted = Object.entries(input).sort((a, b) => b[1] - a[1]);
  const [dominant, score] = sorted[0];
  if (score < 34) return "STABLE_OPERATION";
  if (dominant === "lateness") return "CASCADING_LATENESS";
  if (dominant === "collapseRisk") return "COLLAPSE_CLUSTER";
  if (dominant === "congestion") return "CONGESTION_PROPAGATION";
  if (dominant === "ghostPattern") return "GHOST_CUSTOMER_PATTERN";
  if (dominant === "paymentBottleneck") return "PAYMENT_BOTTLENECK_WAVE";
  if (dominant === "cancellations") return "CHAIN_REACTION_CANCELLATION";
  if (dominant === "recoveryPressure") return "OVERLOADED_RECOVERY_QUEUE";
  if (dominant === "communicationFatigue") return "COMMUNICATION_FATIGUE_HOTSPOT";
  return "HIGH_RISK_OPERATIONAL_PERIOD";
}

function buildWaveBuckets(orders: RestaurantOrder[], auditRows: AuditRow[]): WaveBucket[] {
  const activeOrders = orders.filter((order) => !isClosed(order));
  const byWave = new Map<string, RestaurantOrder[]>();

  activeOrders.forEach((order) => {
    const key = serviceWindowFor(order);
    byWave.set(key, [...(byWave.get(key) ?? []), order]);
  });

  return Array.from(byWave.entries()).map(([key, waveOrders]) => {
    const orderIdSet = new Set(waveOrders.map((order) => order.id));
    return {
      key,
      label: key,
      orders: waveOrders,
      auditRows: auditRows.filter((row) => orderIdSet.has(String(row.order_id ?? row.orderId ?? ""))),
    };
  });
}

function buildCluster(bucket: WaveBucket, allAuditRows: AuditRow[], waitlistAvailability: number) {
  const orderIds = bucket.orders.map((order) => order.id);
  const orderIdSet = new Set(orderIds);
  const unresolved = bucket.orders.filter((order) => !isVerified(order));
  const highCollapse = bucket.orders.filter((order) => Number(order.collapseProbability ?? 0) >= 70);
  const blocked = bucket.orders.filter(
    (order) => order.terminalMismatch || order.paymentState === "BLOCKED" || order.paymentState === "FAILED"
  );
  const repeatedCustomers = new Set(
    bucket.orders
      .map(customerKey)
      .filter((key, index, keys) => keys.indexOf(key) !== index)
  );
  const communicationEvents = countAudit(allAuditRows, orderIdSet, ["communication", "whatsapp", "reminder", "ghost"]);
  const recoveryEvents = countAudit(allAuditRows, orderIdSet, ["recovery", "waitlist", "tentative"]);
  const escalationEvents = countAudit(allAuditRows, orderIdSet, ["escalat", "owner review", "staff review"]);
  const lateEvents = countAudit(allAuditRows, orderIdSet, ["running_late", "running late", "late arrival"]);
  const cancellationEvents = countAudit(allAuditRows, orderIdSet, ["cancel", "no_show", "no-show"]);
  const paymentBottleneck = clamp((unresolved.length / Math.max(bucket.orders.length, 1)) * 100);
  const collapsePropagationRisk = clamp(
    highCollapse.length * 22 + blocked.length * 16 + escalationEvents * 8 + paymentBottleneck * 0.22
  );
  const congestionSeverity = clamp(bucket.orders.length * 18 + unresolved.length * 10 + blocked.length * 12);
  const serviceWaveRisk = clamp(
    collapsePropagationRisk * 0.34 + congestionSeverity * 0.32 + paymentBottleneck * 0.22 + lateEvents * 8
  );
  const recoveryPressure = clamp(recoveryEvents * 16 + Math.max(0, unresolved.length - waitlistAvailability) * 12);
  const communicationFatigue = clamp(communicationEvents * 14 + repeatedCustomers.size * 10);
  const chainReactionProbability = clamp(
    collapsePropagationRisk * 0.28 +
      congestionSeverity * 0.24 +
      cancellationEvents * 12 +
      recoveryPressure * 0.18 +
      communicationFatigue * 0.12
  );
  const systemicRevenueRisk = Math.round(
    unresolved.reduce((sum, order) => sum + Number(order.amount ?? 0), 0)
  );
  const operationalPressureScore = clamp(
    serviceWaveRisk * 0.3 +
      collapsePropagationRisk * 0.24 +
      congestionSeverity * 0.2 +
      recoveryPressure * 0.14 +
      communicationFatigue * 0.12
  );
  const clusterType = clusterTypeFromSignals({
    collapseRisk: collapsePropagationRisk,
    congestion: congestionSeverity,
    paymentBottleneck,
    ghostPattern: communicationEvents * 12,
    lateness: lateEvents * 24,
    cancellations: cancellationEvents * 22,
    recoveryPressure,
    communicationFatigue,
  });
  const hotspotReasoning = [
    `${bucket.orders.length} active order${bucket.orders.length === 1 ? "" : "s"} share this service wave.`,
    `${unresolved.length} unresolved payment/order state${unresolved.length === 1 ? "" : "s"} linked inside the wave.`,
    `${highCollapse.length} order${highCollapse.length === 1 ? "" : "s"} have elevated collapse probability.`,
    `${communicationEvents} communication/recovery contact signal${communicationEvents === 1 ? "" : "s"} are attached to linked orders.`,
    ...(waitlistAvailability < unresolved.length
      ? [`Waitlist capacity (${waitlistAvailability}) is below unresolved order count (${unresolved.length}).`]
      : []),
  ];

  return {
    id: `knowledge-graph-${bucket.key}`,
    clusterType,
    label: bucket.label,
    operationalPressureScore,
    collapsePropagationRisk,
    serviceWaveRisk,
    congestionSeverity,
    linkedOrders: orderIds,
    customerKeys: Array.from(new Set(bucket.orders.map(customerKey))),
    serviceWindow: bucket.label,
    systemicRevenueRisk,
    operationalStability: stabilityFromScore(operationalPressureScore),
    chainReactionProbability,
    hotspotReasoning,
  } satisfies OperationalKnowledgeGraphCluster;
}

export function buildOperationalKnowledgeGraph({
  orders,
  auditRows,
  waitlistAvailability,
}: {
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
  waitlistAvailability: number;
}): OperationalKnowledgeGraphInsight {
  const buckets = buildWaveBuckets(orders, auditRows);
  const clusters = buckets
    .map((bucket) => buildCluster(bucket, auditRows, waitlistAvailability))
    .sort((a, b) => b.operationalPressureScore - a.operationalPressureScore);
  const primary = clusters[0] ?? {
    id: "knowledge-graph-stable",
    clusterType: "STABLE_OPERATION",
    label: "No active service wave",
    operationalPressureScore: 0,
    collapsePropagationRisk: 0,
    serviceWaveRisk: 0,
    congestionSeverity: 0,
    linkedOrders: [],
    customerKeys: [],
    serviceWindow: "No active service wave",
    systemicRevenueRisk: 0,
    operationalStability: "STABLE",
    chainReactionProbability: 0,
    hotspotReasoning: ["No active operational graph pressure detected."],
  } satisfies OperationalKnowledgeGraphCluster;
  const linkedOrders = Array.from(new Set(clusters.flatMap((cluster) => cluster.linkedOrders)));
  const customerLinks = Array.from(new Set(clusters.flatMap((cluster) => cluster.customerKeys))).length;
  const paymentBottleneckLinks = clusters.filter((cluster) => cluster.clusterType === "PAYMENT_BOTTLENECK_WAVE").length;
  const waitlistDependencyLinks = clusters.filter((cluster) => cluster.hotspotReasoning.some((reason) => reason.includes("Waitlist capacity"))).length;
  const escalationClusterLinks = clusters.filter((cluster) => cluster.chainReactionProbability >= 60).length;
  const dominantOperationalSignals = [
    `${primary.clusterType.replaceAll("_", " ").toLowerCase()} is the dominant cluster.`,
    `Primary service wave: ${primary.serviceWindow}.`,
    `Collapse propagation risk: ${primary.collapsePropagationRisk}/100.`,
    `Congestion severity: ${primary.congestionSeverity}/100.`,
    `Systemic revenue risk: RM ${primary.systemicRevenueRisk}.`,
  ];
  const graphSignalsUsed = [
    "orders",
    "customer phone/name relationships",
    "reservation service waves",
    "payment state",
    "collapse probability",
    "audit logs",
    "communication events",
    "autonomous recovery events",
    "waitlist capacity",
    "staff/escalation review events",
  ];
  const heatZones = clusters
    .filter((cluster) => cluster.operationalPressureScore >= 34)
    .slice(0, 5)
    .map((cluster) => ({
      label: cluster.serviceWindow,
      score: cluster.operationalPressureScore,
      orderIds: cluster.linkedOrders,
    }));

  return {
    operationalPressureScore: primary.operationalPressureScore,
    collapsePropagationRisk: primary.collapsePropagationRisk,
    serviceWaveRisk: primary.serviceWaveRisk,
    congestionSeverity: primary.congestionSeverity,
    clusterType: primary.clusterType,
    linkedOrders,
    dominantOperationalSignals,
    systemicRevenueRisk: clusters.reduce((sum, cluster) => sum + cluster.systemicRevenueRisk, 0),
    operationalStability: stabilityFromScore(
      Math.round(clusters.reduce((sum, cluster) => sum + cluster.operationalPressureScore, 0) / Math.max(clusters.length, 1))
    ),
    chainReactionProbability: Math.max(...clusters.map((cluster) => cluster.chainReactionProbability), 0),
    hotspotReasoning: primary.hotspotReasoning,
    graphSignalsUsed,
    clusters,
    relationshipSummary: {
      orderLinks: linkedOrders.length,
      customerLinks,
      serviceWaveLinks: clusters.length,
      paymentBottleneckLinks,
      waitlistDependencyLinks,
      escalationClusterLinks,
      hotspotCount: heatZones.length,
    },
    visibility: {
      operationalHeatZones: heatZones,
      liveCongestionClusters: clusters.filter((cluster) => cluster.congestionSeverity >= 58).slice(0, 4),
      recoveryPressureMap: clusters
        .filter((cluster) => cluster.systemicRevenueRisk > 0)
        .slice(0, 5)
        .map((cluster) => ({
          label: cluster.serviceWindow,
          pressure: cluster.serviceWaveRisk,
          orderIds: cluster.linkedOrders,
        })),
      serviceWaveHealth: clusters.slice(0, 6).map((cluster) => ({
        serviceWindow: cluster.serviceWindow,
        health: clamp(100 - cluster.operationalPressureScore),
        orderIds: cluster.linkedOrders,
      })),
      chainReactionWarnings: clusters
        .filter((cluster) => cluster.chainReactionProbability >= 58)
        .map(
          (cluster) =>
            `${cluster.serviceWindow}: ${cluster.chainReactionProbability}% chain-reaction probability across ${cluster.linkedOrders.length} linked orders.`
        ),
      operationalStabilityIndicators: [
        `Overall graph stability is ${stabilityFromScore(primary.operationalPressureScore).toLowerCase()}.`,
        `${clusters.length} service wave cluster${clusters.length === 1 ? "" : "s"} evaluated.`,
        `${linkedOrders.length} order relationship${linkedOrders.length === 1 ? "" : "s"} linked.`,
      ],
    },
  };
}

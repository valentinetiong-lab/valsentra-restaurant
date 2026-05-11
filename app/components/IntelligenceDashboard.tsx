"use client";

import { useEffect, useState } from "react";
import {
  getDangerousCustomers,
  getWorstTimeSlots,
  getStaffMistakes,
  getMoneySavedThisMonth,
  calculateSlotHealth,
  calculateRevenueLeakage,
  OrderRecord,
} from "../lib/intelligenceEngine";

type AuditItem = {
  action: string;
};

const MONTHLY_MESSAGE_LIMIT = 300;
const EXTRA_MESSAGE_RATE = 0.05;

function isMessageAudit(item: AuditItem) {
  const action = item.action.toLowerCase();

  return (
    action.includes("reminder") ||
    action.includes("waitlist") ||
    action.includes("payment link") ||
    action.includes("message")
  );
}

function getMessageUsage(audit: AuditItem[]) {
  const used = audit.filter(isMessageAudit).length;
  const included = MONTHLY_MESSAGE_LIMIT;
  const extra = Math.max(used - included, 0);
  const extraCost = extra * EXTRA_MESSAGE_RATE;

  const includedNum = Number(included);
  const percentage =
    includedNum === 0
      ? 0
      : Math.min((used / includedNum) * 100, 100);

  return { used, included, extra, extraCost, percentage };
}

export default function IntelligenceDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  useEffect(() => {
    fetch("/api/orders")
      .then((res) => res.json())
      .then((data) => setOrders(data));

    fetch("/api/audit")
      .then((res) => res.json())
      .then((data) => setAudit(data || []));
  }, []);

  const dangerousCustomers = getDangerousCustomers(orders);
  const worstSlots = getWorstTimeSlots(orders);
  const staffMistakes = getStaffMistakes(orders);
  const savedThisMonth = getMoneySavedThisMonth(orders);
  const slotHealth = calculateSlotHealth(orders);
  const leakage = calculateRevenueLeakage(orders);

  const messageUsage = getMessageUsage(audit);

  return (
    <div className="rounded-2xl bg-white/70 p-6 shadow backdrop-blur-md mt-6">
      <h2 className="text-xl font-semibold mb-4">Intelligence Dashboard</h2>

      {/* 🔥 TOP METRICS */}
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card title="Saved This Month" value={`RM ${savedThisMonth}`} />
        <Card title="Revenue Leakage" value={`RM ${leakage.leakage}`} />
        <Card title="Recovered Revenue" value={`RM ${leakage.recovered}`} />
        <Card
          title="Messages Used"
          value={`${messageUsage.used} / ${messageUsage.included}`}
        />
      </div>

      {/* ⚠️ MESSAGE LIMIT WARNING */}
      {messageUsage.percentage > 80 && (
        <div className="mb-4 text-sm text-red-500">
          ⚠️ Approaching monthly message limit
        </div>
      )}

      {messageUsage.extra > 0 && (
        <div className="mb-4 text-sm text-gray-600">
          Extra messages: {messageUsage.extra} (RM{" "}
          {messageUsage.extraCost.toFixed(2)})
        </div>
      )}

      <Section title="Dangerous Customers">
        {dangerousCustomers.map((c) => (
          <div key={c.customerName}>
            {c.customerName} — No-shows: {c.noShows}, Cancels:{" "}
            {c.cancelled}
          </div>
        ))}
      </Section>

      <Section title="Worst Time Slots">
        {worstSlots.map((s) => (
          <div key={s.time}>
            {s.time} — {s.count} cancellations
          </div>
        ))}
      </Section>

      <Section title="Staff Mistakes">
        {staffMistakes.map((s) => (
          <div key={s.name}>
            {s.name} — {s.mistakes} issues
          </div>
        ))}
      </Section>

      <Section title="Slot Health Score">
        {slotHealth.map((s) => (
          <div key={s.time}>
            {s.time} — Health: {s.health}%
          </div>
        ))}
      </Section>
    </div>
  );
}

function Card({ title, value }: { title: string; value: any }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="text-sm text-gray-600">{children}</div>
    </div>
  );
}
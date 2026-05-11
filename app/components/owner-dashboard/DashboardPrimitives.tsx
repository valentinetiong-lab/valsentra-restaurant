"use client";

import { useEffect, useState } from "react";

export function MetricCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[24px] border border-neutral-200/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        {title}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-neutral-500">{subtitle}</p>
    </div>
  );
}

export function MiniStat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-neutral-200/80 bg-neutral-50/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
        {value}
      </p>
    </div>
  );
}

export function RuleInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <label className="rounded-[22px] border border-neutral-200/80 bg-neutral-50/80 p-4 text-sm">
      <p className="font-medium text-neutral-900">{label}</p>
      <input
        type="number"
        className="mt-3 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-100"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => onCommit(localValue)}
      />
    </label>
  );
}

export function RuleToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-[22px] border border-neutral-200/80 bg-neutral-50/80 p-4 text-sm">
      <input
        type="checkbox"
        checked={checked}
        className="h-4 w-4 accent-neutral-950"
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

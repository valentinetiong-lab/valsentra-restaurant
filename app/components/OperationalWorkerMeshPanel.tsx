"use client";

import { useEffect, useMemo, useState } from "react";
import { GitBranch, Gauge, Network, ShieldAlert, Workflow } from "lucide-react";
import type { DistributedOperationalWorkerMeshSnapshot } from "@/app/lib/distributedOperationalWorkerMesh";

type OperationalWorkerMeshPanelProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: DistributedOperationalWorkerMeshSnapshot["meshState"]) {
  if (state === "MESH_FAILOVER") return "border-red-200 bg-red-50 text-red-900";
  if (state === "MESH_DEGRADED") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "MESH_ELEVATED") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-neutral-200 bg-white text-neutral-900";
}

function labelFor(state: DistributedOperationalWorkerMeshSnapshot["meshState"]) {
  if (state === "MESH_FAILOVER") return "System rerouting work";
  if (state === "MESH_DEGRADED") return "Worker mesh needs attention";
  if (state === "MESH_ELEVATED") return "Worker mesh load elevated";
  return "Worker mesh healthy";
}

export default function OperationalWorkerMeshPanel({
  compact = false,
  staffMode = false,
}: OperationalWorkerMeshPanelProps) {
  const [mesh, setMesh] = useState<DistributedOperationalWorkerMeshSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/operational/mesh", { cache: "no-store" });
        const data = await res.json();
        if (mounted && res.ok && data?.mesh) setMesh(data.mesh);
      } catch (error) {
        console.error(error);
      }
    }

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const visibleWorkers = useMemo(
    () => mesh?.activeWorkers.slice(0, compact ? 2 : 5) ?? [],
    [compact, mesh]
  );
  const visiblePartitions = useMemo(
    () => mesh?.partitions.slice(0, compact ? 1 : 4) ?? [],
    [compact, mesh]
  );

  if (!mesh) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking operational worker mesh...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(mesh.meshState)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            <Network className="h-4 w-4" />
            {staffMode ? "System Workload" : "Operational Worker Mesh"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {staffMode ? mesh.staffGuidance[0] : labelFor(mesh.meshState)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode
              ? "Valsentra is keeping background work separated so live service stays safe."
              : mesh.ownerSummary}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-2xl border border-white/75 bg-white/75 px-4 py-3 shadow-sm">
            <p className="text-2xl font-semibold tracking-tight">{mesh.meshPressure}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">mesh pressure</p>
          </div>
          <div className="rounded-2xl border border-white/75 bg-white/75 px-4 py-3 shadow-sm">
            <p className="text-2xl font-semibold tracking-tight">{mesh.failoverState}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">failover</p>
          </div>
        </div>
      </div>

      {staffMode ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {mesh.staffGuidance.slice(0, 4).map((item) => (
            <span key={item} className="rounded-full border border-white/80 bg-white/75 px-3 py-2 text-sm font-bold">
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {!staffMode ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
          {visibleWorkers.map((worker) => (
            <div key={worker.leaseId} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <Workflow className="h-4 w-4" />
                  {worker.workerId}
                </p>
                <span className="rounded-full border border-white/80 bg-white px-2.5 py-1 text-[11px] font-bold">
                  {worker.state.replace("WORKER_", "")}
                </span>
              </div>
              <p className="mt-2 text-sm opacity-80">
                Owns {worker.partitionId}. Load {worker.load}/100.
              </p>
              {worker.failoverTarget ? (
                <p className="mt-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] opacity-70">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  failover ready
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
        {visiblePartitions.map((partition) => (
          <div key={partition.partitionId} className="rounded-2xl border border-white/80 bg-white/75 p-4">
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="h-4 w-4" />
              {partition.locationId ?? "Organization partition"}
            </p>
            <p className="mt-1 text-sm opacity-80">
              {partition.state.replaceAll("_", " ")}. Owner {partition.ownerWorkerId}.
            </p>
            <p className="mt-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] opacity-70">
              <Gauge className="h-3.5 w-3.5" />
              execution pressure {partition.executionPressure}/100
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

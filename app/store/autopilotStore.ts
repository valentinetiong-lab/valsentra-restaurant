import { create } from "zustand";
import { defaultAutopilotRules } from "../lib/default-autopilot-rules";
import { runAutopilot } from "../lib/autopilotEngine";
import {
  AutopilotQueueItem,
  AutopilotRule,
  RestaurantOrder,
} from "../types/autopilot";

type RestaurantSettingsSync = {
  dineInDepositGuestsThreshold: number;
  pickupDepositAmountThreshold: number;
  lowReliabilityThreshold: number;
  autoBlockHighValueUnpaid: boolean;
  hardBlockTerminalMismatch: boolean;
};

type AutopilotState = {
  rules: AutopilotRule[];
  queue: AutopilotQueueItem[];
  revenueSaved: number;

  setRules: (rules: AutopilotRule[]) => void;
  toggleRule: (key: AutopilotRule["key"]) => void;
  updateRuleConfig: (
    key: AutopilotRule["key"],
    config: Partial<NonNullable<AutopilotRule["config"]>>
  ) => void;
  syncRulesFromSettings: (settings: RestaurantSettingsSync) => void;

  evaluateOrders: (orders: RestaurantOrder[]) => void;
  approveQueueItem: (id: string, reviewedBy?: string) => void;
  rejectQueueItem: (id: string, reviewedBy?: string) => void;
  markQueueItemDone: (id: string) => void;
  markQueueItemSkipped: (id: string) => void;
  clearCompletedQueueItems: () => void;
};

function getQueueSignature(item: AutopilotQueueItem) {
  return `${item.orderId}:${item.ruleKey}:${item.action}:${item.reason}`;
}

function removeDuplicateQueueItems(items: AutopilotQueueItem[]) {
  const seen = new Set<string>();
  const deduped: AutopilotQueueItem[] = [];

  for (const item of items) {
    const signature = getQueueSignature(item);
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(item);
  }

  return deduped;
}

function isFinalQueueStatus(status: AutopilotQueueItem["status"]) {
  return status === "DONE" || status === "REJECTED" || status === "SKIPPED";
}

function mergeQueueItems(
  existingQueue: AutopilotQueueItem[],
  incomingQueue: AutopilotQueueItem[]
) {
  const nextQueue = removeDuplicateQueueItems(incomingQueue);
  const existingBySignature = new Map<string, AutopilotQueueItem>();

  for (const item of existingQueue) {
    existingBySignature.set(getQueueSignature(item), item);
  }

  const merged: AutopilotQueueItem[] = nextQueue.map((nextItem) => {
    const existing = existingBySignature.get(getQueueSignature(nextItem));

    if (!existing) {
      return {
        ...nextItem,
        id: `${nextItem.ruleKey}-${nextItem.action}-${nextItem.orderId}-${Math.abs(
          nextItem.reason
            .split("")
            .reduce((sum, char) => sum + char.charCodeAt(0), 0)
        )}`,
      };
    }

    return {
      ...nextItem,
      id: existing.id,
      status: existing.status,
      createdAt: existing.createdAt,
      approvedAt: existing.approvedAt,
      rejectedAt: existing.rejectedAt,
      completedAt: existing.completedAt,
      skippedAt: existing.skippedAt,
      reviewedBy: existing.reviewedBy,
    };
  });

  const finalItemsToKeep = existingQueue.filter(
    (existingItem) =>
      isFinalQueueStatus(existingItem.status) &&
      !nextQueue.some(
        (nextItem) => getQueueSignature(nextItem) === getQueueSignature(existingItem)
      )
  );

  return removeDuplicateQueueItems([...merged, ...finalItemsToKeep]);
}

export const useAutopilotStore = create<AutopilotState>((set, get) => ({
  rules: defaultAutopilotRules,
  queue: [],
  revenueSaved: 0,

  setRules: (rules) => set({ rules }),

  toggleRule: (key) =>
    set((state) => ({
      rules: state.rules.map((rule) =>
        rule.key === key ? { ...rule, enabled: !rule.enabled } : rule
      ),
    })),

  updateRuleConfig: (key, config) =>
    set((state) => ({
      rules: state.rules.map((rule) =>
        rule.key === key
          ? {
              ...rule,
              config: {
                ...rule.config,
                ...config,
              },
            }
          : rule
      ),
    })),

  syncRulesFromSettings: (settings) =>
    set((state) => ({
      rules: state.rules.map((rule) => {
        if (rule.key === "DINE_IN_DEPOSIT_BY_GUESTS") {
          return {
            ...rule,
            config: {
              ...rule.config,
              guestThreshold: settings.dineInDepositGuestsThreshold,
            },
          };
        }

        if (rule.key === "HIGH_VALUE_DEPOSIT") {
          return {
            ...rule,
            config: {
              ...rule.config,
              amountThreshold: settings.pickupDepositAmountThreshold,
            },
          };
        }

        if (rule.key === "LOW_RELIABILITY_DEPOSIT") {
          return {
            ...rule,
            config: {
              ...rule.config,
              reliabilityThreshold: settings.lowReliabilityThreshold,
            },
          };
        }

        if (rule.key === "AUTO_BLOCK_HIGH_VALUE_UNPAID") {
          return {
            ...rule,
            enabled: settings.autoBlockHighValueUnpaid,
          };
        }

        if (rule.key === "HARD_BLOCK_TERMINAL_MISMATCH") {
          return {
            ...rule,
            enabled: settings.hardBlockTerminalMismatch,
          };
        }

        return rule;
      }),
    })),

  evaluateOrders: (orders) => {
    const { rules, queue } = get();
    const result = runAutopilot(orders, rules);

    set({
      queue: mergeQueueItems(queue, result.queue),
      revenueSaved: result.revenueSaved,
    });
  },

  approveQueueItem: (id, reviewedBy = "Owner") =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "APPROVED",
              approvedAt: new Date().toISOString(),
              reviewedBy,
            }
          : item
      ),
    })),

  rejectQueueItem: (id, reviewedBy = "Owner") =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "REJECTED",
              rejectedAt: new Date().toISOString(),
              reviewedBy,
            }
          : item
      ),
    })),

  markQueueItemDone: (id) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "DONE",
              completedAt: new Date().toISOString(),
            }
          : item
      ),
    })),

  markQueueItemSkipped: (id) =>
    set((state) => ({
      queue: state.queue.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "SKIPPED",
              skippedAt: new Date().toISOString(),
            }
          : item
      ),
    })),

  clearCompletedQueueItems: () =>
    set((state) => ({
      queue: state.queue.filter(
        (item) =>
          item.status !== "DONE" &&
          item.status !== "REJECTED" &&
          item.status !== "SKIPPED"
      ),
    })),
}));

export type CommunicationChannel = "WHATSAPP" | "SMS" | "EMAIL" | "INTERNAL";

export type CommunicationSendInput = {
  channel: CommunicationChannel;
  to: string;
  message: string;
  orderId?: string;
  customerName?: string;
  metadata?: Record<string, unknown>;
};

export type CommunicationProviderResult = {
  ok: boolean;
  provider: string;
  mode: "INTERNAL" | "LIVE";
  messageId?: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "RECORDED" | "SUPPRESSED" | "FAILED" | "RETRYING";
  error?: string;
  degraded?: boolean;
  retryable?: boolean;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

export type CommunicationProvider = {
  name: string;
  mode: "INTERNAL" | "LIVE";
  channel: CommunicationChannel;
  canSend(input: CommunicationSendInput): boolean;
  send(input: CommunicationSendInput): Promise<CommunicationProviderResult>;
};

export type ProviderHealthStatus = "READY" | "NOT_CONFIGURED" | "DEGRADED" | "OUTAGE";

export type ProviderStatus = {
  provider: string;
  channel: CommunicationChannel;
  status: ProviderHealthStatus;
  configured: boolean;
  liveSendingEnabled: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
};

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
  status: "QUEUED" | "SENT" | "RECORDED" | "SUPPRESSED" | "FAILED";
  error?: string;
  metadata?: Record<string, unknown>;
};

export type CommunicationProvider = {
  name: string;
  mode: "INTERNAL" | "LIVE";
  canSend(input: CommunicationSendInput): boolean;
  send(input: CommunicationSendInput): Promise<CommunicationProviderResult>;
};

export type PaymentProviderAction =
  | "CREATE_PAYMENT_LINK"
  | "VERIFY_PAYMENT"
  | "REFUND_PAYMENT"
  | "GET_PAYMENT_STATUS"
  | "CANCEL_PAYMENT_REQUEST";

export type PaymentProviderInput = {
  action: PaymentProviderAction;
  organizationId: string;
  locationId?: string | null;
  orderId: string;
  amount: number;
  currency?: "MYR";
  customerName?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentProviderResult = {
  ok: boolean;
  provider: string;
  mode: "NOT_CONFIGURED" | "PROVIDER_READY" | "LIVE";
  status: "CREATED" | "PENDING" | "VERIFIED" | "EXPIRED" | "CANCELLED" | "SUPPRESSED" | "FAILED";
  paymentLink?: string;
  paymentQrPayload?: string;
  providerReference?: string;
  expiresAt?: string;
  error?: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
};

export type PaymentWebhookVerificationResult = {
  ok: boolean;
  configured: boolean;
  reason: string;
};

export type PaymentProviderCallback = {
  orderId: string;
  organizationId?: string | null;
  locationId?: string | null;
  paymentIntentId?: string | null;
  providerReference?: string | null;
  expectedAmount?: number | null;
  paidAmount: number;
  currency: string;
  paymentStatus: string;
  callbackSource: string;
  verifiedAt?: string | null;
  providerMetadata?: Record<string, unknown>;
};

export type PaymentProvider = {
  name: string;
  mode: "NOT_CONFIGURED" | "PROVIDER_READY" | "LIVE";
  canExecute(input: PaymentProviderInput): boolean;
  execute(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  verifyWebhookSignature(rawBody: string, headers: Headers): PaymentWebhookVerificationResult;
  normalizeCallbackPayload(payload: Record<string, any>): PaymentProviderCallback;
  getPaymentStatus(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  cancelPaymentRequest(input: PaymentProviderInput): Promise<PaymentProviderResult>;
};

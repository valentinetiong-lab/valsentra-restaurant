export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV !== "production";
const isNextProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export function requireProductionGuard(reason = "Production guard is required."): GuardResult {
  if (isProduction) {
    return {
      ok: false,
      status: 403,
      code: "PRODUCTION_GUARD_BLOCKED",
      message: reason,
    };
  }

  return { ok: true };
}

export function requireDevelopmentOnly(routeName = "Development route"): GuardResult {
  if (!isDevelopment) {
    return {
      ok: false,
      status: 403,
      code: "DEVELOPMENT_ONLY_ROUTE_BLOCKED",
      message: `${routeName} is disabled in production.`,
    };
  }

  return { ok: true };
}

export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function validateProductionEnvironment() {
  if (!isProduction || isNextProductionBuild) return;

  requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL");
  requireEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
  requireEnvironmentVariable("WHATSAPP_WEBHOOK_SIGNING_SECRET");

  if (process.env.COMMUNICATION_PROVIDER === "twilio") {
    requireEnvironmentVariable("TWILIO_ACCOUNT_SID");
    requireEnvironmentVariable("TWILIO_AUTH_TOKEN");
    requireEnvironmentVariable("TWILIO_WHATSAPP_FROM");
  }

  if (process.env.PAYMENT_PROVIDER) {
    requireEnvironmentVariable("PAYMENT_WEBHOOK_SIGNING_SECRET");
  }
}

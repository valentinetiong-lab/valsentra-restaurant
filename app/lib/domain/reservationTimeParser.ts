export type ReservationTimeParseResult =
  | {
      ok: true;
      reservationTime: string;
      input: string;
      interpretedTimezone: "Asia/Kuala_Lumpur";
      interpretedLocalDate: string;
      interpretedLocalTime: string;
    }
  | {
      ok: false;
      input: string;
      error: string;
    };

const MALAYSIA_UTC_OFFSET_HOURS = 8;
export const AMBIGUOUS_RESERVATION_TIME_MESSAGE =
  "Please include AM/PM, e.g. 8:30pm, or use 24-hour time like 20:30.";
export const SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE =
  "Select a service period or include AM/PM.";

export type ServicePeriod = "LUNCH" | "DINNER" | "LATE_NIGHT" | "CUSTOM";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isValidIsoDateTime(value: string) {
  if (!value.includes("T")) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function getMalaysiaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function buildMalaysiaIsoDateTime(hour: number, minute: number, now = new Date()) {
  const local = getMalaysiaDateParts(now);
  let utcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    hour - MALAYSIA_UTC_OFFSET_HOURS,
    minute,
    0,
    0
  );

  if (utcMs < now.getTime()) {
    utcMs += 24 * 60 * 60 * 1000;
  }

  const interpreted = new Date(utcMs + MALAYSIA_UTC_OFFSET_HOURS * 60 * 60 * 1000);

  return {
    iso: new Date(utcMs).toISOString(),
    localDate: `${interpreted.getUTCFullYear()}-${pad(interpreted.getUTCMonth() + 1)}-${pad(
      interpreted.getUTCDate()
    )}`,
    localTime: `${pad(hour)}:${pad(minute)}`,
  };
}

function isValidServiceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function buildMalaysiaIsoDateTimeForDate(
  serviceDate: string,
  hour: number,
  minute: number
):
  | {
      iso: string;
      localDate: string;
      localTime: string;
    }
  | { error: string } {
  if (!isValidServiceDate(serviceDate)) {
    return { error: "Choose a valid reservation date." };
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { error: "Choose a valid reservation time." };
  }

  const [year, month, day] = serviceDate.split("-").map(Number);
  const utcMs = Date.UTC(
    year,
    month - 1,
    day,
    hour - MALAYSIA_UTC_OFFSET_HOURS,
    minute,
    0,
    0
  );

  return {
    iso: new Date(utcMs).toISOString(),
    localDate: serviceDate,
    localTime: `${pad(hour)}:${pad(minute)}`,
  };
}

function parseAmbiguousHourMinute(raw: string): { hour: number; minute: number } | { error: string } {
  const value = raw.toLowerCase().replace(/\s+/g, "").replace(".", ":");

  if (value.includes(":")) {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return { error: `Reservation time "${raw}" is invalid. Use a format like 8:30pm or 20:30.` };
    }

    return {
      hour: Number(match[1]),
      minute: Number(match[2]),
    };
  }

  const match = value.match(/^(\d{1,4})$/);
  if (!match) {
    return { error: `Reservation time "${raw}" is invalid. Use a format like 8:30pm or 20:30.` };
  }

  const digits = match[1];
  if (digits.length <= 2) {
    return {
      hour: Number(digits),
      minute: 0,
    };
  }

  return {
    hour: Number(digits.slice(0, -2)),
    minute: Number(digits.slice(-2)),
  };
}

function resolveAmbiguousTimeWithServicePeriod(
  raw: string,
  servicePeriod: ServicePeriod
): { hour: number; minute: number } | { error: string } {
  if (servicePeriod === "CUSTOM") {
    return { error: SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE };
  }

  const parsed = parseAmbiguousHourMinute(raw);
  if ("error" in parsed) return parsed;

  if (parsed.minute < 0 || parsed.minute > 59) {
    return { error: `Reservation time "${raw}" has an invalid minute value.` };
  }

  if (parsed.hour < 1 || parsed.hour > 12) {
    return { error: SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE };
  }

  let resolvedHour = parsed.hour;

  if (servicePeriod === "LUNCH") {
    if (parsed.hour >= 1 && parsed.hour <= 2) resolvedHour = parsed.hour + 12;
    if (parsed.hour === 12) resolvedHour = 12;

    if (resolvedHour >= 12 && resolvedHour <= 14) {
      return { hour: resolvedHour, minute: parsed.minute };
    }
  }

  if (servicePeriod === "DINNER") {
    resolvedHour = parsed.hour === 12 ? 12 : parsed.hour + 12;

    if (resolvedHour >= 18 && resolvedHour <= 21) {
      return { hour: resolvedHour, minute: parsed.minute };
    }
  }

  if (servicePeriod === "LATE_NIGHT") {
    resolvedHour = parsed.hour === 12 ? 12 : parsed.hour + 12;

    if (resolvedHour >= 21 && resolvedHour <= 23) {
      return { hour: resolvedHour, minute: parsed.minute };
    }
  }

  return { error: SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE };
}

function parseHourMinute(raw: string): { hour: number; minute: number } | { error: string } {
  const value = raw.toLowerCase().replace(/\s+/g, "").replace(".", ":");
  const meridiemMatch = value.match(/(am|pm)$/);
  const meridiem = meridiemMatch?.[1] as "am" | "pm" | undefined;
  const timePart = meridiem ? value.slice(0, -meridiem.length) : value;

  if (!meridiem && /^\d{1,2}$/.test(timePart)) {
    return {
      error: AMBIGUOUS_RESERVATION_TIME_MESSAGE,
    };
  }

  if (!meridiem && /^\d{3,4}$/.test(timePart)) {
    return {
      error: AMBIGUOUS_RESERVATION_TIME_MESSAGE,
    };
  }

  let hour: number;
  let minute: number;

  if (timePart.includes(":")) {
    const match = timePart.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return { error: `Reservation time "${raw}" is invalid. Use a format like 8:30pm or 20:30.` };
    }
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (!meridiem && hour >= 1 && hour <= 12) {
      return { error: AMBIGUOUS_RESERVATION_TIME_MESSAGE };
    }
  } else {
    const match = timePart.match(/^(\d{1,4})$/);
    if (!match || !meridiem) {
      return { error: `Reservation time "${raw}" is invalid. Use a format like 8:30pm or 20:30.` };
    }
    const digits = match[1];
    if (digits.length <= 2) {
      hour = Number(digits);
      minute = 0;
    } else {
      hour = Number(digits.slice(0, -2));
      minute = Number(digits.slice(-2));
    }
  }

  if (minute < 0 || minute > 59) {
    return { error: `Reservation time "${raw}" has an invalid minute value.` };
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { error: `Reservation time "${raw}" has an invalid 12-hour value.` };
    }
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return { error: `Reservation time "${raw}" has an invalid 24-hour value.` };
  }

  return { hour, minute };
}

export function parseReservationTime(input: string, now = new Date()): ReservationTimeParseResult {
  const raw = input.trim();

  if (!raw) {
    return { ok: false, input, error: "Reservation time is required." };
  }

  if (isValidIsoDateTime(raw)) {
    return {
      ok: true,
      input,
      reservationTime: new Date(raw).toISOString(),
      interpretedTimezone: "Asia/Kuala_Lumpur",
      interpretedLocalDate: raw.slice(0, 10),
      interpretedLocalTime: raw.slice(11, 16),
    };
  }

  const parsed = parseHourMinute(raw);
  if ("error" in parsed) {
    return { ok: false, input, error: parsed.error };
  }

  const canonical = buildMalaysiaIsoDateTime(parsed.hour, parsed.minute, now);

  return {
    ok: true,
    input,
    reservationTime: canonical.iso,
    interpretedTimezone: "Asia/Kuala_Lumpur",
    interpretedLocalDate: canonical.localDate,
    interpretedLocalTime: canonical.localTime,
  };
}

export function buildReservationTimeForServiceSlot(
  serviceDate: string,
  hour: number,
  minute: number,
  input = `${pad(hour)}:${pad(minute)}`
): ReservationTimeParseResult {
  const canonical = buildMalaysiaIsoDateTimeForDate(serviceDate, hour, minute);

  if ("error" in canonical) {
    return { ok: false, input, error: canonical.error };
  }

  return {
    ok: true,
    input,
    reservationTime: canonical.iso,
    interpretedTimezone: "Asia/Kuala_Lumpur",
    interpretedLocalDate: canonical.localDate,
    interpretedLocalTime: canonical.localTime,
  };
}

export function parseReservationTimeForServiceDate(
  input: string,
  serviceDate: string,
  servicePeriod: ServicePeriod
): ReservationTimeParseResult {
  const raw = input.trim();

  if (!raw) {
    return { ok: false, input, error: "Reservation time is required." };
  }

  if (isValidIsoDateTime(raw)) {
    return {
      ok: true,
      input,
      reservationTime: new Date(raw).toISOString(),
      interpretedTimezone: "Asia/Kuala_Lumpur",
      interpretedLocalDate: raw.slice(0, 10),
      interpretedLocalTime: raw.slice(11, 16),
    };
  }

  const value = raw.toLowerCase().replace(/\s+/g, "").replace(".", ":");
  const hasMeridiem = /(am|pm)$/.test(value);
  const isColon24Hour = !hasMeridiem && /^(\d{1,2}):(\d{2})$/.test(value);
  const colonHour = isColon24Hour ? Number(value.split(":")[0]) : null;
  const canUseStrictParser = hasMeridiem || (isColon24Hour && colonHour !== null && (colonHour === 0 || colonHour > 12));
  const parsed = canUseStrictParser
    ? parseHourMinute(raw)
    : resolveAmbiguousTimeWithServicePeriod(raw, servicePeriod);

  if ("error" in parsed) {
    return { ok: false, input, error: parsed.error };
  }

  const canonical = buildMalaysiaIsoDateTimeForDate(serviceDate, parsed.hour, parsed.minute);

  if ("error" in canonical) {
    return { ok: false, input, error: canonical.error };
  }

  return {
    ok: true,
    input,
    reservationTime: canonical.iso,
    interpretedTimezone: "Asia/Kuala_Lumpur",
    interpretedLocalDate: canonical.localDate,
    interpretedLocalTime: canonical.localTime,
  };
}

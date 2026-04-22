import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const LONDON_TZ = "Europe/London";

export function fmtLondon(value: string | Date | null | undefined, fmt: string = "dd MMM yyyy HH:mm"): string {
  if (!value) return "—";
  try {
    return formatInTimeZone(typeof value === "string" ? new Date(value) : value, LONDON_TZ, fmt);
  } catch {
    return "—";
  }
}

export function fmtLondonDate(value: string | Date | null | undefined): string {
  return fmtLondon(value, "dd MMM yyyy");
}

export function fmtLondonTime(value: string | Date | null | undefined): string {
  return fmtLondon(value, "HH:mm");
}

export function isoToLondonInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  try {
    return formatInTimeZone(typeof value === "string" ? new Date(value) : value, LONDON_TZ, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

export function londonInputToIso(localStr: string | null | undefined): string {
  if (!localStr) return "";
  try {
    const utc = fromZonedTime(localStr, LONDON_TZ);
    return utc.toISOString();
  } catch {
    return "";
  }
}

export function nowLondonInput(): string {
  return formatInTimeZone(new Date(), LONDON_TZ, "yyyy-MM-dd'T'HH:mm");
}

export function todayLondonDate(): string {
  return formatInTimeZone(new Date(), LONDON_TZ, "yyyy-MM-dd");
}

export function londonZoned(value: string | Date): Date {
  return toZonedTime(typeof value === "string" ? new Date(value) : value, LONDON_TZ);
}

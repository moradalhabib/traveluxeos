// Single source of truth for the client nationality picker AND phone-prefix
// nationality detection. The list is intentionally short and operator-curated
// — not an ISO list — because it maps directly to the markets Traveluxe
// actually serves. Adding a new option here is the only change required to
// surface it everywhere (client form, booking form, booking detail flag,
// driver job sheet, Intel page, Clients filter).
//
// `flag` uses the regional-indicator unicode pair so it renders as a real flag
// emoji on every modern device (incl. iOS, Android, Chrome on macOS). Browsers
// without flag support degrade gracefully to the country code letters.

export type NationalityOption = {
  value: string;
  label: string;
  flag: string;
};

export const NATIONALITIES: NationalityOption[] = [
  { value: "Kuwait",        label: "Kuwait",        flag: "🇰🇼" },
  { value: "Saudi Arabia",  label: "Saudi Arabia",  flag: "🇸🇦" },
  { value: "UAE",           label: "UAE",           flag: "🇦🇪" },
  { value: "Qatar",         label: "Qatar",         flag: "🇶🇦" },
  { value: "Bahrain",       label: "Bahrain",       flag: "🇧🇭" },
  { value: "Oman",          label: "Oman",          flag: "🇴🇲" },
  { value: "Iraq",          label: "Iraq",          flag: "🇮🇶" },
  { value: "Jordan",        label: "Jordan",        flag: "🇯🇴" },
  { value: "Egypt",         label: "Egypt",         flag: "🇪🇬" },
  { value: "UK",            label: "UK",            flag: "🇬🇧" },
  { value: "Other",         label: "Other",         flag: "🌍" },
];

const BY_VALUE = new Map(NATIONALITIES.map((n) => [n.value.toLowerCase(), n]));

// ── Phone-prefix nationality detection ───────────────────────────────────────
// Used by the Intel page AND the Clients page so both always group clients by
// exactly the same logic. Longer codes must be tested before shorter ones.
export const PHONE_CODES: { code: string; flag: string; country: string }[] = [
  { code: "+971", flag: "🇦🇪", country: "UAE" },
  { code: "+966", flag: "🇸🇦", country: "Saudi Arabia" },
  { code: "+974", flag: "🇶🇦", country: "Qatar" },
  { code: "+965", flag: "🇰🇼", country: "Kuwait" },
  { code: "+968", flag: "🇴🇲", country: "Oman" },
  { code: "+973", flag: "🇧🇭", country: "Bahrain" },
  { code: "+44",  flag: "🇬🇧", country: "United Kingdom" },
  { code: "+1",   flag: "🇺🇸", country: "United States" },
];

/**
 * Derive a client's display nationality from their stored nationality field
 * and/or whatsapp/phone number. Priority: nationality field > phone prefix.
 * Returns "Other" when neither resolves to a known country.
 *
 * Shared between the Intel analytics page and the Clients list so that clicking
 * a nationality row on Intel always produces exactly the same set of clients.
 */
export function detectNat(
  phone: string | null,
  whatsapp: string | null,
  nationality: string | null,
): { flag: string; country: string } {
  if (nationality) {
    const m = PHONE_CODES.find(c => c.country.toLowerCase() === nationality.toLowerCase());
    return m ? { flag: m.flag, country: m.country } : { flag: "🌍", country: nationality };
  }
  const raw = (phone || whatsapp || "").replace(/[\s\-\(\)\.]/g, "");
  if (!raw) return { flag: "🌍", country: "Other" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (raw.startsWith(c.code)) return { flag: c.flag, country: c.country };
  }
  return { flag: "🌍", country: "Other" };
}

// Tolerant lookup so legacy free-text values typed before the dropdown was
// introduced (e.g. "kuwait", "United Kingdom") still resolve to a flag where
// possible. Falls back to a globe emoji so the UI stays visually consistent
// rather than rendering nothing.
export function nationalityFlag(value: string | null | undefined): string {
  if (!value) return "";
  const direct = BY_VALUE.get(value.trim().toLowerCase());
  if (direct) return direct.flag;
  const v = value.trim().toLowerCase();
  if (v === "united kingdom" || v === "uk" || v === "britain" || v === "england") return "🇬🇧";
  if (v === "ksa" || v === "saudi") return "🇸🇦";
  if (v === "united arab emirates" || v === "emirates") return "🇦🇪";
  return "🌍";
}

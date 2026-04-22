// Single source of truth for the client nationality picker. The list is
// intentionally short and operator-curated — not an ISO list — because it maps
// directly to the markets Traveluxe actually serves. Adding a new option here
// is the only change required to surface it everywhere (client form, booking
// form, booking detail flag, driver job sheet).
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

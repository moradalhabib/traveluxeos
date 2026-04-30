// Supplier-driven booking detection.
//
// A booking is "supplier-driven" when a third-party supplier (e.g.
// RMS Europe Cars) is providing the vehicle — there is no TVL driver,
// no TVL vehicle on the road, and the operator should see SUPPLIER
// context (Message Supplier, Send Supplier Confirmation, Supplier
// Confirmation status) instead of DRIVER context across the app.
//
// The rule is intentionally derived from booking data so the operator
// never has to flip a manual toggle. Booking forms additionally mirror
// the result into the legacy `as_directed_supplier_driver` column so
// the Supabase recalc trigger (which rolls driver cost into supplier
// cost on supplier-driven jobs) keeps firing correctly.

// Service types where a vehicle is on the road. Only these can be
// "supplier-driven" — accommodation, restaurants, etc. never are.
// NB: the canonical service_type value in this app is "Tour" (the
// Booking form, the API, and the email templates all use that string),
// so we accept both "Tour" and the legacy "Tour Operator" label.
const VEHICLE_SERVICE_TYPES: ReadonlySet<string> = new Set([
  "Airport Transfer",
  "Car Rental",
  "Tour",
  "Tour Operator",
  "Helicopter",
  "Yacht",
]);

export function bookingNeedsVehicle(serviceType?: string | null): boolean {
  if (!serviceType) return false;
  return VEHICLE_SERVICE_TYPES.has(serviceType);
}

export type SupplierDrivenInput = {
  supplier_id?: string | null;
  driver_id?: string | null;
  service_type?: string | null;
  as_directed_supplier_driver?: boolean | null;
};

/**
 * Returns true when the booking should be presented as a supplier-driven
 * job (no TVL driver, supplier provides the vehicle).
 *
 * Intentionally tolerant of partially-loaded form values — any missing
 * field falls back to the "not supplier-driven" branch so the existing
 * driver-centric UI continues to render.
 */
export function isSupplierDrivenJob(b: SupplierDrivenInput | null | undefined): boolean {
  if (!b) return false;
  if (b.as_directed_supplier_driver === true) return true;
  const supplierId = (b.supplier_id ?? "").toString().trim();
  const driverId   = (b.driver_id ?? "").toString().trim();
  if (!supplierId) return false;
  if (driverId)    return false;
  return bookingNeedsVehicle(b.service_type);
}

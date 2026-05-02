export * from "./generated/api";
// `generated/types/*` is intentionally NOT re-exported from this barrel.
// It contains TS interfaces (e.g. `CancelBookingBody`) that share names
// with the zod schemas exported from `generated/api.ts`. `export const X`
// binds both value and type namespaces, so re-exporting the duplicate
// type triggers TS2308. Consumers that want the inferred type should
// derive it via `z.infer<typeof X>` from the schema, or import directly
// from a deeper path under `generated/types/`.

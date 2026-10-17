/** Deliberately unfamiliar, legitimate local APIs. Presence is not semantic correctness. */
export function materializeDeferredLease(): { lease: true } {
  return { lease: true };
}
export class FluxAccumulator {
  foldMonoid(): number {
    return 0;
  }
}
export type BrandedNonce = string & { readonly nonce: unique symbol };
export const quiescentClock = { now: () => 0 };

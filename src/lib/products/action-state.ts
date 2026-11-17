/**
 * Shared shape for product action results.
 *
 * This lives outside the "use server" action module because a server-action
 * file may only export async functions, not objects or constants.
 */
export type ProductActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string>;
  /**
   * The values the user submitted. React resets uncontrolled form fields after a
   * server action runs, so the form re-populates from these on validation errors
   * instead of silently discarding the user's input.
   */
  values?: Record<string, string>;
};

export const EMPTY_PRODUCT_STATE: ProductActionState = { ok: false, message: "" };

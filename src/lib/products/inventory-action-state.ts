/**
 * Shared shape for inventory action results.
 *
 * This lives outside the "use server" action module because a server-action
 * file may only export async functions, not objects or constants.
 */
export type InventoryActionState = {
  ok: boolean;
  message: string;
};

export const EMPTY_INVENTORY_STATE: InventoryActionState = { ok: false, message: "" };

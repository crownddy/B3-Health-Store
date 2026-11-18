/**
 * Shared shape for inventory action results.
 *
 * This lives outside the "use server" action module because a server-action
 * file may only export async functions, not objects or constants.
 */
export type InventoryActionState = {
  ok: boolean;
  message: string;
  /**
   * Set when a permanent delete was refused because batches or stock movements
   * exist, so the dialog can explain the block and offer archiving instead.
   */
  blocked?: boolean;
};

export const EMPTY_INVENTORY_STATE: InventoryActionState = { ok: false, message: "" };

import { requireAdmin } from "@/lib/auth";
import { getSellableProducts, type SellableProductRow } from "@/lib/data";
import { SectionCard } from "@/components/admin/ui";
import SoldForm from "@/components/admin/SoldForm";
import { SALE_PAGE_SIZE, clampPage } from "@/lib/products/sale";

export const dynamic = "force-dynamic";

function readString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

function readPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export default async function AdminSoldPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const params = await searchParams;

  const search = readString(params.q);
  const requestedPage = readPage(params.page);
  const selectedId = readString(params.product);

  let items: SellableProductRow[] = [];
  let total = 0;
  let error: string | null = null;
  try {
    const result = await getSellableProducts(search, requestedPage, SALE_PAGE_SIZE);
    items = result.items;
    total = result.total;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unable to load products.";
  }

  // Keep the page number valid for the result set (for example after a search
  // narrows the list), so the pager never points past the end.
  const page = clampPage(requestedPage, total, SALE_PAGE_SIZE);
  const selected = items.find((product) => product.id === selectedId) ?? null;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">SALES</p>
          <h1>Sold</h1>
          <p className="admin-page-sub">
            Record products sold. Each sale is a stock-out and deducts from the batch expiring
            soonest first (FEFO). Expired batches are never sold.
          </p>
        </div>
      </div>

      <SectionCard
        title="Record a sale"
        description={
          isSuperAdmin
            ? "Search for a product, choose it and enter how many were sold."
            : "Recording sales is reserved for Super Admins."
        }
      >
        {!isSuperAdmin ? (
          <p className="admin-alert admin-alert-warn" role="status">
            You are signed in as Staff. Ask a Super Admin to record this sale.
          </p>
        ) : error ? (
          <p className="admin-alert admin-alert-error" role="alert">
            {error}
          </p>
        ) : (
          <SoldForm
            items={items}
            total={total}
            page={page}
            search={search}
            selected={selected}
          />
        )}
      </SectionCard>
    </>
  );
}

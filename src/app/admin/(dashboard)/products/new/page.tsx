import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { getProducts } from "@/lib/data";
import { SectionCard } from "@/components/admin/ui";
import ProductForm from "@/components/admin/ProductForm";
import { collectCategories } from "@/lib/products/query";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  // Server-side gate: staff are redirected before this page renders.
  await requireSuperAdmin();
  const products = await getProducts();
  const categories = collectCategories(products);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">CATALOGUE</p>
          <h1>Add product</h1>
          <p className="admin-page-sub">
            Record the product, and optionally its opening stock as the first batch.
          </p>
        </div>
        <Link href="/admin/products" className="admin-link-quiet">
          ← Back to products
        </Link>
      </div>

      <SectionCard
        title="Product details"
        description="Only Super Admins can create products. Changes are validated on the server."
      >
        <ProductForm mode="create" categories={categories} />
      </SectionCard>
    </>
  );
}

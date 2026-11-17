import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { getProduct, getProducts } from "@/lib/data";
import { SectionCard } from "@/components/admin/ui";
import ProductForm from "@/components/admin/ProductForm";
import { collectCategories } from "@/lib/products/query";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  // Server-side gate: staff are redirected before this page renders.
  await requireSuperAdmin();
  const { id } = await params;

  const [product, products] = await Promise.all([getProduct(id), getProducts()]);
  if (!product) notFound();

  const categories = collectCategories(products);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">CATALOGUE</p>
          <h1>Edit product</h1>
          <p className="admin-page-sub">
            {product.name} · Stock ({product.quantity} on hand) is not editable here.
          </p>
        </div>
        <Link href={`/admin/products/${product.id}`} className="admin-link-quiet">
          ← Back to product
        </Link>
      </div>

      <SectionCard
        title="Product details"
        description="Changes are validated on the server and enforced by Row Level Security."
      >
        <ProductForm mode="edit" product={product} categories={categories} />
      </SectionCard>
    </>
  );
}

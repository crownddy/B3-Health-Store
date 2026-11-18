 "use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Product = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  selling_price: number;
  quantity: number;
  shelf_number: string | null;
  is_featured: boolean;
};

const demoProducts: Product[] = [
  { id: "demo-1", name: "B-Complex Vitamins", description: "A daily vitamin supplement.", category: "Vitamins", image_url: null, selling_price: 12500, quantity: 24, shelf_number: "A1", is_featured: true },
  { id: "demo-2", name: "Vitamin C", description: "Vitamin C supplement.", category: "Vitamins", image_url: null, selling_price: 8500, quantity: 18, shelf_number: "A2", is_featured: true },
  { id: "demo-3", name: "Daily Wellness", description: "Everyday wellness product.", category: "Wellness", image_url: null, selling_price: 9900, quantity: 12, shelf_number: "B1", is_featured: true },
  { id: "demo-4", name: "Herbal Care", description: "Herbal care product.", category: "Wellness", image_url: null, selling_price: 7200, quantity: 8, shelf_number: "B2", is_featured: false }
];

const money = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

export default function Home() {
  const [splash, setSplash] = useState(true);
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [selected, setSelected] = useState<Product | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .from("products")
        .select("id,name,description,category,image_url,selling_price,quantity,shelf_number,is_featured")
        .eq("is_visible_on_homepage", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!error && data && active) setProducts(data as Product[]);
      if (active) setLoading(false);
    }
    loadProducts();
    return () => { active = false; };
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map(p => p.category).filter(Boolean) as string[]))],
    [products]
  );
  const visibleProducts = products.filter(p =>
    (category === "All" || p.category === category) &&
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  if (splash) {
    return (
      <main className="splash">
        <div className="splash-glow" />
        <div className="splash-logo">
          <Image src="/b3-health-store-logo.jpg" alt="B3 Health Store — Your health, your wealth" width={720} height={720} priority />
        </div>
        <div className="loading-line"><span /></div>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="app-shell">
        <header className="topbar detail-topbar">
          <button className="back-button" onClick={() => setSelected(null)} aria-label="Back to products">←</button>
          <span className="topbar-title">Product details</span>
          <span className="round-icon">♡</span>
        </header>
        <section className="detail-view">
          <div className="detail-image">
            {selected.image_url ? <img src={selected.image_url} alt={selected.name} /> : <div className="product-placeholder large">B3</div>}
          </div>
          <div className="detail-card">
            <p className="eyebrow">{selected.category || "Health & wellness"}</p>
            <h1>{selected.name}</h1>
            <p className="description">{selected.description || "Product information will be updated soon."}</p>
            <div className="detail-meta">
              <span>Availability</span><strong>{selected.quantity > 0 ? "In stock" : "Out of stock"}</strong>
            </div>
            {selected.shelf_number && <div className="detail-meta"><span>Shelf number</span><strong>{selected.shelf_number}</strong></div>}
            <div className="price-row"><div><small>Price</small><strong>{money(selected.selling_price)}</strong></div><span className="stock-pill">{selected.quantity > 0 ? "Available" : "Unavailable"}</span></div>
            <button className="primary-button" disabled={selected.quantity <= 0}>Enquire about product</button>
            <p className="fine-print">Product availability and pricing may change. Please confirm before purchase.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mini">
          <Image src="/b3-health-store-logo.jpg" alt="B3 Health Store" width={54} height={54} />
          <div><strong>B3 Health Store</strong><small>Your health, your wealth</small></div>
        </div>
        <button className="round-icon" aria-label="Notifications">♧</button>
      </header>

      <section className="welcome">
        <p className="eyebrow">WELCOME TO B3 HEALTH STORE</p>
        <h1>Find what you need<br /><span>to feel your best.</span></h1>
        <p className="welcome-copy">Explore our health and wellness products.</p>
        <div className="search-row">
          <span>⌕</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search health products" aria-label="Search products" />
          <span className="search-filter">☷</span>
        </div>
      </section>

      <section className="promo">
        <div><span className="promo-tag">B3 HEALTH STORE</span><h2>Your wellness<br />starts here.</h2><p>Explore our featured products.</p></div>
        <div className="promo-mark">B3<span>+</span></div>
      </section>

      <section className="section-heading">
        <div><p className="eyebrow">DISCOVER</p><h2>Shop by category</h2></div>
      </section>
      <div className="category-row">
        {categories.map(c => <button key={c} onClick={() => setCategory(c)} className={`category-chip ${category === c ? "active" : ""}`}>{c}</button>)}
      </div>

      <section className="section-heading products-heading">
        <div><p className="eyebrow">HANDPICKED FOR YOU</p><h2>Popular products</h2></div>
        <span className="muted">{loading ? "Loading…" : `${visibleProducts.length} items`}</span>
      </section>
      <section className="product-grid">
        {visibleProducts.map(product => (
          <button className="product-card" key={product.id} onClick={() => setSelected(product)}>
            <div className="product-image">
              {product.image_url ? <img src={product.image_url} alt={product.name} /> : <div className="product-placeholder">B3</div>}
              {product.quantity <= 0 && <span className="sold-out">Out of stock</span>}
            </div>
            <div className="product-info">
              <span className="product-category">{product.category || "Health"}</span>
              <strong>{product.name}</strong>
              <div className="product-bottom"><b>{money(product.selling_price)}</b><small>{product.shelf_number ? `Shelf ${product.shelf_number}` : "View details"}</small></div>
            </div>
          </button>
        ))}
        {!visibleProducts.length && <div className="empty-state">No products match your search.</div>}
      </section>
      <footer className="bottom-nav">
        <button className="nav-active"><span>⌂</span>Home</button>
        <button onClick={() => document.querySelector<HTMLInputElement>(".search-row input")?.focus()}><span>⌕</span>Search</button>
        <button onClick={() => setCategory("All")}><span>▦</span>Categories</button>
        <a href="/admin/login"><span>♙</span>Admin</a>
      </footer>
    </main>
  );
}

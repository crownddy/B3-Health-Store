"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  superAdminOnly?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: "▦" },
  { href: "/admin/products", label: "Products", icon: "▤" },
  { href: "/admin/inventory", label: "Inventory", icon: "▥" },
  { href: "/admin/stock", label: "Stock In / Out", icon: "⇄" },
  { href: "/admin/sold", label: "Sold", icon: "🧾" },
  { href: "/admin/expiry", label: "Expiry Management", icon: "⏱" },
  { href: "/admin/staff", label: "Staff Management", icon: "☺", superAdminOnly: true },
  { href: "/admin/reports", label: "Reports", icon: "▨" },
  { href: "/admin/settings", label: "Settings", icon: "⚙", superAdminOnly: true }
];

export default function AdminNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visible = ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <>
      <button
        type="button"
        className="admin-nav-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="admin-nav"
      >
        <span aria-hidden="true">☰</span> Menu
      </button>

      <nav
        id="admin-nav"
        className={`admin-nav ${open ? "admin-nav-open" : ""}`}
        aria-label="Admin sections"
      >
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-item ${isActive(item.href) ? "admin-nav-active" : ""}`}
            onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

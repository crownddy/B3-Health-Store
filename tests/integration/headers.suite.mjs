#!/usr/bin/env node
/**
 * Browser suite for fixed headers.
 *
 * Every header must stay at the top of the viewport while the page scrolls:
 * the storefront brand bar and product-detail bar (with the back button), and
 * the admin console's brand/menu row and user bar. The bug this guards against
 * is `overflow: hidden` on html/body (and on the storefront shell), which turns
 * the element into a scroll container and silently stops `position: sticky`
 * from working — the headers scrolled away with the content.
 *
 * Checks, on mobile and desktop:
 *   - each header stays at the viewport top while a long page scrolls;
 *   - the pinned headers do not overlap or leave a gap between them;
 *   - the back button stays visible and works;
 *   - the hamburger menu opens fully on screen (not clipped by the header);
 *   - no horizontal page overflow;
 *   - the delete dialog renders above the headers.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 * Usage: npm run test:integration:headers
 */
import { chromium } from "playwright";
import { resolveConfig } from "./scripts/env.mjs";

const config = resolveConfig();

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, condition, extra = "") {
  if (condition) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${extra ? ` :: ${extra}` : ""}`);
    fail++;
    failures.push(name);
  }
}

async function login(page, account = config.superAdmin) {
  await page.goto(`${config.appUrl}/admin/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', account.email);
  await page.fill('input[type="password"]', account.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

/** Scrolls to a depth and returns the header's viewport-relative top. */
async function scrollAndMeasure(page, selector, depth = 1500) {
  await page.evaluate((y) => window.scrollTo(0, y), depth);
  await page.waitForTimeout(250);
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { top: null, scrollY: Math.round(window.scrollY) };
    return { top: Math.round(el.getBoundingClientRect().top), scrollY: Math.round(window.scrollY) };
  }, selector);
}

const browser = await chromium.launch();

try {
  for (const vp of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 }
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    console.log(`\n### ${vp.name} ${vp.width}x${vp.height}`);

    // --- Admin user bar stays pinned --------------------------------------
    await login(page);
    for (const path of ["/admin", "/admin/inventory", "/admin/products"]) {
      await page.goto(`${config.appUrl}${path}`, { waitUntil: "networkidle" });
      // On mobile the user bar pins directly beneath the pinned brand/menu row,
      // so its resting top is that row's height; on desktop it pins at 0.
      const expectedTop = await page.evaluate(() =>
        window.matchMedia("(max-width: 860px)").matches
          ? Math.round(document.querySelector(".admin-sidebar").getBoundingClientRect().height)
          : 0
      );
      const after = await scrollAndMeasure(page, ".admin-topbar");
      ok(
        `${vp.name}: admin topbar stays fixed on ${path}`,
        after.scrollY > 0 && after.top === expectedTop,
        `scrollY=${after.scrollY} top=${after.top} expected=${expectedTop}`
      );
    }

    // --- Mobile: brand/menu row pinned, stacked above the user bar ---------
    if (vp.name === "mobile") {
      await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
      const stacked = await page.evaluate(() => {
        window.scrollTo(0, 1200);
        const sb = document.querySelector(".admin-sidebar").getBoundingClientRect();
        const tb = document.querySelector(".admin-topbar").getBoundingClientRect();
        return { scrollY: Math.round(window.scrollY), sidebarTop: Math.round(sb.top), gap: Math.round(tb.top - sb.bottom) };
      });
      ok("mobile: brand/menu row stays fixed", stacked.scrollY > 0 && stacked.sidebarTop === 0, JSON.stringify(stacked));
      ok("mobile: no gap between the two pinned headers", Math.abs(stacked.gap) <= 1, `gap=${stacked.gap}`);

      // The hamburger opens fully on screen while scrolled.
      await page.click(".admin-nav-toggle");
      await page.waitForTimeout(250);
      const menu = await page.evaluate(() => {
        const nav = document.querySelector(".admin-nav");
        const r = nav.getBoundingClientRect();
        const first = nav.querySelector("a").getBoundingClientRect();
        return {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          firstItemTop: Math.round(first.top),
          vh: window.innerHeight,
          expanded: document.querySelector(".admin-nav-toggle").getAttribute("aria-expanded")
        };
      });
      ok("mobile: hamburger reports expanded", menu.expanded === "true");
      ok(
        "mobile: menu is fully on screen (not clipped by the header)",
        menu.top >= 0 && menu.bottom <= menu.vh + 1,
        JSON.stringify(menu)
      );
      ok("mobile: first menu item is below the pinned header", menu.firstItemTop >= 150, `firstItemTop=${menu.firstItemTop}`);
      // A menu link still navigates.
      await page.click('.admin-nav a:has-text("Overview")');
      await page.waitForURL("**/admin", { timeout: 15000 });
      ok("mobile: menu link navigates", page.url().endsWith("/admin"));
    }

    // --- Storefront brand bar stays pinned ---------------------------------
    await page.goto(`${config.appUrl}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".topbar", { timeout: 15000 });
    const storeTop = await scrollAndMeasure(page, ".topbar", 800);
    ok(
      `${vp.name}: storefront header stays fixed`,
      storeTop.scrollY > 0 && storeTop.top === 0,
      `scrollY=${storeTop.scrollY} top=${storeTop.top}`
    );

    // --- Storefront detail header (back button) stays pinned and works -----
    await page.locator(".product-card").first().click();
    await page.waitForSelector(".detail-topbar");
    const detailTop = await scrollAndMeasure(page, ".detail-topbar", 900);
    ok(
      `${vp.name}: detail header with back button stays fixed`,
      detailTop.scrollY > 0 && detailTop.top === 0,
      `scrollY=${detailTop.scrollY} top=${detailTop.top}`
    );
    const backVisible = await page.evaluate(() => {
      const b = document.querySelector(".back-button").getBoundingClientRect();
      return b.top >= 0 && b.bottom <= window.innerHeight && b.width > 0;
    });
    ok(`${vp.name}: back button is visible while scrolled`, backVisible);
    await page.click(".back-button");
    await page.waitForSelector(".product-grid");
    ok(`${vp.name}: back button returns to the product list`, (await page.locator(".product-grid").count()) > 0);

    // --- No horizontal overflow on any admin page --------------------------
    await context.clearCookies();
    await login(page);
    for (const path of ["/admin", "/admin/inventory", "/admin/products", "/admin/stock", "/admin/sold", "/admin/expiry", "/admin/reports", "/admin/settings"]) {
      await page.goto(`${config.appUrl}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      ok(`${vp.name}: no horizontal overflow on ${path}`, overflow <= 1, `overflow=${overflow}`);
    }

    await context.close();
  }

  // --- The delete dialog renders above the pinned headers ------------------
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page);
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  const del = page.locator('button:has-text("Delete")').first();
  if (await del.count()) {
    await page.evaluate(() => window.scrollTo(0, 900));
    await del.click();
    await page.waitForSelector(".admin-modal", { timeout: 8000 });
    const modal = await page.evaluate(() => {
      const el = document.querySelector(".admin-modal");
      const r = el.getBoundingClientRect();
      const onTop = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
      const sidebarZ = parseInt(getComputedStyle(document.querySelector(".admin-sidebar")).zIndex, 10);
      return { covered: el.contains(onTop), backdropZ: parseInt(getComputedStyle(document.querySelector(".admin-modal-backdrop")).zIndex, 10), sidebarZ };
    });
    ok("dialog renders above the pinned header", modal.covered && modal.backdropZ > modal.sidebarZ, JSON.stringify(modal));
  } else {
    ok("dialog: a product with a delete action exists", false, "no delete button found");
  }
  await context.close();
} finally {
  await browser.close();
}

console.log(`\n=== Fixed headers: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}

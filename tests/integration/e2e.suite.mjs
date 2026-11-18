#!/usr/bin/env node
/**
 * Browser E2E suite for product management.
 *
 * Drives a real Chromium against a real production build of the app, talking to
 * the local integration stack. Covers create, validation value-preservation,
 * edit, search, filter, archive/restore, delete, image upload, delete-blocking
 * and staff read-only access.
 *
 * Local targets only — scripts/env.mjs refuses to run against anything else.
 * The app itself is started separately (see tests/integration/README.md).
 *
 * Usage: node tests/integration/e2e.suite.mjs
 */
import { chromium } from "playwright";
import { resolveConfig } from "./scripts/env.mjs";
import { psql } from "./scripts/db.mjs";

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

async function login(page, account) {
  await page.goto(`${config.appUrl}/admin/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', account.email);
  await page.fill('input[type="password"]', account.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

const acceptNextDialog = (page) => page.once("dialog", (dialog) => dialog.accept());

/** A `YYYY-MM-DD` date offset from today, so expiry tests are date-independent. */
function daysFromNow(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Removes rows this suite creates, so it can be re-run without a fresh stack. */
function cleanup() {
  // Products are identified by name: SKU and barcode are no longer entered
  // through the admin UI.
  const names = `(
    'Zinc E2E 50mg', 'Zinc E2E 50mg (updated)', 'Image Test Product',
    'FEFO Milk E2E', 'No Stock E2E', 'Sold E2E Product',
    'Inv Valid E2E', 'Inv Nodate E2E', 'Inv Expired E2E',
    'Inv Keep E2E', 'Inv Delete E2E'
  )`;
  const products = `select id from public.products where name in ${names} or name like 'Page E2E%'`;
  // Movements and batches reference products with ON DELETE RESTRICT, so they
  // must go first (in that order) before the products themselves.
  psql(`delete from public.stock_movements where product_id in (${products})`);
  psql(`delete from public.product_batches where product_id in (${products})`);
  psql(`delete from public.products where name in ${names} or name like 'Page E2E%'`);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error));

cleanup();

try {
  // --- 1. Super admin login ------------------------------------------------
  await login(page, config.superAdmin);
  ok("super admin login reaches /admin", page.url().includes("/admin"));

  // --- 2. Create -----------------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "Zinc E2E 50mg");
  await page.fill('input[name="category"]', "Minerals");
  await page.fill('textarea[name="description"]', "E2E created product");
  await page.fill('input[name="selling_price"]', "2500");
  await page.fill('input[name="shelf_number"]', "D1");
  await page.check('input[name="is_visible_on_homepage"]');
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
  const productId = page.url().split("/admin/products/")[1].split("?")[0];
  let body = await page.innerText("body");
  ok("create: success banner", body.includes("Product created."));
  ok("create: name shown", body.includes("Zinc E2E 50mg"));
  ok("create: selling price shown", body.includes("2,500"));
  ok("create: marked published", body.includes("Published"));
  ok("create: quantity starts at 0", psql(`select quantity from public.products where id='${productId}'`) === "0");
  ok("create: the removed fields are not on the form", (await page.locator('input[name="sku"], input[name="barcode"], input[name="purchase_price"], input[name="minimum_stock"]').count()) === 0);

  // --- 3. Validation preserves submitted values ----------------------------
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "  ");
  await page.fill('input[name="selling_price"]', "111");
  await page.fill('textarea[name="description"]', "keep me");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".admin-alert-error", { timeout: 20000 });
  ok("validation: missing name rejected", (await page.innerText("body")).toLowerCase().includes("name is required"));
  ok("validation: selling price preserved", (await page.inputValue('input[name="selling_price"]')) === "111");
  ok("validation: description preserved", (await page.inputValue('textarea[name="description"]')) === "keep me");

  // --- 4. Edit -------------------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/${productId}/edit`, { waitUntil: "networkidle" });
  ok("edit: form pre-filled", (await page.inputValue('input[name="name"]')) === "Zinc E2E 50mg");
  await page.fill('input[name="name"]', "Zinc E2E 50mg (updated)");
  await page.fill('input[name="selling_price"]', "2900");
  await page.click('button[type="submit"]');
  await page.waitForURL("**?updated=1", { timeout: 20000 });
  body = await page.innerText("body");
  ok("edit: name updated", body.includes("Zinc E2E 50mg (updated)"));
  ok("edit: price updated", body.includes("2,900"));
  ok("edit: quantity untouched by editing", psql(`select quantity from public.products where id='${productId}'`) === "0");

  // --- 5. Search and filter ------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products?q=Zinc+E2E`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("search: finds the product", body.includes("Zinc E2E 50mg (updated)"));
  ok("search: excludes other products", !body.includes("Herbal Tea Blend"));
  await page.goto(`${config.appUrl}/admin/products?status=archived`, { waitUntil: "networkidle" });
  ok("filter: archived excludes active product", !(await page.innerText("body")).includes("Zinc E2E 50mg (updated)"));

  // --- 6. Archive ----------------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/${productId}`, { waitUntil: "networkidle" });
  acceptNextDialog(page);
  await page.click('button:has-text("Archive product")');
  await page.waitForTimeout(2500);
  body = await page.innerText("body");
  ok("archive: shows archived state", body.includes("Archived"));
  ok("archive: restore button appears", body.includes("Restore product"));
  ok("archive: hidden from storefront in the database", psql(`select is_visible_on_homepage from public.products where id='${productId}'`) === "f");
  await page.goto(`${config.appUrl}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  ok("archive: hidden from the storefront", !(await page.innerText("body")).includes("Zinc E2E"));

  // --- 7. Restore ----------------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/${productId}`, { waitUntil: "networkidle" });
  acceptNextDialog(page);
  await page.click('button:has-text("Restore product")');
  await page.waitForTimeout(2500);
  body = await page.innerText("body");
  ok("restore: active again", body.includes("Active") && !body.includes("Restore product"));

  // --- 8. Delete (no history) ----------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/${productId}`, { waitUntil: "networkidle" });
  acceptNextDialog(page);
  await page.click('button:has-text("Delete permanently")');
  await page.waitForURL("**/admin/products?deleted=1", { timeout: 20000 });
  body = await page.innerText("body");
  ok("delete: success banner", body.includes("Product deleted."));
  ok("delete: gone from the catalogue", !body.includes("Zinc E2E"));

  // --- 9. Image upload -----------------------------------------------------
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "Image Test Product");
  await page.fill('input[name="selling_price"]', "200");
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
    "hex"
  );
  await page.setInputFiles('input[type="file"]', { name: "tiny.png", mimeType: "image/png", buffer: png });
  await page.waitForTimeout(3000);
  const imageUrl = await page.inputValue('input[name="image_url"]');
  ok("image: url set", imageUrl.startsWith("http") && imageUrl.includes("product-images"));
  ok("image: preview shown", (await page.locator(".admin-image-preview img").count()) === 1);
  await page.setInputFiles('input[type="file"]', { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
  await page.waitForTimeout(1500);
  ok("image: rejects a non-image type", (await page.innerText("body")).includes("JPEG, PNG, WebP or GIF"));
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
  const imageProductId = page.url().split("/admin/products/")[1].split("?")[0];
  ok("image: product created with an image", (await page.innerText("body")).includes("Image Test Product"));

  // --- 10. Delete blocked when history exists ------------------------------
  psql(`insert into public.stock_movements (product_id, movement_type, quantity, note) values ('${imageProductId}','stock_in',5,'e2e suite')`);
  await page.goto(`${config.appUrl}/admin/products/${imageProductId}`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("delete-blocked: button hidden with history", (await page.locator('button:has-text("Delete permanently")').count()) === 0);
  ok("delete-blocked: reason shown", body.toLowerCase().includes("history"));
  ok("delete-blocked: archive still offered", body.includes("Archive product") || body.includes("Restore product"));

  // --- 11. Initial stock on product creation ------------------------------
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "FEFO Milk E2E");
  await page.fill('input[name="selling_price"]', "200");
  await page.fill('input[name="initial_quantity"]', "10");
  await page.fill('input[name="initial_expiration_date"]', daysFromNow(90));
  await page.fill('input[name="initial_batch_number"]', "MILK-A");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
  const fefoProductId = page.url().split("/admin/products/")[1].split("?")[0];
  body = await page.innerText("body");
  ok("initial stock: quantity recorded", psql(`select quantity from public.products where id='${fefoProductId}'`) === "10");
  ok("initial stock: batch created", psql(`select count(*) from public.product_batches where product_id='${fefoProductId}'`) === "1");
  ok(
    "initial stock: batch has the expiry date",
    psql(`select expiration_date from public.product_batches where product_id='${fefoProductId}'`) === daysFromNow(90)
  );
  ok(
    "initial stock: opening movement recorded",
    psql(`select count(*) from public.stock_movements where product_id='${fefoProductId}' and movement_type='stock_in'`) === "1"
  );
  // 90 days is inside the four-month warning window, so the batch reads as
  // "Expiring soon" rather than "Valid".
  ok(
    "initial stock: batch shown on the detail page",
    body.includes("MILK-A") && body.includes("Expiring soon")
  );

  // --- 12. Create without initial stock ------------------------------------
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "No Stock E2E");
  await page.fill('input[name="selling_price"]', "500");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
  const noStockId = page.url().split("/admin/products/")[1].split("?")[0];
  ok("no initial stock: quantity stays 0", psql(`select quantity from public.products where id='${noStockId}'`) === "0");
  ok("no initial stock: no batch created", psql(`select count(*) from public.product_batches where product_id='${noStockId}'`) === "0");

  // --- 13. Multiple batches with different expirations ---------------------
  async function receiveStock(productId, quantity, expiration, batchNumber) {
    await page.goto(`${config.appUrl}/admin/stock`, { waitUntil: "networkidle" });
    await page.selectOption('select[name="product_id"]', productId);
    await page.selectOption('select[name="movement_type"]', "stock_in");
    await page.fill('input[name="quantity"]', String(quantity));
    if (expiration) await page.fill('input[name="expiration_date"]', expiration);
    if (batchNumber) await page.fill('input[name="batch_number"]', batchNumber);
    await page.fill('input[name="note"]', "e2e fefo");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".admin-alert-ok", { timeout: 20000 });
  }

  // MILK-B expires soon (10 days), MILK-C is valid far out (200 days).
  await receiveStock(fefoProductId, 5, daysFromNow(10), "MILK-B");
  await receiveStock(fefoProductId, 5, daysFromNow(200), "MILK-C");
  ok("multi-batch: three batches exist", psql(`select count(*) from public.product_batches where product_id='${fefoProductId}'`) === "3");
  ok("multi-batch: quantities tracked per batch", psql(`select quantity_remaining from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-B'`) === "5");
  ok("multi-batch: total on hand is 20", psql(`select quantity from public.products where id='${fefoProductId}'`) === "20");

  // Receiving the same number with a different expiry must not overwrite.
  await receiveStock(fefoProductId, 2, daysFromNow(400), "MILK-B");
  ok("multi-batch: different expiry keeps a separate batch", psql(`select count(*) from public.product_batches where product_id='${fefoProductId}'`) === "4");
  ok(
    "multi-batch: original batch expiry untouched",
    psql(`select expiration_date from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-B' and expiration_date='${daysFromNow(10)}'`) === daysFromNow(10)
  );

  // --- 14. Generated batch number when none is supplied --------------------
  // Expires in 2 days, so it is the earliest sellable batch.
  await receiveStock(fefoProductId, 3, daysFromNow(2), "");
  const autoBatchNumber = psql(
    `select batch_number from public.product_batches where product_id='${fefoProductId}' and expiration_date='${daysFromNow(2)}'`
  );
  ok("auto batch number: a B3- date-stamped number is generated", autoBatchNumber.startsWith("B3-"));

  // --- 15. FEFO stock out across multiple batches --------------------------
  // Earliest valid expiry is the auto-generated batch (2 days, 3 units), then
  // MILK-B (10 days, 5 units). Selling 5 must empty the first and take 2 from
  // MILK-B.
  await page.goto(`${config.appUrl}/admin/stock`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="product_id"]', fefoProductId);
  await page.selectOption('select[name="movement_type"]', "stock_out");
  await page.fill('input[name="quantity"]', "5");
  await page.fill('input[name="note"]', "e2e fefo");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".admin-alert-ok", { timeout: 20000 });
  ok(
    "fefo: earliest batch emptied first",
    psql(`select quantity_remaining from public.product_batches where product_id='${fefoProductId}' and expiration_date='${daysFromNow(2)}'`) === "0"
  );
  ok(
    "fefo: remainder taken from the next batch",
    psql(`select quantity_remaining from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-B' and expiration_date='${daysFromNow(10)}'`) === "3"
  );
  ok(
    "fefo: later batch untouched",
    psql(`select quantity_remaining from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-C'`) === "5"
  );
  ok(
    "fefo: two stock-out movements recorded (history preserved)",
    psql(`select count(*) from public.stock_movements where product_id='${fefoProductId}' and movement_type='stock_out' and note='e2e fefo'`) === "2"
  );
  ok("fefo: product quantity reduced", psql(`select quantity from public.products where id='${fefoProductId}'`) === "20");

  // --- 16. Expired batches are not sold ------------------------------------
  // Insert an expired batch directly. It must never be picked for FEFO, so
  // asking for more than the sellable quantity is refused.
  psql(
    `insert into public.product_batches (product_id, batch_number, quantity_received, quantity_remaining, expiration_date)
     values ('${fefoProductId}', 'MILK-OLD', 50, 50, '${daysFromNow(-10)}')`
  );
  await page.goto(`${config.appUrl}/admin/stock`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="product_id"]', fefoProductId);
  await page.selectOption('select[name="movement_type"]', "stock_out");
  await page.fill('input[name="quantity"]', "50");
  await page.fill('input[name="note"]', "e2e fefo");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".admin-alert-error", { timeout: 20000 });
  ok("fefo: selling only from expired stock is refused", (await page.innerText("body")).includes("Only"));
  ok(
    "fefo: expired batch quantity is unchanged",
    psql(`select quantity_remaining from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-OLD'`) === "50"
  );
  psql(`delete from public.product_batches where product_id='${fefoProductId}' and batch_number='MILK-OLD'`);

  // --- 17. Expiry classification and filter on the inventory page ----------
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory: shows every batch", body.includes("MILK-A") && body.includes("MILK-C"));
  ok("inventory: expiring-soon batches labelled", body.includes("Expiring soon"));
  await page.goto(`${config.appUrl}/admin/inventory?expiry=valid`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory filter: valid keeps a far-out batch", body.includes("MILK-C"));
  ok("inventory filter: valid hides the expiring-soon batch", !body.includes(autoBatchNumber));

  // --- 17b. Sold screen: search, select, FEFO deduction, validation --------
  // Create a fresh product with two batches: a near expiry (soonest) and a far
  // one. Selling must empty the near batch first, then take from the far one.
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', "Sold E2E Product");
  await page.fill('input[name="selling_price"]', "300");
  await page.fill('input[name="initial_quantity"]', "3");
  await page.fill('input[name="initial_expiration_date"]', daysFromNow(5));
  await page.fill('input[name="initial_batch_number"]', "SOLD-NEAR");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
  const soldId = page.url().split("/admin/products/")[1].split("?")[0];
  await receiveStock(soldId, 4, daysFromNow(120), "SOLD-FAR");

  // The Sold menu item exists and links to the page.
  await page.goto(`${config.appUrl}/admin/sold`, { waitUntil: "networkidle" });
  ok("sold: page loads", (await page.innerText("body")).includes("Record a sale"));
  ok("sold: menu item present", (await page.locator('a.admin-nav-item:has-text("Sold")').count()) === 1);

  // Search narrows the list to the product we just created.
  await page.fill('input[type="search"]', "Sold E2E");
  await page.waitForTimeout(1200);
  body = await page.innerText("body");
  ok("sold: search finds the product", body.includes("Sold E2E Product"));
  ok("sold: search shows the available quantity", body.includes("7 available"));
  ok("sold: search hides unrelated products", !body.includes("FEFO Milk E2E"));

  // Select the product; the sale form appears with the current quantity.
  await page.click('button.admin-sale-item:has-text("Sold E2E Product")');
  await page.waitForSelector(".admin-sale-panel", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  body = await page.innerText("body");
  ok("sold: selection is shown", /selected product/i.test(body) && body.includes("7 units available"));

  // A quantity larger than the available stock is refused client-side.
  await page.fill('input[name="quantity"]', "99");
  await page.click('button:has-text("Confirm Sale")');
  await page.waitForTimeout(600);
  ok("sold: over-quantity refused", (await page.innerText("body")).includes("Only 7 units in stock"));
  ok("sold: nothing deducted on refusal", psql(`select quantity from public.products where id='${soldId}'`) === "7");

  // Selling 5 spans both batches: 3 from the near batch, 2 from the far one.
  await page.fill('input[name="quantity"]', "5");
  await page.click('button:has-text("Confirm Sale")');
  await page.waitForSelector(".admin-alert-ok", { timeout: 20000 });
  ok("sold: success message", (await page.innerText("body")).includes("Sale recorded"));
  ok(
    "sold: FEFO emptied the earliest batch",
    psql(`select quantity_remaining from public.product_batches where product_id='${soldId}' and batch_number='SOLD-NEAR'`) === "0"
  );
  ok(
    "sold: remainder taken from the next batch",
    psql(`select quantity_remaining from public.product_batches where product_id='${soldId}' and batch_number='SOLD-FAR'`) === "2"
  );
  ok("sold: product total reduced", psql(`select quantity from public.products where id='${soldId}'`) === "2");
  ok(
    "sold: two stock-out movements recorded",
    psql(`select count(*) from public.stock_movements where product_id='${soldId}' and movement_type='stock_out'`) === "2"
  );
  ok(
    "sold: the sale is a stock-out, not a new mechanism",
    psql(`select count(*) from public.stock_movements where product_id='${soldId}' and movement_type='stock_out' and note='Sale'`) === "2"
  );

  // --- 17c. Inventory list: thumbnails, search, expiry, pagination ---------
  // A product with a far-out expiry (valid) and a product with no expiry date,
  // both with an opening batch, plus a dedicated product with stock history for
  // the delete-block path.
  async function createWithStock(name, quantity, expiration, batchNumber) {
    await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="selling_price"]', "100");
    // Quantity is only filled when positive: the field's min is 1, so 0 would
    // trip native form validation. Blank means "create with no batch".
    if (quantity > 0) await page.fill('input[name="initial_quantity"]', String(quantity));
    if (expiration) await page.fill('input[name="initial_expiration_date"]', expiration);
    if (batchNumber) await page.fill('input[name="initial_batch_number"]', batchNumber);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin/products/*?created=1", { timeout: 20000 });
    return page.url().split("/admin/products/")[1].split("?")[0];
  }

  const validId = await createWithStock("Inv Valid E2E", 7, daysFromNow(300), "INV-VALID");
  const nodateId = await createWithStock("Inv Nodate E2E", 4, "", "INV-NODATE");

  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory: product list shows the product", body.includes("Inv Valid E2E"));
  ok("inventory: shows available quantity", body.includes("7"));
  ok("inventory: shows a placeholder thumbnail without an image", (await page.locator(".admin-thumb-placeholder").count()) >= 1);
  ok("inventory: shows expiration status", /Valid|No date/.test(body));
  ok("inventory: has a View details action", (await page.locator('a:has-text("View details")').count()) >= 1);

  // Search by name narrows the list.
  await page.goto(`${config.appUrl}/admin/inventory?q=Inv+Valid+E2E`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory search: finds the product", body.includes("Inv Valid E2E"));
  ok("inventory search: hides unrelated products", !body.includes("No Stock E2E"));

  // Empty state when nothing matches.
  await page.goto(`${config.appUrl}/admin/inventory?q=zzz-no-match-zzz`, { waitUntil: "networkidle" });
  ok("inventory search: empty state", (await page.innerText("body")).includes("No products match your filters"));

  // Expiry filter.
  await page.goto(`${config.appUrl}/admin/inventory?expiry=no_date`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory filter: no_date keeps the undated product", body.includes("Inv Nodate E2E"));
  ok("inventory filter: no_date hides the valid product", !body.includes("Inv Valid E2E"));

  // Pagination: create enough matching products to spill past one page.
  for (let i = 1; i <= 11; i++) {
    await createWithStock(`Page E2E ${String(i).padStart(2, "0")}`, 1, daysFromNow(200), `PAGE-${i}`);
  }
  await page.goto(`${config.appUrl}/admin/inventory?q=Page+E2E`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory pagination: first page shown", body.includes("Page 1 of 2"));
  ok("inventory pagination: page has a previous/next control", (await page.locator('button:has-text("Next →")').count()) === 1);
  ok("inventory pagination: shows the filtered total", body.includes("11 products"));
  await page.goto(`${config.appUrl}/admin/inventory?q=Page+E2E&page=1`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("inventory pagination: second page shown", body.includes("Page 2 of 2"));
  ok("inventory pagination: later products appear", body.includes("Page E2E 11"));

  // --- 17d. Inventory product details --------------------------------------
  await page.goto(`${config.appUrl}/admin/inventory/${validId}`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("details: shows the product name", body.includes("Inv Valid E2E"));
  ok("details: shows available quantity", /available quantity/i.test(body));
  ok("details: shows the batch number", body.includes("INV-VALID"));
  ok("details: shows the expiration status", body.includes("Valid"));
  ok("details: shows movement history section", body.includes("Stock movement history"));
  ok("details: shows a clean image placeholder when there is no image", (await page.locator(".admin-detail-placeholder").count()) === 1);
  ok("details: has a way back to inventory", (await page.locator('a:has-text("Back to inventory")').count()) === 1);

  // A product with an image shows it on the details page.
  await page.goto(`${config.appUrl}/admin/inventory/${imageProductId}`, { waitUntil: "networkidle" });
  ok("details: shows the product image when one exists", (await page.locator(".admin-detail-image img").count()) === 1);

  // Editing a batch's expiry changes only the date, never the quantity.
  await page.goto(`${config.appUrl}/admin/inventory/${validId}`, { waitUntil: "networkidle" });
  await page.fill('.admin-expiry-editor input[type="date"]', daysFromNow(365));
  await page.click('.admin-expiry-editor button[type="submit"]');
  await page.waitForSelector(".admin-expiry-editor .admin-inline-ok", { timeout: 20000 });
  ok(
    "details: batch expiry updated",
    psql(`select expiration_date from public.product_batches where product_id='${validId}'`) === daysFromNow(365)
  );
  ok(
    "details: editing expiry did not change the batch quantity",
    psql(`select quantity_remaining from public.product_batches where product_id='${validId}'`) === "7"
  );
  ok(
    "details: editing expiry did not change the product quantity",
    psql(`select quantity from public.products where id='${validId}'`) === "7"
  );

  // --- 17e. Delete from the inventory list ---------------------------------
  // A product with no history can be deleted, after a confirmation dialog.
  const deletableId = await createWithStock("Inv Delete E2E", 0, "", "");
  await page.goto(`${config.appUrl}/admin/inventory?q=Inv+Delete+E2E`, { waitUntil: "networkidle" });
  await page.click('button.admin-button-danger:has-text("Delete")');
  await page.waitForSelector(".admin-modal", { timeout: 20000 });
  body = await page.innerText("body");
  ok("delete: confirmation dialog names the product", body.includes("Inv Delete E2E"));
  ok(
    "delete: confirm button disabled until the name is typed",
    await page.locator('.admin-modal button:has-text("Delete permanently")').isDisabled()
  );
  await page.fill(".admin-modal-input", "Inv Delete E2E");
  await page.click('.admin-modal button:has-text("Delete permanently")');
  await page.waitForURL("**/admin/inventory?deleted=1", { timeout: 20000 });
  ok("delete: product removed", psql(`select count(*) from public.products where id='${deletableId}'`) === "0");

  // A product with history cannot be deleted; the dialog explains and offers
  // archiving, and the history survives.
  const keepId = await createWithStock("Inv Keep E2E", 3, daysFromNow(300), "INV-KEEP");
  await page.goto(`${config.appUrl}/admin/inventory?q=Inv+Keep+E2E`, { waitUntil: "networkidle" });
  await page.click('button.admin-button-danger:has-text("Delete")');
  await page.waitForSelector(".admin-modal", { timeout: 20000 });
  await page.fill(".admin-modal-input", "Inv Keep E2E");
  await page.click('.admin-modal button:has-text("Delete permanently")');
  await page.waitForSelector(".admin-modal .admin-alert-error", { timeout: 20000 });
  body = await page.innerText("body");
  ok("delete-blocked: explains the history block", /history|batch|movement/i.test(body));
  ok("delete-blocked: offers archiving", (await page.locator('.admin-modal button:has-text("Archive product")').count()) === 1);
  ok("delete-blocked: product still present", psql(`select count(*) from public.products where id='${keepId}'`) === "1");
  ok("delete-blocked: batch history intact", psql(`select count(*) from public.product_batches where product_id='${keepId}'`) === "1");
  ok("delete-blocked: movement history intact", psql(`select count(*) from public.stock_movements where product_id='${keepId}'`) === "1");

  // Archiving from the same dialog works and keeps the history. A successful
  // archive closes the dialog, so wait for it to disappear, then check the DB.
  await page.click('.admin-modal button:has-text("Archive product")');
  await page.waitForSelector(".admin-modal", { state: "hidden", timeout: 20000 });
  ok("archive: product archived", psql(`select status from public.products where id='${keepId}'`) === "archived");
  ok("archive: movement history preserved", psql(`select count(*) from public.stock_movements where product_id='${keepId}'`) === "1");

  // --- 17f. Mobile: 16px inputs so iOS does not zoom on focus --------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  const searchFont = await page
    .locator('input[type="search"]')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  ok("mobile: search input font is at least 16px", searchFont >= 16, `got ${searchFont}`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok("mobile: no horizontal page overflow", overflow <= 1, `overflow ${overflow}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  const desktopFont = await page
    .locator('input[type="search"]')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  ok("desktop: search input keeps the 14px design size", desktopFont === 14, `got ${desktopFont}`);

  // --- 18. Staff are read-only --------------------------------------------
  await context.clearCookies();
  await login(page, config.staff);
  await page.goto(`${config.appUrl}/admin/products`, { waitUntil: "networkidle" });
  ok("staff: no add-product button", (await page.locator('a:has-text("+ Add product")').count()) === 0);
  await page.goto(`${config.appUrl}/admin/products/new`, { waitUntil: "networkidle" });
  ok("staff: cannot open the create form", !(await page.innerText("body")).includes("Create product"));
  await page.goto(`${config.appUrl}/admin/products/${imageProductId}`, { waitUntil: "networkidle" });
  ok("staff: no lifecycle actions on the detail page", (await page.locator('button:has-text("Archive product")').count()) === 0);
  await page.goto(`${config.appUrl}/admin/inventory`, { waitUntil: "networkidle" });
  ok("staff: can view batches", (await page.innerText("body")).includes("MILK-A"));
  await page.goto(`${config.appUrl}/admin/stock`, { waitUntil: "networkidle" });
  ok("staff: stock form is withheld", (await page.innerText("body")).includes("reserved for Super Admins"));
  await page.goto(`${config.appUrl}/admin/sold`, { waitUntil: "networkidle" });
  body = await page.innerText("body");
  ok("staff: sold page opens", body.includes("Record a sale"));
  ok("staff: sale recording is withheld", body.includes("reserved for Super Admins"));
  ok("staff: no confirm sale button", (await page.locator('button:has-text("Confirm Sale")').count()) === 0);
} finally {
  await browser.close();
  cleanup();
}

console.log(`\n=== E2E: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(", ")}`);
  process.exit(1);
}

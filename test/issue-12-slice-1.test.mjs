import assert from "node:assert/strict";
import test from "node:test";

import monitorConfig from "../config/monitors.json" with { type: "json" };
import scarossoSnapshot from "../public/deals/scarosso-latest.json" with { type: "json" };
import vintedSnapshot from "../public/deals/vinted-latest.json" with { type: "json" };
import zalandoSnapshot from "../public/deals/zalando-latest.json" with { type: "json" };

const scarossoMonitor = monitorConfig.find((monitor) => monitor.source === "scarosso");

test("slice 1 inventory stays grounded in the checked-in source snapshots", () => {
  assert.equal(typeof vintedSnapshot.site, "string");
  assert.ok(Array.isArray(vintedSnapshot.products));
  assert.ok(vintedSnapshot.products.length > 0);
  assert.equal(vintedSnapshot.products[0].currency, "DKK");
  assert.equal(typeof vintedSnapshot.products[0].price, "number");

  assert.equal(scarossoSnapshot.product_count, scarossoSnapshot.products.length);
  assert.equal(
    scarossoSnapshot.scan_status.failed_pages,
    scarossoSnapshot.debug.pages.filter((page) => page.error !== null).length
  );
  assert.equal(scarossoSnapshot.debug.pages.length, 6);

  assert.equal(typeof zalandoSnapshot.site, "string");
  assert.ok(Array.isArray(zalandoSnapshot.products));
  assert.ok(zalandoSnapshot.products.length > 0);
  assert.equal(typeof zalandoSnapshot.products[0].current_price, "number");
  assert.equal(typeof zalandoSnapshot.products[0].original_price, "number");
});

test("slice 1 records the checked-in Scarosso route inventory and denmark-only base URL", () => {
  assert.ok(scarossoMonitor);
  assert.equal(scarossoMonitor.filters.listingUrls.length, 6);
  for (const listingUrl of scarossoMonitor.filters.listingUrls) {
    assert.match(listingUrl, /^\/sales\/men\//);
    assert.match(listingUrl, /prefn1=c_size&prefv1=42$/);
  }
  assert.ok(
    scarossoMonitor.filters.listingUrls.every((url) => !url.includes("en-us"))
  );
  assert.ok(
    scarossoMonitor.filters.listingUrls.every((url) => url.includes("prefv1=42"))
  );
});

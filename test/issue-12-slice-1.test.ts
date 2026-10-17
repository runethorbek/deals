import assert from "node:assert/strict";
import test from "node:test";

import vintedSnapshot from "../public/deals/vinted-latest.json" with { type: "json" };
import zalandoSnapshot from "../public/deals/zalando-latest.json" with { type: "json" };

// The `length > 0` assertions prove `products[0]` exists; the non-null
// assertions only tell noUncheckedIndexedAccess what assert.ok cannot.
test("slice 1 inventory stays grounded in the checked-in source snapshots", () => {
  assert.equal(typeof vintedSnapshot.site, "string");
  assert.ok(Array.isArray(vintedSnapshot.products));
  assert.ok(vintedSnapshot.products.length > 0);
  assert.equal(vintedSnapshot.products[0]!.currency, "DKK");
  assert.equal(typeof vintedSnapshot.products[0]!.price, "number");

  assert.equal(typeof zalandoSnapshot.site, "string");
  assert.ok(Array.isArray(zalandoSnapshot.products));
  assert.ok(zalandoSnapshot.products.length > 0);
  assert.equal(typeof zalandoSnapshot.products[0]!.current_price, "number");
  assert.equal(typeof zalandoSnapshot.products[0]!.original_price, "number");
});

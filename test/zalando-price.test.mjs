import assert from "node:assert/strict";
import test from "node:test";
import { extractDkkPriceCandidates, extractPriceInfo } from "../scripts/lib/zalando-price.mjs";

test("parses Danish prices containing thousands separators", () => {
  assert.deepEqual(extractDkkPriceCandidates("fra1.037,00 kr Normalpris:1.595,00 kr"), [1595, 1037]);
});

test("extracts current and normal price from a Zalando card", () => {
  const result = extractPriceInfo("Deal BOSS GENIUS - Bukser - black fra1.037,00 krNormalpris:1.595,00 krSpar op til-35%");
  assert.equal(result.current_price, 1037);
  assert.equal(result.original_price, 1595);
  assert.equal(result.discount_percent, 35);
  assert.equal(result.explicit_discount_percent, 35);
});

test("extracts current and original price from a Zalando card", () => {
  const result = extractPriceInfo("Tiger of Sweden TOMMIE - Bukser - black2.066,00 krOprindeligt:2.295,00 kr-10%");
  assert.equal(result.current_price, 2066);
  assert.equal(result.original_price, 2295);
  assert.equal(result.discount_percent, 10);
});

test("does not use Sidste laveste pris as current or original price", () => {
  const result = extractPriceInfo("Oscar Jacobson DEL - Bukser - balsam green1.019,00 krOprindeligt:1.699,00 kr-40%Sidste laveste pris1.189,00 kr-14%");
  assert.equal(result.current_price, 1019);
  assert.equal(result.original_price, 1699);
  assert.equal(result.discount_percent, 40);
  assert.deepEqual(result.price_candidates, [1699, 1189, 1019]);
});

test("does not synthesize an original price from a last-lowest percentage", () => {
  const result = extractPriceInfo("Product999,00 krSidste laveste pris1.199,00 kr-17%");
  assert.equal(result.current_price, 999);
  assert.equal(result.original_price, null);
  assert.equal(result.discount_percent, null);
  assert.equal(result.explicit_discount_percent, null);
  assert.deepEqual(result.price_candidates, [1199, 999]);
});

test("rejects a labeled original price that is not above the current price", () => {
  const result = extractPriceInfo("Product1.199,00 krOprindeligt:999,00 kr-10%");
  assert.equal(result.current_price, 1199);
  assert.equal(result.original_price, null);
  assert.equal(result.discount_percent, null);
  assert.equal(result.explicit_discount_percent, null);
  assert.deepEqual(result.price_candidates, [1199, 999]);
});

test("keeps a full-price card as a single current price", () => {
  const result = extractPriceInfo("Boggi Milano Chino - black1.649,00 kr");
  assert.equal(result.current_price, 1649);
  assert.equal(result.original_price, null);
  assert.equal(result.discount_percent, null);
});

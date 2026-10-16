import assert from "node:assert/strict";
import test from "node:test";
import { extractPriceInfo } from "../scripts/lib/zalando-price.ts";

type ExpectedPrice = {
  current_price: number;
  original_price: number;
  currency: "DKK";
};

test("runs as TypeScript and imports an existing .mjs module", () => {
  const text: string = "Deal BOSS GENIUS - Bukser - black fra1.037,00 krNormalpris:1.595,00 krSpar op til-35%";
  const expected: ExpectedPrice = { current_price: 1037, original_price: 1595, currency: "DKK" };

  const result = extractPriceInfo(text);

  assert.equal(result.current_price, expected.current_price);
  assert.equal(result.original_price, expected.original_price);
  assert.equal(result.currency, expected.currency);
});

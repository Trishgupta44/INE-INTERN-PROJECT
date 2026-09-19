// Pure parsing of the store's deliberately varied price/stock strings. No DOM, no network.

const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

export function cleanText(text) {
  return String(text ?? '')
    .normalize('NFKC') // fullwidth digits -> ASCII, nbsp -> space
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats produced by the store (all from the same integer amount):
 *   default  "₹12,34,567"
 *   spaced   "₹12 34 567"
 *   euro     "₹12.34.567,00"
 *   trailing "₹12,34,567/- (incl. of all taxes)"
 *   unicode  "₹１２,３４,５６７"
 *   nbsp     "₹ 1 2 , 3 4 , 5 6 7" (after nbsp/zero-width cleanup)
 *   lakh     "Rs. 12,34,567.00"
 * Returns { value, format, raw } or null when nothing trustworthy can be read.
 */
export function parsePrice(text) {
  const raw = String(text ?? '');
  let s = cleanText(raw);
  if (!s) return null;

  let format = 'default';
  if (/\/-/.test(s)) {
    format = 'trailing';
    s = s.split('/-')[0];
  }
  if (/^Rs\.?/i.test(s)) format = 'lakh';
  if (/[０-９]/.test(raw)) format = 'unicode';
  else if (/[ ​]/.test(raw) && /\d\s\d/.test(s)) format = 'nbsp';
  else if (/\d \d/.test(s) && format === 'default') format = 'spaced';

  // Strip currency markers and anything that is not part of the number.
  let num = s.replace(/^(₹|Rs\.?|INR)\s*/i, '').trim();
  num = num.replace(/[^\d.,\s]/g, '').trim();
  if (!num) return null;

  let value;
  const euro = num.match(/^([\d.\s]+),(\d{2})$/);
  const decimal = num.match(/^([\d,\s]+)\.(\d{1,2})$/);
  if (euro) {
    format = format === 'default' || format === 'spaced' ? 'euro' : format;
    value = Number(euro[1].replace(/[.\s]/g, '')) + Number(euro[2]) / 100;
  } else if (decimal) {
    value = Number(decimal[1].replace(/[,\s]/g, '')) + Number(decimal[2].padEnd(2, '0')) / 100;
  } else {
    if (/[.,]/.test(num.replace(/[,\s]/g, '')) && !/^\d+$/.test(num.replace(/[,\s]/g, ''))) return null;
    value = Number(num.replace(/[,\s]/g, ''));
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value: Math.round(value * 100) / 100, format, raw };
}

/**
 * Stock badge texts:
 *   "In stock · 7 left", "Only 7 left", "7 in stock", "Selling fast — 7 left", "Hurry, just 7 left", "Out of stock"
 * Returns { quantity, inStock, raw } or null.
 */
export function parseStock(text) {
  const raw = String(text ?? '');
  const s = cleanText(raw);
  if (!s) return null;
  if (/out of stock|sold out|unavailable/i.test(s)) return { quantity: 0, inStock: false, raw };
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const quantity = Number(m[1]);
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  return { quantity, inStock: quantity > 0, raw };
}

export function validateQuote({ price, mrp, stock }) {
  const problems = [];
  if (!price || !Number.isFinite(price.value) || price.value <= 0) problems.push('price missing or not positive');
  if (price && !Number.isInteger(price.value) && Math.abs(price.value - Math.round(price.value)) > 0.001) {
    // The store only ever sells at whole-rupee prices; a fractional value means a bad parse.
    problems.push(`price is not a whole amount (${price.value})`);
  }
  if (mrp && price && mrp.value < price.value) problems.push(`MRP ${mrp.value} lower than price ${price.value}`);
  if (price && price.value > 10_000_000) problems.push('price implausibly large');
  if (!stock) problems.push('stock missing');
  return problems;
}

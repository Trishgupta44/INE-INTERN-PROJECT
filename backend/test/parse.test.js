import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseStock, validateQuote } from '../src/scraper/parse.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

test('default en-IN format', () => {
  assert.equal(parsePrice(inr(1234567)).value, 1234567);
  assert.equal(parsePrice('₹12,345').value, 12345);
  assert.equal(parsePrice('₹899').value, 899);
});

test('spaced format (commas replaced by spaces)', () => {
  assert.equal(parsePrice(inr(1234567).replace(/,/g, ' ')).value, 1234567);
});

test('euro format', () => {
  const s = `${inr(1234567).replace(/,/g, '.')},00`;
  const r = parsePrice(s);
  assert.equal(r.value, 1234567);
  assert.equal(r.format, 'euro');
});

test('trailing format', () => {
  const r = parsePrice(`${inr(45999)}/- (incl. of all taxes)`);
  assert.equal(r.value, 45999);
  assert.equal(r.format, 'trailing');
});

test('unicode fullwidth digits', () => {
  const s = inr(45999).replace(/[0-9]/g, (d) => String.fromCharCode(65296 + Number(d)));
  const r = parsePrice(s);
  assert.equal(r.value, 45999);
  assert.equal(r.format, 'unicode');
});

test('nbsp + zero-width joined characters', () => {
  const s = inr(45999).split('').join(' ​');
  const r = parsePrice(s);
  assert.equal(r.value, 45999);
});

test('split carrier (zero-width between every char) still parses', () => {
  const s = inr(2599).split('').join('​');
  assert.equal(parsePrice(s).value, 2599);
});

test('lakh format', () => {
  const s = `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(1234567)}`;
  const r = parsePrice(s);
  assert.equal(r.value, 1234567);
  assert.equal(r.format, 'lakh');
});

test('rejects garbage', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('Loading current price…'), null);
  assert.equal(parsePrice('₹0'), null);
  assert.equal(parsePrice('Price hidden'), null);
});

test('stock phrasings', () => {
  assert.deepEqual(parseStock('In stock · 7 left').quantity, 7);
  assert.equal(parseStock('Only 3 left').quantity, 3);
  assert.equal(parseStock('12 in stock').quantity, 12);
  assert.equal(parseStock('Selling fast — 9 left').quantity, 9);
  assert.equal(parseStock('Hurry, just 1 left').quantity, 1);
  const out = parseStock('Out of stock');
  assert.equal(out.quantity, 0);
  assert.equal(out.inStock, false);
  assert.equal(parseStock(''), null);
  assert.equal(parseStock('In stock'), null);
});

test('validation catches inconsistent quotes', () => {
  assert.deepEqual(validateQuote({ price: parsePrice('₹100'), mrp: parsePrice('₹120'), stock: parseStock('Only 2 left') }), []);
  assert.ok(validateQuote({ price: parsePrice('₹100'), mrp: parsePrice('₹80'), stock: parseStock('Only 2 left') }).length);
  assert.ok(validateQuote({ price: null, stock: parseStock('Only 2 left') }).length);
  assert.ok(validateQuote({ price: parsePrice('₹100'), stock: null }).length);
});

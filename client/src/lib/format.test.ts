import { describe, expect, it } from 'vitest';
import { discountPercent, formatPrice, paiseToRupees, rupeesToPaise } from './format';

describe('money formatting (integer paise)', () => {
  it('formats rupees in Indian grouping', () => {
    expect(formatPrice(129900)).toBe('₹1,299');
    expect(formatPrice(12345678)).toBe('₹1,23,456.78');
    expect(formatPrice(12950)).toBe('₹129.50');
    expect(formatPrice(null)).toBe('—');
  });

  it('converts rupee input to paise without float drift', () => {
    expect(rupeesToPaise('499')).toBe(49900);
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise('1,099.99')).toBe(109999);
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
    expect(paiseToRupees(49950)).toBe('499.50');
    expect(paiseToRupees(49900)).toBe('499');
  });

  it('computes discount percentages', () => {
    expect(discountPercent(24900, 29900)).toBe(17);
    expect(discountPercent(29900, null)).toBe(0);
    expect(discountPercent(29900, 29900)).toBe(0);
  });
});

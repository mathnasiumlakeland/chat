import { describe, expect, it } from 'vitest';
import { calculateTokensPerSecond, estimateDisplayedTokenCount } from './generation-stats';

describe('estimateDisplayedTokenCount', () => {
	it('returns zero for blank text', () => {
		expect(estimateDisplayedTokenCount('   \n')).toBe(0);
	});

	it('counts words and punctuation-like pieces instead of characters', () => {
		expect(estimateDisplayedTokenCount("Hello! I'm here to help.")).toBeGreaterThanOrEqual(6);
		expect(estimateDisplayedTokenCount("Hello! I'm here to help.")).toBeLessThan(24);
	});
});

describe('calculateTokensPerSecond', () => {
	it('calculates speed from decoded tokens and elapsed time', () => {
		expect(calculateTokensPerSecond(9, 1000)).toBe(9);
		expect(calculateTokensPerSecond(5, 2000)).toBe(2.5);
	});

	it('returns zero for empty or invalid timing input', () => {
		expect(calculateTokensPerSecond(0, 1000)).toBe(0);
		expect(calculateTokensPerSecond(10, 0)).toBe(0);
	});
});

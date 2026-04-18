import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from './models';
import { formatGigabytes } from '$lib/utils/format';

describe('MODEL_CATALOG', () => {
	it('formats the published Bonsai cache and memory sizes for the picker UI', () => {
		expect(formatGigabytes(MODEL_CATALOG[0].cacheSizeBytes)).toBe('0.47 GB');
		expect(formatGigabytes(MODEL_CATALOG[0].loadedSizeBytes)).toBe('0.47 GB');
		expect(formatGigabytes(MODEL_CATALOG[1].cacheSizeBytes)).toBe('1.10 GB');
		expect(formatGigabytes(MODEL_CATALOG[1].loadedSizeBytes)).toBe('1.10 GB');
		expect(formatGigabytes(MODEL_CATALOG[2].cacheSizeBytes)).toBe('2.20 GB');
		expect(formatGigabytes(MODEL_CATALOG[2].loadedSizeBytes)).toBe('2.20 GB');
	});
});

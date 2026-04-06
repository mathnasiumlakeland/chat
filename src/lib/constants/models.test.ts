import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from './models';
import { formatGigabytes } from '$lib/utils/format';

describe('MODEL_CATALOG', () => {
	it('formats the published Bonsai cache and memory sizes for the picker UI', () => {
		expect(formatGigabytes(MODEL_CATALOG[0].cacheSizeBytes)).toBe('0.25 GB');
		expect(formatGigabytes(MODEL_CATALOG[0].loadedSizeBytes)).toBe('0.24 GB');
		expect(formatGigabytes(MODEL_CATALOG[1].cacheSizeBytes)).toBe('0.57 GB');
		expect(formatGigabytes(MODEL_CATALOG[1].loadedSizeBytes)).toBe('0.57 GB');
	});
});

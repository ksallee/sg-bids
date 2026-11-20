import { describe, expect, it } from 'vitest';
import { targetKey } from './model';

describe('targetKey', () => {
	it('names a shot and an asset apart, even with the same id', () => {
		expect(targetKey({ kind: 'shot', id: 'a1' })).toBe('shot:a1');
		expect(targetKey({ kind: 'asset', id: 'a1' })).toBe('asset:a1');
	});
});

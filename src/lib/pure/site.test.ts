import { describe, expect, it } from 'vitest';
import { shortHost } from './site';

describe('shortHost', () => {
	it('drops the suffix every Flow PT host carries', () => {
		expect(shortHost('https://studio.shotgrid.autodesk.com')).toBe('studio');
		expect(shortHost('https://studio.shotgunstudio.com')).toBe('studio');
	});

	it('keeps any other host whole, without www', () => {
		expect(shortHost('https://www.example.com/path')).toBe('example.com');
	});

	it('gives back what it cannot read as a URL', () => {
		expect(shortHost('not a url')).toBe('not a url');
	});
});

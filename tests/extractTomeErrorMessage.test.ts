import { describe, expect, it } from 'vitest';

import { extractErrorMessage } from '../src/tomeHttp';

/**
 * The connector used to answer every refusal with "server responded with status
 * 409. Check the console for the response body." The server had already written
 * a sentence explaining what to do; this is what gets it in front of the person
 * syncing instead of the developer console.
 */
describe('extractErrorMessage', () => {
	it('prefers the ProblemDetails detail, which is the sentence worth reading', () => {
		const body = JSON.stringify({
			title: 'Resource is in use.',
			status: 409,
			detail:
				"More than one player character in this campaign is called 'Alanna', so there is no way to tell which one this sync is for. Rename one of them and sync again.",
		});

		expect(extractErrorMessage(body)).toContain("called 'Alanna'");
	});

	it('falls back to the title when there is no detail', () => {
		const body = JSON.stringify({ title: 'Resource is in use.', status: 409 });

		expect(extractErrorMessage(body)).toBe('Resource is in use.');
	});

	it('reads the ApiMessageDto shape the controllers return', () => {
		const body = JSON.stringify({
			message: 'You have reached the map limit for your plan.',
			code: 'plan.limit.maps',
		});

		expect(extractErrorMessage(body)).toBe(
			'You have reached the map limit for your plan.',
		);
	});

	it('passes a non-JSON body straight through rather than swallowing it', () => {
		expect(extractErrorMessage('Service Unavailable')).toBe(
			'Service Unavailable',
		);
	});

	it('returns null for an empty body, so the caller can show the status instead', () => {
		expect(extractErrorMessage('')).toBeNull();
		expect(extractErrorMessage('   ')).toBeNull();
	});

	it('returns null when the object carries nothing human-readable', () => {
		expect(extractErrorMessage(JSON.stringify({ status: 500 }))).toBeNull();
		expect(extractErrorMessage(JSON.stringify({ detail: '  ' }))).toBeNull();
	});

	/** A notice is one transient line. An HTML error page in one is unreadable. */
	it('truncates something far too long for a notice', () => {
		const long = 'x'.repeat(1000);

		const result = extractErrorMessage(JSON.stringify({ detail: long }));

		expect(result).toHaveLength(300);
		expect(result?.endsWith('…')).toBe(true);
	});
});

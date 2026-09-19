import { describe, expect, it, vi } from 'vitest';

import { runBulkSend } from '../src/bulkSend';
import { TOME_ROUTES } from '../src/routes';
import {
	NOT_CONFIGURED,
	createTomeHttp,
	describeFailure,
	type TomeRequest,
	type TomeResponse,
	type TomeTransport,
} from '../src/tomeHttp';

/** The test adapter at the transport seam: records what was sent, answers what it is told. */
function fakeTransport(...answers: (TomeResponse | Error)[]): TomeTransport & { sent: TomeRequest[] } {
	const sent: TomeRequest[] = [];
	const transport = (request: TomeRequest): Promise<TomeResponse> => {
		sent.push(request);
		// Answers in turn, then keeps giving the last one.
		const answer = answers[Math.min(sent.length, answers.length) - 1]!;
		return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
	};
	return Object.assign(transport, { sent });
}

const target = { baseUrl: 'https://tome.example.com/', apiKey: 'key-1', campaignId: 'camp-1' };

describe('postJson', () => {
	it('sends the body to the joined url with the api key and campaign headers', async () => {
		const transport = fakeTransport({ status: 200, text: '{"id":"abc"}' });
		await createTomeHttp(transport).postJson({ ...target, path: '/api/map' }, '{"a":1}');

		expect(transport.sent).toEqual([
			{
				url: 'https://tome.example.com/api/map',
				method: 'POST',
				contentType: 'application/json',
				headers: {
					'Content-Type': 'application/json',
					'X-Api-Key': 'key-1',
					'X-Campaign-Id': 'camp-1',
				},
				body: '{"a":1}',
			},
		]);
	});

	it('leaves the campaign header off when the caller is not campaign-scoped', async () => {
		const transport = fakeTransport({ status: 200, text: '' });
		await createTomeHttp(transport).postJson(
			{ baseUrl: target.baseUrl, apiKey: 'key-1', path: 'api/x' },
			'{}',
		);

		expect(transport.sent[0]?.headers).toEqual({
			'Content-Type': 'application/json',
			'X-Api-Key': 'key-1',
		});
	});

	it('reports a 2xx with an id', async () => {
		const result = await createTomeHttp(fakeTransport({ status: 201, text: '{"id":"abc"}' })).postJson(
			{ ...target, path: 'api/map' },
			'{}',
		);
		expect(result).toEqual({ ok: true, status: 201, id: 'abc', message: null, retryable: false });
	});

	it('reports a 2xx without an id', async () => {
		const result = await createTomeHttp(fakeTransport({ status: 204, text: '' })).postJson(
			{ ...target, path: 'api/map' },
			'{}',
		);
		expect(result).toEqual({ ok: true, status: 204, id: null, message: null, retryable: false });
	});

	it("refuses a 4xx with the server's ProblemDetails message, not retryable", async () => {
		const text = JSON.stringify({ title: 'Conflict', detail: "A map called 'Cave' already exists.", status: 409 });
		const result = await createTomeHttp(fakeTransport({ status: 409, text })).postJson(
			{ ...target, path: 'api/map' },
			'{}',
		);
		expect(result).toEqual({
			ok: false,
			status: 409,
			id: null,
			message: "A map called 'Cave' already exists.",
			retryable: false,
		});
	});

	it.each([429, 500, 503])('marks %i as retryable', async (status) => {
		const result = await createTomeHttp(fakeTransport({ status, text: '' })).postJson(
			{ ...target, path: 'api/map' },
			'{}',
		);
		expect(result).toMatchObject({ ok: false, status, retryable: true });
	});

	it.each([429, 503])("carries a %i's Retry-After in seconds", async (status) => {
		const result = await createTomeHttp(
			fakeTransport({ status, text: '', headers: { 'retry-after': '7' } }),
		).postJson({ ...target, path: 'api/map' }, '{}');
		expect(result).toMatchObject({ ok: false, status, retryable: true, retryAfterSeconds: 7 });
	});

	it('turns an HTTP-date Retry-After into seconds from now, whatever the header case', async () => {
		vi.useFakeTimers({ now: Date.parse('Sat, 19 Sep 2026 12:00:00 GMT') });
		try {
			const result = await createTomeHttp(
				fakeTransport({ status: 429, text: '', headers: { 'Retry-After': 'Sat, 19 Sep 2026 12:00:12 GMT' } }),
			).postJson({ ...target, path: 'api/map' }, '{}');
			expect(result).toMatchObject({ retryAfterSeconds: 12 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves retryAfterSeconds off when the header is missing or unreadable', async () => {
		for (const headers of [undefined, { 'retry-after': 'soon' }, { 'retry-after': '1.5' }, { 'retry-after': '-5' }]) {
			const result = await createTomeHttp(fakeTransport({ status: 429, text: '', headers })).postJson(
				{ ...target, path: 'api/map' },
				'{}',
			);
			expect(result).not.toHaveProperty('retryAfterSeconds');
		}
	});

	it('marks a network failure as retryable with status 0', async () => {
		const result = await createTomeHttp(fakeTransport(new Error('net::ERR_CONNECTION_REFUSED'))).postJson(
			{ ...target, path: 'api/map' },
			'{}',
		);
		expect(result).toEqual({
			ok: false,
			status: 0,
			id: null,
			message: 'net::ERR_CONNECTION_REFUSED',
			retryable: true,
		});
	});

	it.each([
		['no base url', { ...target, baseUrl: '  ' }],
		['no api key', { ...target, apiKey: '' }],
	])('sends nothing when there is %s', async (_, unconfigured) => {
		const transport = fakeTransport({ status: 200, text: '' });
		const result = await createTomeHttp(transport).postJson({ ...unconfigured, path: 'api/map' }, '{}');

		expect(transport.sent).toEqual([]);
		expect(result).toEqual({ ok: false, status: 0, id: null, message: NOT_CONFIGURED, retryable: false });
	});
});

describe('postMultipart', () => {
	it('sends the body under its own content type with the same headers', async () => {
		const transport = fakeTransport({ status: 200, text: '"pkg-1"' });
		const body = new ArrayBuffer(4);
		const result = await createTomeHttp(transport).postMultipart(
			{ baseUrl: target.baseUrl, apiKey: 'key-1', path: 'api/import' },
			body,
			'multipart/form-data; boundary=xyz',
		);

		expect(transport.sent[0]).toEqual({
			url: 'https://tome.example.com/api/import',
			method: 'POST',
			contentType: 'multipart/form-data; boundary=xyz',
			headers: { 'Content-Type': 'multipart/form-data; boundary=xyz', 'X-Api-Key': 'key-1' },
			body,
		});
		expect(result).toEqual({ ok: true, status: 200, id: 'pkg-1', message: null, retryable: false });
	});

	it("refuses a 4xx with the server's message", async () => {
		const text = JSON.stringify({ message: 'Third-party content is switched off.' });
		const result = await createTomeHttp(fakeTransport({ status: 402, text })).postMultipart(
			{ ...target, path: 'api/import' },
			new ArrayBuffer(0),
			'multipart/form-data; boundary=xyz',
		);
		expect(result).toMatchObject({ ok: false, status: 402, message: 'Third-party content is switched off.', retryable: false });
	});

	it('marks 429 and a network failure as retryable', async () => {
		const args = [{ ...target, path: 'api/import' }, new ArrayBuffer(0), 'multipart/form-data'] as const;
		expect(await createTomeHttp(fakeTransport({ status: 429, text: '' })).postMultipart(...args)).toMatchObject({
			retryable: true,
		});
		expect(await createTomeHttp(fakeTransport(new Error('offline'))).postMultipart(...args)).toMatchObject({
			status: 0,
			message: 'offline',
			retryable: true,
		});
	});
});

describe('getJson', () => {
	const campaignsTarget = { baseUrl: target.baseUrl, apiKey: 'key-1', path: TOME_ROUTES.campaigns };

	it('loads the campaign list with the api key and no body', async () => {
		const campaigns = [{ id: 'c1', name: 'Curse of Strahd' }];
		const transport = fakeTransport({ status: 200, text: JSON.stringify(campaigns) });
		const result = await createTomeHttp(transport).getJson(campaignsTarget);

		expect(transport.sent).toEqual([
			{ url: 'https://tome.example.com/api/campaigns', method: 'GET', headers: { 'X-Api-Key': 'key-1' } },
		]);
		expect(result).toEqual({ ok: true, value: campaigns });
	});

	it("shows the server's message when the campaigns cannot be loaded", async () => {
		const text = JSON.stringify({ title: 'Unauthorized', detail: 'That API key has been revoked.', status: 401 });
		const result = await createTomeHttp(fakeTransport({ status: 401, text })).getJson(campaignsTarget);
		expect(result).toEqual({ ok: false, message: 'That API key has been revoked.' });
	});

	it('sends nothing when unconfigured', async () => {
		const transport = fakeTransport({ status: 200, text: '[]' });
		const result = await createTomeHttp(transport).getJson({ ...campaignsTarget, baseUrl: '' });
		expect(transport.sent).toEqual([]);
		expect(result).toEqual({ ok: false, message: NOT_CONFIGURED });
	});

	it('refuses a 2xx whose body is not JSON', async () => {
		const result = await createTomeHttp(fakeTransport({ status: 200, text: '<html>' })).getJson(campaignsTarget);
		expect(result).toEqual({ ok: false, message: 'The server sent a response that was not JSON.' });
	});
});

describe('postJsonAndRead', () => {
	it('returns the parsed body of an adventure import', async () => {
		const transport = fakeTransport({ status: 200, text: '{"id":"book-1","blocksWritten":3}' });
		const result = await createTomeHttp(transport).postJsonAndRead<{ id: string; blocksWritten: number }>(
			{ ...target, path: TOME_ROUTES.importAdventure },
			'{"title":"Book"}',
		);

		expect(transport.sent).toEqual([
			{
				url: 'https://tome.example.com/api/Storybook/ImportAdventure',
				method: 'POST',
				contentType: 'application/json',
				headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'key-1', 'X-Campaign-Id': 'camp-1' },
				body: '{"title":"Book"}',
			},
		]);
		expect(result).toEqual({ ok: true, value: { id: 'book-1', blocksWritten: 3 } });
	});

	it("shows the server's message when the adventure import is refused", async () => {
		const text = JSON.stringify({ detail: 'Chapter "Arrival" appears twice.' });
		const result = await createTomeHttp(fakeTransport({ status: 400, text })).postJsonAndRead(
			{ ...target, path: TOME_ROUTES.importAdventure },
			'{}',
		);
		expect(result).toEqual({ ok: false, message: 'Chapter "Arrival" appears twice.' });
	});

	it('falls back to the status when the server gives no message', async () => {
		const result = await createTomeHttp(fakeTransport({ status: 502, text: '' })).postJsonAndRead(
			{ ...target, path: TOME_ROUTES.resolveLinks },
			'{}',
		);
		expect(result).toEqual({ ok: false, message: 'The server responded with status 502.' });
	});
});

describe('describeFailure', () => {
	it("gives a refused reference upload the server's message", async () => {
		const text = JSON.stringify({ detail: 'You have reached the reference limit for your plan.' });
		const result = await createTomeHttp(fakeTransport({ status: 402, text })).postMultipart(
			{ ...target, path: TOME_ROUTES.uploadReference },
			new ArrayBuffer(0),
			'multipart/form-data; boundary=xyz',
		);
		expect(describeFailure(result)).toBe('You have reached the reference limit for your plan.');
	});

	it('names the status when the server said nothing', () => {
		expect(describeFailure({ ok: false, status: 500, id: null, message: null, retryable: true })).toBe(
			'The server responded with status 500.',
		);
	});
});

describe('a bulk run against a rate-limited server', () => {
	it("waits the server's Retry-After, not its own backoff, then sends", async () => {
		const transport = fakeTransport(
			{ status: 429, text: '', headers: { 'Retry-After': '9' } },
			{ status: 201, text: '{"id":"sent-1"}' },
		);
		const tome = createTomeHttp(transport);
		const waits: number[] = [];

		const report = await runBulkSend({
			items: [{ label: 'Goblin', path: 'Goblin.md', value: '{}' }],
			sleep: (ms) => {
				waits.push(ms);
				return Promise.resolve();
			},
			send: (item) => tome.postJson({ ...target, path: 'api/creature' }, item.value),
		});

		expect(waits).toEqual([9_000]);
		expect(transport.sent).toHaveLength(2);
		expect(report.sent.map((outcome) => outcome.id)).toEqual(['sent-1']);
	});
});

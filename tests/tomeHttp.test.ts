import { describe, expect, it } from 'vitest';

import {
	NOT_CONFIGURED,
	createTomeHttp,
	type TomeRequest,
	type TomeResponse,
	type TomeTransport,
} from '../src/tomeHttp';

/** The test adapter at the transport seam: records what was sent, answers what it is told. */
function fakeTransport(answer: TomeResponse | Error): TomeTransport & { sent: TomeRequest[] } {
	const sent: TomeRequest[] = [];
	const transport = (request: TomeRequest): Promise<TomeResponse> => {
		sent.push(request);
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

import { Notice, requestUrl } from 'obsidian';
import { createTomeHttp, type SendResult, type TomeTransport } from './tomeHttp';

export { describeFailure, type SendResult } from './tomeHttp';

/** The production adapter at the transport seam. `throw: false` so a 4xx comes back as a status. */
const obsidianTransport: TomeTransport = async (request) => {
	const response = await requestUrl({ ...request, throw: false });
	return { status: response.status, text: response.text, headers: response.headers };
};

/** The Tome HTTP module over `requestUrl`: the post port the send module is given in the plugin. */
export const tomeHttp = createTomeHttp(obsidianTransport);

/**
 * Tells the user how one send went, and returns the id on success or null.
 * For the per-block buttons, where one Notice per send is exactly right.
 */
export function noticeResult(result: SendResult): string | null {
	if (result.ok) {
		new Notice('Sent to Tome successfully.');
		return result.id;
	}

	// The server explains itself - a duplicated character name, a plan limit, a
	// title already taken - and those are things the person syncing can fix.
	// Sending them to the developer console to find out what went wrong made
	// every refusal look like a bug.
	new Notice(
		result.message
			? `Tome connector: ${result.message}`
			: `Tome connector: server responded with status ${result.status}. Check the console for the response body.`,
	);
	return null;
}

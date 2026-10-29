import { Notice, requestUrl } from 'obsidian';
import { createTomeHttp, describeResult, type SendResult, type TomeTransport } from './tomeHttp';

export { describeFailure, type SendResult } from './tomeHttp';

/** The production adapter at the transport seam. `throw: false` so a 4xx comes back as a status. */
const obsidianTransport: TomeTransport = async (request) => {
	const response = await requestUrl({ ...request, throw: false });
	return { status: response.status, text: response.text, headers: response.headers };
};

/** The Tome HTTP module over `requestUrl`: the post port the send module is given in the plugin. */
export const tomeHttp = createTomeHttp(obsidianTransport);

/**
 * Tells the user how one send of `name` to `where` went, and returns the id on success or null.
 * For the per-block buttons, where one Notice per send is exactly right.
 */
export function noticeResult(result: SendResult, name: string, where: string): string | null {
	new Notice(describeResult(result, name, where));
	return result.ok ? result.id : null;
}

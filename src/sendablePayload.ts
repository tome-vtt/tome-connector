import type { App } from 'obsidian';

import type { Sendable } from './recognizers/noteScan';
import { obsidianSendPorts } from './obsidianSendPorts';
import { sendToTome, type Destination } from './sendModule';
import type { SendResult } from './tomeHttp';

/**
 * Sends one scanned {@link Sendable}, quietly, and reports what the server said:
 * the send module (`sendModule.ts`) over the vault.
 *
 * The impure half of the scan. Building these bodies needs the vault - reading
 * an image off disk - which is exactly why the scan itself stops at intent and
 * the preview can count 709 notes without touching a single image.
 *
 * **Throwing is how an item is reported as unresolvable.** `runBulkSend` treats a
 * thrown error as permanent for that item and does not retry it: a missing image
 * is still missing on the second attempt, and a bestiary that is not installed
 * will not be installed a second later.
 */
export function sendSendable(
	app: App,
	sendable: Sendable,
	destination: Destination,
	downscale: boolean,
): Promise<SendResult> {
	return sendToTome(obsidianSendPorts(app, downscale), sendable, destination);
}

/**
 * Reads Initiative Tracker's ` ```encounter ` block.
 *
 * The connector used to define its own shape for this fence — `npcs:` with
 * `name`/`quantity` pairs — while javalent's Initiative Tracker was already using
 * the same language with `creatures:`. Two plugins registering a processor for
 * one fence is a fight nobody wins, and asking people to rewrite encounters they
 * had already written was the wrong half to give up. Theirs is the shape now.
 *
 * Pure and `obsidian`-free so vitest can reach it; the caller parses the YAML.
 */

import { existingTomeId } from '../tomeIdWriteBack';

/** The server's `Encounter` shape, which is camelCase unlike the NPC endpoint's. */
export interface EncounterPayload {
	id?: string;
	name: string;
	encounterNpcs: { name: string; quantity: number }[];
}

export interface EncounterEntry {
	name: string;
	count: number;
}

/**
 * Initiative Tracker writes a creature four ways, and the count-prefixed form is
 * the common one:
 *
 * ```yaml
 * creatures:
 *   - 3: Goblin        # three goblins   -> {3: "Goblin"} once parsed
 *   - Bugbear          # one, by name
 *   - Goblin: {hp: 12} # one, with overrides we do not carry
 *   - name: Goblin     # the long form
 * ```
 *
 * A non-integer key (`1d4: Goblin`, which the plugin rolls) becomes a count of 1
 * rather than a guess: the connector cannot roll dice on the user's behalf and
 * silently importing four goblins because the die *might* say four would be
 * worse than importing one they can duplicate.
 */
export function parseCreatureEntry(entry: unknown): EncounterEntry | null {
	if (typeof entry === 'string') {
		const name = entry.trim();
		return name === '' ? null : { name, count: 1 };
	}

	if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
		return null;
	}

	const record = entry as Record<string, unknown>;

	// The long form, and the shape Tome's own blocks used to use.
	const explicit = record.name ?? record.creature;
	if (typeof explicit === 'string' && explicit.trim() !== '') {
		return { name: explicit.trim(), count: readCount(record.quantity ?? record.count) };
	}

	const keys = Object.keys(record);
	if (keys.length !== 1) return null;
	const key = keys[0];
	if (key === undefined) return null;

	// Which side holds the name is decided by the *value*, not the key.
	//
	// A string value means the key was the count position - `- 3: Goblin`, and
	// also `- 1d4: Goblin`, where the plugin rolls the die and we cannot. Reading
	// the key instead would name that creature "1d4" and lose "Goblin" entirely,
	// which is how this was wrong the first time.
	//
	// A non-string value means the key was the name and the value is overrides -
	// `- Goblin: {hp: 12}`. Those are dropped: Tome's encounter model holds a name
	// and a quantity and nothing else.
	const value = record[key];
	if (typeof value === 'string') {
		const name = value.trim();
		if (name === '') return null;
		const count = /^\d+$/.test(key.trim()) ? Math.max(1, parseInt(key, 10)) : 1;
		return { name, count };
	}

	const name = key.trim();
	return name === '' ? null : { name, count: 1 };
}

function readCount(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		return Math.max(1, parseInt(value, 10));
	}
	return 1;
}

/**
 * Maps a parsed encounter block onto the server's shape, or null when the block
 * is not one we can send.
 *
 * `party`, `players`, `rollHP`, `xp` and `round` are read and discarded: Tome
 * tracks its own party and rolls its own initiative, so carrying them would
 * imply an authority the import does not have.
 *
 * Creatures may legitimately repeat — `- 3: Goblin` twice is six goblins in two
 * groups — so entries are combined by name rather than deduplicated, which is
 * what the tracker itself shows.
 */
export function mapToEncounterPayload(parsed: unknown): EncounterPayload | null {
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const record = parsed as Record<string, unknown>;
	const name = record.name;
	if (typeof name !== 'string' || name.trim() === '') return null;

	const combined = new Map<string, number>();
	if (Array.isArray(record.creatures)) {
		for (const raw of record.creatures) {
			const entry = parseCreatureEntry(raw);
			if (!entry) continue;
			combined.set(entry.name, (combined.get(entry.name) ?? 0) + entry.count);
		}
	}

	const payload: EncounterPayload = {
		name: name.trim(),
		encounterNpcs: [...combined].map(([creature, quantity]) => ({
			name: creature,
			quantity,
		})),
	};

	const id = existingTomeId(record);
	if (id !== undefined) payload.id = id;

	return payload;
}

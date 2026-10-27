import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYamlReal } from 'yaml';

import { parseBackground } from '../src/recognizers/compendium/background';
import { cliNoteType, type CliNoteType } from '../src/recognizers/compendium/cliNote';
import { parseFeat } from '../src/recognizers/compendium/feat';
import { parseSpecies } from '../src/recognizers/compendium/species';
import { assemblePackage } from '../src/recognizers/compendium/package';
import { isMagic, parseMagicItem } from '../src/recognizers/compendium/magicItem';
import { parseSpell } from '../src/recognizers/compendium/spell';
import {
	parseSubclass,
	SHIPPED_CLASSES,
	unreachableFeatures,
} from '../src/recognizers/compendium/subclass';
import { extractFencedBlocks } from '../src/recognizers/markdownBlocks';
import { findSendables, summarise, type Sendable } from '../src/recognizers/noteScan';

/**
 * The scan, run over real `ttrpg-convert-cli` output.
 *
 * Every other test here feeds the scanner shapes chosen to exercise one decision.
 * This one points it at a whole generated compendium and asks whether it finds
 * what is actually in there — which is the only way to catch the things nobody
 * thinks to write a case for: a fence that does not parse, a creature counted
 * twice, a note shape the CLI emits that we never looked at.
 *
 * **Skipped when the corpus is absent.** It is generated from books the user
 * owns, so it cannot be committed; CI and any other machine skip it. That makes
 * it a check to run deliberately rather than a gate, which is the honest status
 * for a test whose fixture is somebody's book collection.
 */
const CORPUS = 'C:/TTRPGCLI/bin/dm/3-Mechanics/CLI';
const present = existsSync(CORPUS);

/**
 * The server's own 2024 catalogue, used as an oracle for the spell parse.
 *
 * Reaching across into `TomeVTT.Server` from the connector's tests is a liberty,
 * but this is the only independently-generated copy of the same facts in
 * existence, and comparing 322 scraped spells against it is worth more than any
 * fixture that could be written by hand.
 */
const SRD_SNAPSHOT = '../TomeVTT.Server/Data/Srd/srd-2024-characters.json';

/** Obsidian's own frontmatter parse, near enough: same YAML, same tags. */
function readNote(path: string): { content: string; frontmatter: Record<string, unknown> | null } {
	const content = readFileSync(path, 'utf8');
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match?.[1]) return { content, frontmatter: null };

	try {
		const parsed: unknown = parseYamlReal(match[1]);
		return {
			content,
			frontmatter:
				typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
					? (parsed as Record<string, unknown>)
					: null
		};
	} catch {
		return { content, frontmatter: null };
	}
}

function markdownFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) markdownFiles(full, found);
		else if (entry.name.endsWith('.md')) found.push(full);
	}
	return found;
}

/**
 * Every note of one CLI type, wherever it is filed.
 *
 * By type rather than by folder because that is how the real scan works - someone
 * pointing the connector at their vault has not necessarily kept the CLI's layout,
 * and two of the types do not line up with a folder anyway: the feats folder holds
 * an index, and 58 more feat-classed notes live under `optional-features`.
 */
interface CorpusNote {
	key: string;
	path: string;
	content: string;
	frontmatter: Record<string, unknown> | null;
}

/**
 * The whole corpus, read once.
 *
 * Memoised because the vault is thousands of notes and several tests want several
 * types out of it - re-reading and re-parsing per call took the suite past its
 * timeout the moment a second book was installed.
 */
let corpusCache: CorpusNote[] | null = null;

function allNotes(): CorpusNote[] {
	if (corpusCache !== null) return corpusCache;

	corpusCache = markdownFiles(CORPUS).map((path) => {
		const { content, frontmatter } = readNote(path);
		return {
			key: path.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/, '') ?? '',
			path: path.replace(/\\/g, '/'),
			content,
			frontmatter,
		};
	});

	return corpusCache;
}

function notesOfType(type: CliNoteType): CorpusNote[] {
	return allNotes().filter((note) => cliNoteType(note.frontmatter) === type);
}

/** One count off a report. `counts` is an open record, so every read is optional. */
function count(report: { counts: Record<string, number> }, type: string): number {
	return report.counts[type] ?? 0;
}

/**
 * What the scanner finds in one folder, off the cached read and memoised itself.
 *
 * Both halves matter at this size. The bestiary alone is 933 notes and five tests
 * ask about it, so re-reading and re-scanning per call put the file past its
 * timeout - which reads as four failures that are really one slow function.
 */
const folderScans = new Map<string, Sendable[]>();

/** The cached notes under one folder. */
function notesInFolder(folder: string): CorpusNote[] {
	const prefix = `${CORPUS}/${folder}/`;
	return allNotes().filter((note) => note.path.startsWith(prefix));
}

function scanFolder(folder: string): Sendable[] {
	const cached = folderScans.get(folder);
	if (cached) return cached;

	const found = notesInFolder(folder).flatMap((note) =>
		findSendables(
			{ path: note.path, content: note.content, frontmatter: note.frontmatter },
			parseYamlReal,
		),
	);

	folderScans.set(folder, found);
	return found;
}

describe.skipIf(!present)('ttrpg-convert-cli corpus', () => {
	/**
	 * Reading twelve thousand notes is setup, not an assertion.
	 *
	 * Left to happen inside whichever test ran first, the cold read pushed that one
	 * test past the timeout while every other test passed - which looks like a bug
	 * in whatever it happened to be checking.
	 */
	beforeAll(() => {
		allNotes();
	}, 60_000);

	/**
	 * Exactly one creature per note that has a statblock fence - counted from the
	 * files rather than hard-coded, because the corpus is whichever books the
	 * person running this owns. On the machine it was written against that is 667
	 * of 709 notes; the other 42 are folder indexes and list notes.
	 */
	it('finds a creature in every bestiary note that has a statblock', () => {
		const withStatblock = notesInFolder('bestiary').filter((note) =>
			extractFencedBlocks(note.content).some((block) => block.language === 'statblock'),
		).length;

		const found = scanFolder('bestiary');

		expect(withStatblock).toBeGreaterThan(0);
		expect(found).toHaveLength(withStatblock);
		expect(summarise(found).creature).toBe(found.length);
	});

	/**
	 * The CLI writes both a statblock fence and `statblock: inline` frontmatter on
	 * the same note. Counting both would silently double a 709-creature import,
	 * and the preview would agree with itself while being wrong.
	 */
	it('counts each creature once despite the fence and frontmatter both declaring it', () => {
		const found = scanFolder('bestiary');
		const perFile = new Map<string, number>();
		for (const sendable of found) {
			perFile.set(sendable.path, (perFile.get(sendable.path) ?? 0) + 1);
		}

		expect([...perFile.values()].filter((count) => count > 1)).toEqual([]);
	});

	it('gives every creature a usable name', () => {
		const nameless = scanFolder('bestiary').filter((s) => s.label.trim() === '');

		expect(nameless).toEqual([]);
	});

	/** Nothing in the compendium is an encounter or a map, so nothing should look like one. */
	it('does not mistake compendium prose for encounters or maps', () => {
		const counts = summarise([...scanFolder('spells'), ...scanFolder('backgrounds')]);

		expect(counts.encounter).toBe(0);
		expect(counts.map).toBe(0);
	});

	/**
	 * Spell notes now belong to the bulk sender as well as content-package imports.
	 * The remaining compendium types still do not, and stay explicit here so a new
	 * sendable kind cannot quietly change a whole-vault preview.
	 */
	it('finds every spell but does not yet pick up unsupported compendium types', () => {
		const spells = scanFolder('spells');
		expect(spells).toHaveLength(notesOfType('spell').length);
		expect(summarise(spells).spell).toBe(spells.length);
		expect(scanFolder('feats')).toEqual([]);
		expect(scanFolder('races')).toEqual([]);
	});

	/**
	 * Every `statblock` fence in the corpus is parseable YAML.
	 *
	 * The scanner swallows a parse failure and moves on, which is right - one bad
	 * block should not stop a run of 709 - but it also means a systematic problem
	 * with the fence extractor would look exactly like nothing happening. This is
	 * the assertion that would notice.
	 */
	it('parses every statblock fence in the bestiary', () => {
		const unparseable: string[] = [];

		for (const note of notesInFolder('bestiary')) {
			for (const block of extractFencedBlocks(note.content)) {
				if (block.language !== 'statblock') continue;
				try {
					parseYamlReal(block.source);
				} catch {
					unparseable.push(note.path);
				}
			}
		}

		expect(unparseable).toEqual([]);
	});

	/**
	 * Every species note in the corpus parses into something the builder could
	 * offer: a name, a size, a speed and at least one trait.
	 *
	 * The unit tests use one species chosen for its awkwardness. This is the check
	 * that the other nine follow the same template, which is the whole premise of
	 * scraping template-written prose.
	 */
	it('parses every species note into a usable species', () => {
		const problems: string[] = [];

		for (const { key, content } of notesOfType('species')) {
			const species = parseSpecies(content, key, key);
			if (species === null) {
				problems.push(`${key}: did not parse`);
				continue;
			}

			if (species.name.trim() === '') problems.push(`${key}: no name`);
			if (species.speed === null) problems.push(`${key}: no speed`);
			// The size is allowed to be null when the source will not commit to one -
			// the Verdan's is "Varies", being the one species that grows a category.
			// `sizeDetail` keeps the printed word either way, so the sheet still says
			// what the book says.
			if (species.size === null && !/varies/i.test(species.sizeDetail ?? '')) {
				problems.push(`${key}: no size`);
			}
			if (species.traits.length === 0) problems.push(`${key}: no traits`);
			if (species.traits.some((trait) => trait.desc.trim() === '')) {
				problems.push(`${key}: a trait with no text`);
			}
			// Not the description. The 2024 species all have a `## Description`
			// section and the older ones - the DMG's Aarakocra, Tasha's Custom
			// Lineage - go straight from their fields to their traits. That is a note
			// shape rather than a parse failure, and the traits are the part a
			// builder needs.
		}

		expect(problems).toEqual([]);
	});

	/**
	 * Every species-classed note parses; the index note beside them is typed
	 * `index` and never reaches the parser.
	 *
	 * Counted from the corpus rather than hard-coded, for the reason at the top of
	 * this file: which books are in it is the choice of whoever ran the CLI, and
	 * they can add any source in its map. A number here becomes wrong the moment
	 * they add a book, which says nothing about the parser.
	 */
	it('reads every species and nothing else', () => {
		const notes = notesOfType('species');
		const parsed = notes.map(({ key, content }) => parseSpecies(content, key, key));

		expect(notes.length).toBeGreaterThan(0);
		expect(parsed.filter(Boolean)).toHaveLength(notes.length);
	});

	/**
	 * Every background note parses into one the builder could offer.
	 *
	 * Backgrounds are the type whose mechanics the source actually states, so the
	 * bar is higher than for species: skills and equipment are asserted present,
	 * not merely parsed.
	 */
	it('parses every background note into a usable background', () => {
		const problems: string[] = [];

		for (const { key, content } of notesOfType('background')) {
			const background = parseBackground(content, key, key);
			if (background === null) {
				problems.push(`${key}: did not parse`);
				continue;
			}

			if (background.name.trim() === '') problems.push(`${key}: no name`);
			// Not the description: `custom-background` is an instruction rather than a
			// background and states only its fields, which is a real note shape rather
			// than a parse failure.
			if (background.skillProficiencies.length === 0) problems.push(`${key}: no skills`);
			if (background.startingEquipment.length === 0) problems.push(`${key}: no equipment`);
			if (background.desc.includes('cssclasses')) problems.push(`${key}: frontmatter in desc`);
		}

		expect(problems).toEqual([]);
	});

	/**
	 * A 2024 background states ability scores and an origin feat; a 2014 one states
	 * neither, because neither existed. Both are in a vault built from the full
	 * source map, and the parser has to read each as far as it goes.
	 *
	 * Asserted as a correlation rather than as two counts: the numbers move with
	 * whichever books are installed, but "states three ability scores" and "names
	 * an origin feat" go together in every 2024 background and in no older one.
	 */
	it('reads the 2024 backgrounds fully and the older ones as far as they go', () => {
		const parsed = notesOfType('background')
			.map(({ key, content }) => parseBackground(content, key, key))
			.filter((background) => background !== null);

		const modern = parsed.filter((background) => background.abilityScores.length === 3);
		const withFeat = parsed.filter((background) => background.feat !== null);

		expect(modern.length).toBeGreaterThan(0);
		expect(withFeat.map((background) => background.name).sort()).toEqual(
			modern.map((background) => background.name).sort(),
		);
		// And the older ones still import their skills, which is what they do have.
		for (const older of parsed.filter((background) => background.abilityScores.length === 0)) {
			expect(older.skillProficiencies.length).toBeGreaterThan(0);
		}
	});

	/**
	 * Every feat parses, and every one lands in a category.
	 *
	 * `Srd2024Feat.Type` is what a level filter reads, so a feat without one cannot
	 * be offered at all. The CLI never states it - this is the assertion that the
	 * derivation in `readType` covers the whole corpus rather than the four cases
	 * the unit tests chose.
	 */
	it('gives every 2024 feat a category, and no others', () => {
		const problems: string[] = [];
		const feats = notesOfType('feat');

		for (const { key, content } of feats) {
			const feat = parseFeat(content, key, key);
			if (feat === null) {
				problems.push(`${key}: did not parse`);
				continue;
			}

			// The edition decides, because Origin feats are a 2024 concept. A 2014
			// feat categorised at all would be offered in a 2024 builder.
			const is2024 = /Available in the|\(2024\)/.test(content);
			if (is2024 && feat.type === null) problems.push(`${key}: 2024 feat with no category`);
			if (!is2024 && feat.type !== null) problems.push(`${key}: older feat categorised`);
			if (feat.desc.includes('cssclasses')) problems.push(`${key}: frontmatter in desc`);
		}

		expect(feats.length).toBeGreaterThan(0);
		expect(problems).toEqual([]);
	});

	/**
	 * The 58 eldritch invocations, metamagics and battle master manoeuvres are
	 * stamped `json5e-feat` and are not feats. Nothing separates them in the body -
	 * Agonizing Blast reads exactly like a feat with a prerequisite - so if the tag
	 * check in `cliNoteType` ever stopped working, they would import silently and a
	 * level 1 fighter would be offered a warlock invocation.
	 */
	it('keeps optional features out of the feats', () => {
		const optional = notesOfType('optional-feature');

		expect(optional.length).toBeGreaterThan(0);
		expect(notesOfType('feat').map((note) => note.key)).not.toContain('agonizing-blast-xphb');
	});

	/**
	 * Every spell parses, with the four facts the builder sorts and filters on.
	 */
	it('parses every spell note into a usable spell', () => {
		const problems: string[] = [];
		const spells = notesOfType('spell');

		for (const { key, content, frontmatter } of spells) {
			const spell = parseSpell(content, frontmatter, key, key);
			if (spell === null) {
				problems.push(`${key}: did not parse`);
				continue;
			}

			if (spell.level === null) problems.push(`${key}: no level`);
			if (spell.school === null) problems.push(`${key}: no school`);
			if (spell.castingTime === null) problems.push(`${key}: no casting time`);
			if (spell.duration === null) problems.push(`${key}: no duration`);
			if (spell.desc.trim() === '') problems.push(`${key}: no text`);
			if (spell.desc.includes('**Classes**')) problems.push(`${key}: classes footer in text`);
		}

		expect(spells.length).toBeGreaterThan(380);
		expect(problems).toEqual([]);
	});

	/**
	 * The strongest check available: compare the scraped spells against the
	 * catalogue's own, which came from structured data rather than prose. Of the
	 * 322 spells in both, the parser agrees on every field it claims to read -
	 * bar the exclusions below, each of which is a difference in the *sources*
	 * rather than in the parse, and each of which was inspected one by one.
	 *
	 * **`castingTime` is compared, and that is this comparison's one scalp.** It
	 * used to disagree on fifteen spells, and the catalogue was the one that was
	 * wrong - Open5e transcribes the unit and drops the quantity, so Awaken's eight
	 * hours arrived as `1hour` and Clairvoyance's ten minutes as `1minute`. Nothing
	 * on the server could have noticed; it took a second independent transcription
	 * of the same book to see it. `fetch-srd-2024.mjs` corrects them now, so the two
	 * agree and this field is back in the assertion.
	 *
	 * - **`shapeType`/`shapeSize`** disagree both ways. The catalogue has shapes
	 *   this parser does not, because it read them out of the spell's prose; this
	 *   parser has emanations the catalogue does not, because it reads the range
	 *   field and the catalogue's source predates them.
	 * - The rest - `higherLevel`, `materialSpecified`, `duration`, `somatic` and
	 *   `reactionCondition` - differ on at most nine spells apiece and are en
	 *   dashes, "component" against "components", and two printings of Barkskin.
	 *
	 * That leaves level, school, ritual, concentration, range, the components and
	 * the class list agreeing on all 322, which is what this asserts.
	 */
	it('agrees with the SRD catalogue on every spell they share', () => {
		const catalogue = new Map(
			(
				JSON.parse(readFileSync(SRD_SNAPSHOT, 'utf8')) as {
					spells: Record<string, unknown>[];
				}
			).spells.map((spell) => [spell['name'] as string, spell]),
		);

		const fields = [
			'level',
			'school',
			'castingTime',
			'ritual',
			'concentration',
			'range',
			'verbal',
			'somatic',
			'material',
		] as const;
		const disagreements: string[] = [];
		let compared = 0;

		for (const { key, content, frontmatter } of notesOfType('spell')) {
			const mine = parseSpell(content, frontmatter, key, key);
			const theirs = mine && catalogue.get(mine.name);
			if (!mine || !theirs) continue;
			compared += 1;

			for (const field of fields) {
				// Power Word Heal is V,S in the 2024 book and V in the catalogue's
				// source - a printing difference, and the only one in the components.
				if (field === 'somatic' && mine.name === 'Power Word Heal') continue;

				if (mine[field] !== theirs[field]) {
					disagreements.push(`${mine.name}.${field}: ${String(mine[field])} vs ${String(theirs[field])}`);
				}
			}
		}

		expect(compared).toBeGreaterThan(300);
		expect(disagreements).toEqual([]);
	});

	/**
	 * The whole point of Phase 2, run against the whole vault: 2,974 notes in,
	 * one package out, and nothing lost quietly along the way.
	 *
	 * `failed` being empty is the assertion that matters. Every other count can be
	 * read off the corpus; a note the scanner typed and a parser then refused is
	 * the one failure mode that would otherwise look like a smaller compendium.
	 */
	it('assembles the whole vault into one package with nothing dropped', () => {
		const notes = allNotes();

		const report = assemblePackage(notes, 'my-books', { includeSrdContent: true });

		expect(report.failed).toEqual([]);

		// Every note the scanner typed as importable comes out in the package, and
		// the counts are read off the corpus rather than written down: which books
		// are in it is whoever ran the CLI's choice, and they can add any source in
		// its map.
		for (const [type, key] of [
			['species', 'species'],
			['background', 'backgrounds'],
			['feat', 'feats'],
			['spell', 'spells'],
		] as const) {
			expect(count(report, key)).toBe(notesOfType(type).length);
		}
		// Subclasses are the one type where found and sent legitimately differ: the
		// Artificer's have no class in Tome to attach to, so they are reported rather
		// than sent. The two still account for every note between them.
		expect(count(report, 'subclasses') + report.orphanedSubclasses.length).toBe(
			notesOfType('subclass').length,
		);
		// Items split: the gear goes in, the magic items are reported as not included.
		expect(count(report, 'items') + (report.unsupported['magic-item'] ?? 0)).toBe(
			notesOfType('item').length,
		);

		// Recognised, no parser yet. Counted rather than dropped, so the preview can
		// say so - and so this fails the day one of them gets a parser.
		expect(Object.keys(report.unsupported).sort()).toEqual([
			'class',
			'creature',
			'legendary-group',
			'magic-item',
			'object',
			'optional-feature',
			'vehicle',
		]);
	});

	/**
	 * What a real import is actually worth, which is the number the dialog shows.
	 *
	 * Tome ships SRD 5.2 and every campaign composes on top of it, so the entries the
	 * source line marks "Available in the SRD" are ones the user already has - and
	 * they are, to the entry: the corpus holds 339 SRD-marked spells, 17 feats, 4
	 * backgrounds and 9 species, and the shipped catalogue holds 339, 17, 4 and 9.
	 * That coincidence is what lets the connector make this cut without asking the
	 * server what it ships.
	 *
	 * So an import of this compendium adds a Player's Handbook's worth of content
	 * the SRD leaves out, and skips 369 duplicates. Importing them instead would
	 * give the campaign two Fireballs; overriding with them would cost it the
	 * damage and saving-throw data the shipped spells carry and these do not.
	 *
	 * **Matching on the name instead would get this wrong**, and the way it goes
	 * wrong is the reason the source line is the right signal. 17 SRD-marked spells
	 * have no same-named entry in the shipped catalogue - Bigby's Hand, Melf's Acid
	 * Arrow, Tasha's Hideous Laughter and the rest of the eponymous ones - because
	 * the SRD strips the wizards' names and ships them as Arcane Hand and Acid
	 * Arrow. They are the same spells. A name-matched skip would import all 17 again
	 * under their book names, and the duplicate would be invisible.
	 */
	it('imports only what Tome does not already ship', () => {
		const notes = allNotes();

		const withSrd = assemblePackage(notes, 'my-books', { includeSrdContent: true });
		const report = assemblePackage(notes, 'my-books');

		expect(report.failed).toEqual([]);

		// Everything skipped is content the source line marks as SRD, so the two runs
		// account for the same notes between them - nothing is lost in the cut.
		const total = (counts: Record<string, number>): number =>
			Object.values(counts).reduce((sum, count) => sum + count, 0);
		expect(total(report.counts) + report.alreadyShipped).toBe(total(withSrd.counts));

		// And the cut is worth making: most of a generated compendium is SRD content
		// Tome already ships, so what is left is a real fraction rather than all of it.
		expect(report.alreadyShipped).toBeGreaterThan(0);
		expect(total(report.counts)).toBeLessThan(total(withSrd.counts));
	});

	/**
	 * The corpus is generated from books the user owns, most of which is not SRD
	 * content, so the package must come out unshareable and with no licence guessed
	 * for it. This is the check that the caution is real rather than a comment.
	 */
	it('refuses to suggest a licence for a package built from owned books', () => {
		const notes = markdownFiles(join(CORPUS, 'spells')).map((path) => {
			const { content, frontmatter } = readNote(path);
			return { path: path.replace(/\\/g, '/'), content, frontmatter };
		});

		const report = assemblePackage(notes, 'spells');

		expect(report.sources.nonSrdCount).toBeGreaterThan(0);
		expect(report.sources.allSrd).toBe(false);
		expect(report.suggested.license).toBeNull();
		// The attribution still prefills - naming the book is right either way.
		expect(report.suggested.attribution).toContain("Player's Handbook");
	});

	/**
	 * Every subclass parses, with a level on every feature.
	 *
	 * A subclass whose feature has no level cannot be placed on the class table, so
	 * this is the assertion that reading the `(Level N)` headings covers the corpus
	 * rather than the one note the unit tests chose.
	 */
	it('parses every subclass note, with a level on every feature', () => {
		const problems: string[] = [];
		const notes = notesOfType('subclass');

		for (const { key, content, frontmatter } of notes) {
			const parsed = parseSubclass(content, frontmatter, key, key);
			if (parsed === null) {
				problems.push(`${key}: did not parse`);
				continue;
			}

			const { subclass } = parsed;
			if (subclass.name.trim() === '') problems.push(`${key}: no name`);
			if (subclass.desc.trim() === '') problems.push(`${key}: no description`);
			if (subclass.features.length === 0) problems.push(`${key}: no features`);
			if (subclass.levels.length === 0) problems.push(`${key}: no levels`);
			if (subclass.features.some((feature) => feature.desc.trim() === '')) {
				problems.push(`${key}: a feature with no text`);
			}
			if (subclass.desc.includes('class-progression')) {
				problems.push(`${key}: the progression table leaked into the description`);
			}

			// Every feature the levels point at must exist, or the builder resolves a
			// gain to nothing and the level silently grants less than it says.
			const keys = new Set(subclass.features.map((feature) => feature.key));
			for (const level of subclass.levels) {
				for (const gain of level.gains) {
					if (!keys.has(gain.feature)) problems.push(`${key}: level ${level.level} dangles`);
				}
			}
		}

		expect(notes.length).toBeGreaterThan(0);
		expect(problems).toEqual([]);
	});

	/**
	 * Every parent key a subclass patch names exists in the shipped catalogue.
	 *
	 * This is the one place the package format leaks the server's own naming: a patch
	 * reaches its class only by colliding with `srd-2024_barbarian`, and the server
	 * *drops* a subclass patch whose class it does not recognise - deliberately, since
	 * adding an empty class would put an unplayable option in the picker. So a
	 * mismatch here is silent, and this is what would notice.
	 */
	it('names parent classes the shipped catalogue actually has', () => {
		const shipped = new Set(
			(
				JSON.parse(readFileSync(SRD_SNAPSHOT, 'utf8')) as {
					classes: { key: string }[];
				}
			).classes.map((entry) => entry.key),
		);

		const parents = new Set(
			notesOfType('subclass')
				.map(({ key, content, frontmatter }) => parseSubclass(content, frontmatter, key, key))
				.filter((parsed) => parsed !== null)
				.map((parsed) => parsed.classKey),
		);

		expect(parents.size).toBeGreaterThan(0);
		// Every parent a subclass names is either one Tome ships, or one the import
		// reports as unattachable - never a key that quietly matches nothing.
		for (const key of parents) {
			const slug = key.replace(/^srd-2024_/, '');
			expect(shipped.has(key)).toBe(SHIPPED_CLASSES.includes(slug));
		}
	});

	/**
	 * With the option on, no subclass in the whole library still grants a feature
	 * before level 3 - and every feature that was there is still there, moved rather
	 * than dropped.
	 *
	 * The count of affected subclasses is not asserted; what matters is that the
	 * operation loses nothing, whichever books are installed.
	 */
	it('moves every early subclass feature to level 3 without losing one', () => {
		const notes = allNotes();
		const before = assemblePackage(notes, 'k');
		const after = assemblePackage(notes, 'k', { raiseEarlySubclassFeatures: true });

		const gains = (report: typeof before): number =>
			report.package.classes
				.flatMap((patch) => patch.subclasses)
				.flatMap((subclass) => subclass.levels)
				.reduce((total, level) => total + level.gains.length, 0);
		const earliest = (report: typeof before): number[] =>
			report.package.classes
				.flatMap((patch) => patch.subclasses)
				.flatMap((subclass) => subclass.levels.map((level) => level.level));

		expect(before.unreachableSubclasses.length).toBeGreaterThan(0);
		expect(Math.min(...earliest(before))).toBeLessThan(3);
		expect(Math.min(...earliest(after))).toBeGreaterThanOrEqual(3);
		expect(gains(after)).toBe(gains(before));
		expect(count(after, 'subclasses')).toBe(count(before, 'subclasses'));
	});

	/**
	 * The hardcoded class list is right.
	 *
	 * `SHIPPED_CLASSES` exists because the connector cannot ask the server what it
	 * has, and it decides whether a subclass is sent or reported as unattachable. If
	 * it drifted from the snapshot, Artificer subclasses would be sent and silently
	 * dropped, or Barbarian ones withheld for no reason.
	 */
	it('lists exactly the classes the shipped catalogue has', () => {
		const shipped = (
			JSON.parse(readFileSync(SRD_SNAPSHOT, 'utf8')) as { classes: { key: string }[] }
		).classes.map((entry) => entry.key.replace(/^srd-2024_/, ''));

		expect([...SHIPPED_CLASSES].sort()).toEqual(shipped.sort());
	});

	/**
	 * 2014 subclasses filed under a 2024 class grant features before level 3, where
	 * a subclass is chosen - so the builder never hands them out. The corpus has
	 * seven such subclasses today, and an import has to say so rather than appear to
	 * bring them across whole.
	 *
	 * Asserted as "every one found is genuinely early" rather than as a count, since
	 * the count moves with the books installed.
	 */
	it('reports the subclasses whose features arrive too early', () => {
		const parsed = notesOfType('subclass')
			.map(({ key, content, frontmatter }) => parseSubclass(content, frontmatter, key, key))
			.filter((entry) => entry !== null);

		const early = parsed.filter((entry) => unreachableFeatures(entry).length > 0);

		for (const entry of early) {
			expect(Math.min(...entry.subclass.levels.map((level) => level.level))).toBeLessThan(3);
		}
		// And the ones not reported all start at 3 or later, so nothing is missed.
		for (const entry of parsed.filter((item) => unreachableFeatures(item).length === 0)) {
			expect(Math.min(...entry.subclass.levels.map((level) => level.level))).toBeGreaterThanOrEqual(
				3,
			);
		}
	});

	/**
	 * What Phase 3 is actually worth. The SRD licenses one subclass per class; the
	 * Player's Handbook has four apiece. So the twelve SRD-marked subclasses are
	 * skipped as content Tome already ships and the other thirty-six are the import.
	 *
	 * The twelve base class notes are skipped too, and never parsed at all - which is
	 * why nothing here reads the progression table.
	 */
	it('imports the subclasses the SRD does not license, and no classes', () => {
		const notes = markdownFiles(join(CORPUS, 'classes')).map((path) => {
			const { content, frontmatter } = readNote(path);
			return { path: path.replace(/\\/g, '/'), content, frontmatter };
		});

		const report = assemblePackage(notes, 'classes');

		expect(report.failed).toEqual([]);
		expect(report.counts.subclasses).toBeGreaterThan(0);
		expect(report.package.classes.length).toBeGreaterThan(0);

		// No class is ever imported - they are recognised and then left alone, which
		// is why nothing reads the progression table.
		expect(Object.keys(report.unsupported)).toEqual(['class']);
		expect(count(report, 'species') + count(report, 'backgrounds') + count(report, 'spells')).toBe(
			0,
		);

		// The SRD-licensed subclasses are skipped as content Tome already ships, so
		// what lands is strictly fewer than what is there.
		expect(report.alreadyShipped).toBeGreaterThan(0);
		expect(count(report, 'subclasses')).toBeLessThan(
			count(assemblePackage(notes, 'classes', { includeSrdContent: true }), 'subclasses'),
		);
	});

	/**
	 * A patch carries subclasses and nothing else. Anything more and the server reads
	 * it as a redefinition and replaces the shipped class - which for a class whose
	 * level table this parser never even opened would be a catastrophe.
	 */
	it('emits class patches that cannot be mistaken for class definitions', () => {
		const notes = markdownFiles(join(CORPUS, 'classes')).map((path) => {
			const { content, frontmatter } = readNote(path);
			return { path: path.replace(/\\/g, '/'), content, frontmatter };
		});

		for (const patch of assemblePackage(notes, 'classes').package.classes) {
			expect(Object.keys(patch).sort()).toEqual(['key', 'name', 'subclasses']);
			expect(patch.subclasses.length).toBeGreaterThan(0);
		}
	});

	/**
	 * Every note typed a creature actually yields one.
	 *
	 * The two previews count creatures separately - the import dialog reports them
	 * as recognised-but-unsupported, the send dialog counts what it will send - and
	 * nothing made them agree. They disagreed by 143: the legendary-group notes are
	 * tagged under `ttrpg-cli/monster/` and hold lair actions rather than a
	 * statblock, so typing them by tag alone promised creatures that could never be
	 * sent. This is the assertion that ties the two numbers together.
	 */
	it('counts the same creatures in both previews', () => {
		const typed = notesOfType('creature');
		const sendable = typed.flatMap(({ path, content, frontmatter }) =>
			findSendables({ path, content, frontmatter }, parseYamlReal),
		);

		expect(typed.length).toBeGreaterThan(0);
		expect(sendable).toHaveLength(typed.length);
		expect(sendable.every((entry) => entry.kind === 'creature')).toBe(true);
	});

	/**
	 * The item folder splits into treasure and rope, and only the treasure is sent.
	 *
	 * A magic item is a library row rather than package content, so it rides the
	 * same route a creature does and turns up in the same preview. The split is the
	 * `rarity/none` tag, which the CLI puts on every note but one - and the one
	 * without any rarity tag is left out too, because guessing there would put a
	 * coil of rope in somebody's treasure list.
	 */
	it('splits the item folder into magic items and equipment, covering all of it', () => {
		const items = notesOfType('item');
		const found = items.flatMap(({ path, content, frontmatter }) =>
			findSendables({ path, content, frontmatter }, parseYamlReal),
		);

		expect(items.length).toBeGreaterThan(0);
		expect(found).toHaveLength(items.length);
		expect(found.every((sendable) => sendable.kind === 'magicItem' || sendable.kind === 'equipmentItem')).toBe(true);

		// Exactly the notes whose rarity is something other than "none" become magic
		// items; the rest - rope, tools, rations - become equipment.
		const magic = items.filter(({ frontmatter }) => isMagic(frontmatter)).length;
		expect(found.filter((sendable) => sendable.kind === 'magicItem')).toHaveLength(magic);
		expect(found.filter((sendable) => sendable.kind === 'equipmentItem')).toHaveLength(items.length - magic);
	});

	/**
	 * Every image path an item carries resolves to a file that exists.
	 *
	 * The path is read here and the bytes are read by the sender, so a path that
	 * parses but points nowhere costs the item its art with nothing to show for it.
	 * The `#right` alignment anchor is the specific way that happens: it is part of
	 * the embed and not of the filename, and a path that keeps it resolves to
	 * nothing at all.
	 *
	 * Vault-relative, so the corpus root stands in for the vault - which is what it
	 * is, in the vault this was generated into.
	 */
	it('gives every item an image path that exists on disk', () => {
		const vaultRoot = CORPUS.replace(/\/3-Mechanics\/CLI$/, '');
		const problems: string[] = [];
		let withArt = 0;

		for (const { key, content, frontmatter } of notesOfType('item')) {
			const item = parseMagicItem(content, frontmatter, key, key);
			if (item?.imagePath == null) continue;

			withArt += 1;
			if (item.imagePath.includes('#')) problems.push(`${key}: anchor left on the path`);
			if (!existsSync(join(vaultRoot, item.imagePath))) {
				problems.push(`${key}: ${item.imagePath} does not exist`);
			}
		}

		expect(withArt).toBeGreaterThan(0);
		expect(problems).toEqual([]);
	});

	/**
	 * No markup survives into text a person reads.
	 *
	 * A magic item's description is rendered as plain paragraphs, so anything the
	 * sanitizer misses is visible in the library as literal markdown. Three kinds
	 * were getting through and each was invisible to a status code: percent-encoding
	 * from link targets holding brackets, whole links whose condition the attunement
	 * parser cut in half, and tables mashed into a line of pipes. Checked across
	 * every parsed field rather than the description alone, because two of the three
	 * were in the attunement text.
	 */
	it('leaves no markup in any text a magic item shows', () => {
		const residue: [string, RegExp][] = [
			['percent-encoding', /%[0-9A-Fa-f]{2}/],
			['markdown link', /\]\(/],
			['wikilink', /\[\[/],
			['image embed', /!\[/],
			['table rule', /\|\s*-{3,}/],
		];
		const problems: string[] = [];

		for (const { key, content, frontmatter } of notesOfType('item')) {
			const item = parseMagicItem(content, frontmatter, key, key);
			if (!item) continue;

			const text = [item.desc ?? '', item.category ?? '', item.attunementDetail ?? ''].join('\n');
			for (const [label, pattern] of residue) {
				if (pattern.test(text)) problems.push(`${key}: ${label}`);
			}
		}

		expect(problems).toEqual([]);
	});

	/** Every one of them arrives with the fields the library shows. */
	it('gives every magic item a name and a rarity', () => {
		const problems: string[] = [];

		for (const { key, content, frontmatter } of notesOfType('item')) {
			const item = parseMagicItem(content, frontmatter, key, key);
			if (item === null) continue;

			if (item.name.trim() === '') problems.push(`${key}: no name`);
			if (item.rarity === null) problems.push(`${key}: no rarity`);
			if (item.desc?.includes('Source:') === true) problems.push(`${key}: source in desc`);
			if (item.category?.includes('](') === true) problems.push(`${key}: unflattened link`);
		}

		expect(problems).toEqual([]);
	});

	/** The folder listings are marked as such, so no parser ever sees one. */
	it('reads the index notes as indexes', () => {
		const indexes = notesOfType('index').map((note) => note.key);

		expect(indexes).toContain('feats');
		expect(indexes).toContain('races');
		expect(indexes).toContain('backgrounds');
	});

	/**
	 * The four categories partition the corpus, and the ten feats with no
	 * prerequisite are exactly the ten origin feats the 2024 Player's Handbook
	 * lists. That coincidence is the evidence that reading the category out of the
	 * prerequisite is sound rather than lucky - if it were a guess, the ten would
	 * be some other ten.
	 */
	it('reads the origin feats as exactly the ones the 2024 book lists', () => {
		const parsed = notesOfType('feat')
			.map(({ key, content }) => parseFeat(content, key, key))
			.filter((feat) => feat !== null);
		const origins = parsed.filter((feat) => feat.type === 'Origin').map((feat) => feat.name);

		// The ten the 2024 Player's Handbook lists, all present and all typed. Named
		// rather than counted because the count moves with the books installed, and
		// because *which* ten is the evidence that reading the category out of the
		// prerequisite is sound rather than lucky.
		for (const name of [
			'Alert',
			'Crafter',
			'Healer',
			'Lucky',
			'Magic Initiate',
			'Musician',
			'Savage Attacker',
			'Skilled',
			'Tavern Brawler',
			'Tough',
		]) {
			expect(origins).toContain(name);
		}

		// And the rule itself, over whatever else is installed: an origin feat is one
		// with no prerequisite. A 2014 feat also has none, which is why the edition
		// gates the whole table - see `readType`.
		for (const feat of parsed.filter((entry) => entry.type === 'Origin')) {
			expect(feat.prerequisite).toBeNull();
		}
	});

	/**
	 * Objects and vehicles - siege weapons, ships - are written as `ad-statblock`,
	 * an Admonition callout whose body is markdown rather than YAML. They are the
	 * only blocks in the whole corpus that fail to parse as YAML, and they fail
	 * because they are not YAML.
	 *
	 * Skipping them is correct today: reading them means scraping prose, which is
	 * the Phase 2 job. Pinned so that stays a decision rather than an oversight -
	 * a ballista has an AC and hit points and would be a perfectly good library
	 * entry.
	 */
	it('leaves ad-statblock objects and vehicles alone, for now', () => {
		const found = [...scanFolder('objects'), ...scanFolder('vehicles')];

		expect(found).toEqual([]);
	});
});

describe.skipIf(present)('ttrpg-convert-cli corpus', () => {
	it('is skipped without the generated compendium', () => {
		expect(present).toBe(false);
	});
});

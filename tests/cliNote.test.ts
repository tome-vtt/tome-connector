import { describe, expect, it } from 'vitest';

import { cliNoteType, isImportable } from '../src/recognizers/compendium/cliNote';

describe('cliNoteType', () => {
	it.each([
		['json5e-monster', 'creature'],
		['json5e-race', 'species'],
		['json5e-background', 'background'],
		['json5e-feat', 'feat'],
		['json5e-spell', 'spell'],
		['json5e-item', 'item'],
		['json5e-class', 'class'],
	])('reads %s as %s', (cssClass, expected) => {
		expect(cliNoteType({ cssclasses: [cssClass] })).toBe(expected);
	});

	/**
	 * Eldritch invocations, metamagic and battle master manoeuvres are stamped
	 * `json5e-feat` and are not feats - 58 of the corpus's 135 feat-classed notes.
	 * Nothing in the body separates them, so the tag is the only signal, and
	 * getting it wrong offers Agonizing Blast to a level 1 fighter.
	 */
	it('reads an optional feature as one, despite the feat class', () => {
		const type = cliNoteType({
			cssclasses: ['json5e-feat'],
			tags: ['ttrpg-cli/compendium/src/5e/xphb', 'ttrpg-cli/optional-feature/ei'],
		});

		expect(type).toBe('optional-feature');
	});

	/** Subclasses share `json5e-class` with their parent; the tag is what splits them. */
	it('separates a subclass from its class', () => {
		const subclass = cliNoteType({
			cssclasses: ['json5e-class'],
			tags: ['ttrpg-cli/subclass/barbarian/path-of-the-berserker'],
		});

		expect(subclass).toBe('subclass');
		expect(cliNoteType({ cssclasses: ['json5e-class'], tags: ['ttrpg-cli/class'] })).toBe('class');
	});

	/**
	 * A `ttrpg-convert-cli` upgrade moved every creature from
	 * `cssclasses: json5e-monster` onto `json5e-object` - the class a siege weapon
	 * already used - and left the tags alone. A vault regenerated with the newer
	 * version has hundreds of creatures the class reads as objects.
	 */
	it('reads a creature by its tag when the class calls it an object', () => {
		const type = cliNoteType({
			cssclasses: ['json5e-object'],
			tags: ['ttrpg-cli/compendium/src/5e/xphb', 'ttrpg-cli/monster/type/aberration'],
		});

		expect(type).toBe('creature');
	});

	/**
	 * A legendary group is lair actions and regional effects shared by a family of
	 * monsters, and has no statblock in it. It is tagged under `monster/` and classed
	 * `json5e-note`, so the tag alone reads it as a creature - which made a preview
	 * promise 4,033 creatures where 3,890 could be sent.
	 */
	it('does not read a legendary group as a creature', () => {
		const type = cliNoteType({
			cssclasses: ['json5e-note'],
			tags: ['ttrpg-cli/compendium/src/5e/xmm', 'ttrpg-cli/monster/legendary-group'],
		});

		expect(type).toBe('legendary-group');
	});

	/** And an actual object, sharing that class, is still an object. */
	it('tells a siege weapon from a creature', () => {
		const type = cliNoteType({
			cssclasses: ['json5e-object'],
			tags: ['ttrpg-cli/object/size/large', 'ttrpg-cli/object/type/siege-weapon'],
		});

		expect(type).toBe('object');
	});

	/** An older vault still reads correctly, which is why the stale class stays mapped. */
	it('still reads a creature from an older vault', () => {
		expect(cliNoteType({ cssclasses: ['json5e-monster'] })).toBe('creature');
	});

	/** A folder listing carries `json5e-note` too, and is not one. */
	it('reads an index as an index', () => {
		expect(cliNoteType({ cssclasses: ['json5e-note', 'json5e-index'] })).toBe('index');
	});

	it.each([
		[null],
		[{}],
		[{ cssclasses: ['json5e-note'] }],
		[{ cssclasses: 'something-else' }],
	])('is null for %o', (frontmatter) => {
		expect(cliNoteType(frontmatter)).toBeNull();
	});

	/** Obsidian gives back a bare string when the user wrote one. */
	it('accepts cssclasses written as a string', () => {
		expect(cliNoteType({ cssclasses: 'json5e-monster' })).toBe('creature');
	});
});

describe('isImportable', () => {
	it.each([['species'], ['background'], ['feat'], ['spell'], ['subclass'], ['item']] as const)(
		'%s has a parser',
		(type) => {
			expect(isImportable(type)).toBe(true);
		},
	);

	/**
	 * **A subclass is importable and its class is not**, which looks inconsistent and
	 * is the whole design. All twelve base classes in a generated compendium are SRD
	 * content Tome already ships, level tables and all; the subclasses beyond the one
	 * per class the SRD licenses are what a conversion actually adds. So a subclass
	 * arrives as a patch to its parent and the class note is never read - which is
	 * also how the malformed progression table never gets parsed.
	 *
	 * An optional feature is recognised but never parsed. Keeping recognition and
	 * support apart is what lets a scan say "955 creatures, not included" - a preview
	 * that omits what it cannot handle reads as one that did not find it.
	 */
	it.each([
		['class'],
		['index'],
		['optional-feature'],
		['object'],
		['vehicle'],
	] as const)('%s is recognised but not importable', (type) => {
		expect(isImportable(type)).toBe(false);
	});

	it('is false for an unrecognised note', () => {
		expect(isImportable(null)).toBe(false);
	});
});

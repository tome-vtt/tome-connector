import { expect, it } from 'vitest';
import { assemblePackage, describeUnavailableFeats } from '../src/recognizers/compendium/package';
import { scanCompendium, uploadPackage } from '../src/contentImport';

const elvenAccuracy = {
	path: 'feats/elven-accuracy-xge.md',
	frontmatter: { cssclasses: ['json5e-feat'], tags: ['ttrpg-cli/feat'] },
	content: `# Elven Accuracy
*Source: Xanathar's Guide to Everything p. 74*

**Prerequisite**: Elf or half-elf

You gain the following benefits:

- Increase your Dexterity, Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.
- Whenever you have advantage, you can reroll one of the dice.`,
};

it('offers an older feat as General when the importer opts in', () => {
	const report = assemblePackage([elvenAccuracy], 'xge', { generalLegacyFeats: true });
	expect(report.package.feats[0]?.type).toBe('General');
});

it('adds a level-4 rule to an older feat without other prerequisites', () => {
	const note = { ...elvenAccuracy, content: '# Dungeon Delver\n*Source: Player\'s Handbook*\n\nYou spot traps.' };
	const feat = assemblePackage([note], 'phb', { generalLegacyFeats: true }).package.feats[0];
	expect(feat).toMatchObject({ type: 'General', prerequisite: '4th', prerequisiteRule: { kind: 'level', minimum: 4 } });
});

it('reads a "None" prerequisite as no prerequisite', () => {
	const note = { ...elvenAccuracy, content: elvenAccuracy.content.replace('Elf or half-elf', 'None') };
	const feat = assemblePackage([note], 'xge', { generalLegacyFeats: true }).package.feats[0];
	expect(feat).toMatchObject({ prerequisite: '4th', prerequisiteRule: { kind: 'level', minimum: 4 } });
});

it('checks both level 4 and an older feat\'s ability prerequisite', () => {
	const note = { ...elvenAccuracy, content: elvenAccuracy.content.replace('Elf or half-elf', 'Strength 13 or higher') };
	const feat = assemblePackage([note], 'phb', { generalLegacyFeats: true }).package.feats[0];
	expect(feat?.prerequisiteRule).toMatchObject({
		kind: 'all',
		children: [{ kind: 'level', minimum: 4 }, { kind: 'ability', ability: 'str', minimum: 13 }],
	});
});

it('sends an unlabelled ability increase as a benefit Tome can apply', () => {
	const feat = assemblePackage([elvenAccuracy], 'xge', { generalLegacyFeats: true }).package.feats[0];
	expect(feat?.benefits).toContainEqual({
		key: '1-ability-score-increase', name: 'Ability Score Increase', type: null,
		desc: 'Increase your Dexterity, Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.',
	});
});

it('reports how many imported feats will not be offered with the option off', () => {
	const report = assemblePackage([elvenAccuracy], 'xge');
	expect(report.unavailableFeats).toBe(1);
	expect(report.legacyFeats).toBe(1);
	expect(describeUnavailableFeats(report)).toBe('1 feat will not be offered when levelling up because it has no category.');
});

it('keeps uncheckable racial prerequisites visible instead of replacing them with a partial rule', () => {
	for (const prerequisite of ['Elf or half-elf', 'Halfling']) {
		const note = { ...elvenAccuracy, content: elvenAccuracy.content.replace('Elf or half-elf', prerequisite) };
		const feat = assemblePackage([note], 'xge', { generalLegacyFeats: true }).package.feats[0];
		expect(feat?.prerequisite).toBe(`4th; ${prerequisite}`);
		expect(feat?.prerequisiteRule).toBeNull();
	}
});

it('counts only included uncategorised feats and preserves 2024 categories', () => {
	const modern = { ...elvenAccuracy, content: '# Alert\n*Source: Player\'s Handbook (2024)*\n\nYou act quickly.' };
	const srd = { ...elvenAccuracy, content: elvenAccuracy.content.replace('p. 74*', 'p. 74. Available in the SRD*') };
	const report = assemblePackage([elvenAccuracy, modern, srd], 'mixed', { generalLegacyFeats: true });
	expect(report.package.feats.map((feat) => feat.type)).toEqual(['General', 'Origin']);
	expect(report.legacyFeats).toBe(1);
	expect(report.unavailableFeats).toBe(0);
	expect(describeUnavailableFeats(report)).toBe('');
});

it('carries the conversion from a vault scan into the uploaded package and can turn it off again', async () => {
	const scan = await scanCompendium({
		paths: () => [elvenAccuracy.path], tags: () => [],
		read: () => Promise.resolve(elvenAccuracy),
	}, { kind: 'vault' });
	const report = scan.assemble({ generalLegacyFeats: true });
	let body = '';
	await uploadPackage((_path, bytes) => {
		body = new TextDecoder().decode(bytes);
		return Promise.resolve({ ok: true, status: 200, id: null, message: null, retryable: false });
	}, { key: 'xge', name: 'Xanathar', license: 'own-work' }, report);
	expect(body).toContain('"type":"General"');
	expect(body).toContain('"name":"Ability Score Increase"');
	expect(scan.assemble({}).package.feats[0]?.type).toBeNull();
	expect(scan.assemble({}).unavailableFeats).toBe(1);
});

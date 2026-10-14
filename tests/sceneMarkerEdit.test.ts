import { describe, expect, it } from 'vitest';

import { sceneMarkerEdit } from '../src/adventure/sceneMarkerEdit';

const NOTE = ['Intro text', '## Hall', 'Body', '## Crypt', 'More', ''];
const ALL = [{ id: 'pre' }, { id: 'a' }, { id: 'b' }];

describe('sceneMarkerEdit', () => {
	it('marks only the named heading lines, leaving the rest alone', () => {
		const out = sceneMarkerEdit(true, ALL)(NOTE.join('\n'));
		expect(out.split('\n')).toEqual([
			'Intro text',
			'## Hall %%tome_scene_id: a%%',
			'Body',
			'## Crypt %%tome_scene_id: b%%',
			'More',
			'',
		]);
	});

	it('keeps CRLF endings', () => {
		expect(sceneMarkerEdit(true, ALL)(NOTE.join('\r\n'))).toBe(
			'Intro text\r\n## Hall %%tome_scene_id: a%%\r\nBody\r\n## Crypt %%tome_scene_id: b%%\r\nMore\r\n',
		);
	});

	it('leaves other lines endings alone in a mixed note', () => {
		const out = sceneMarkerEdit(true, ALL.slice(0, 2))('Intro\n## Hall\r\nBody\n');
		expect(out).toBe('Intro\n## Hall %%tome_scene_id: a%%\r\nBody\n');
	});

	it('skips scenes with no result', () => {
		const out = sceneMarkerEdit(true, ALL.slice(0, 2))(NOTE.join('\n'));
		expect(out).toContain('## Hall %%tome_scene_id: a%%');
		expect(out).toContain('\n## Crypt\n');
	});

	it('leaves the note unchanged with no results', () => {
		expect(sceneMarkerEdit(true, [])(NOTE.join('\n'))).toBe(NOTE.join('\n'));
	});
});

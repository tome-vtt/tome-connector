import { sceneHeadingLines, withSceneIdMarker } from './adventureParser';
import type { ImportedSceneResultBody } from './adventurePlan';

/**
 * Builds the pure text edit that writes each scene's id onto its own heading
 * line, for `writeAdventureIdsToVault.ts` to apply inside `vault.process`.
 *
 * Rewrites only the heading lines `sceneHeadingLines` names, splicing into the
 * note's exact original text rather than splitting and rejoining on `\n` -
 * that would silently normalise every other line's ending too, turning one
 * marker write into a whole-file diff for a Windows-authored note.
 */
export function sceneMarkerEdit(
	promoteRooms: boolean,
	sceneResults: ImportedSceneResultBody[],
): (content: string) => string {
	return (content) => {
		const headingLines = sceneHeadingLines(content, promoteRooms);
		// Odd indices are the line terminators themselves, kept so nothing but the
		// targeted lines' own text changes.
		const parts = content.split(/(\r?\n)/);

		for (const [sceneIndex, lineIndex] of headingLines.entries()) {
			if (lineIndex === null) continue;
			const sceneResult = sceneResults[sceneIndex];
			const partIndex = lineIndex * 2;
			const line = parts[partIndex];
			if (!sceneResult || line === undefined) continue;
			parts[partIndex] = withSceneIdMarker(line, sceneResult.id);
		}

		return parts.join('');
	};
}

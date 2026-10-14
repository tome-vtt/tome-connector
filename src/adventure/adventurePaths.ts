/** The last `/`-separated segment of a vault path. */
export function basename(path: string): string {
	return path.split('/').pop() ?? path;
}

/** {@link basename} without its trailing `.ext`. */
export function stem(path: string): string {
	return basename(path).replace(/\.[^./]+$/, '');
}

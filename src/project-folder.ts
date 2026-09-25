/**
 * Project folders are named "<order>-<slug>", e.g. "4-tidewater": the number sets where the
 * project is listed (highest first), the rest is its URL slug (/work/tidewater/).
 * Pure, so the content config can use it too.
 */

const FOLDER = /^(?:(\d+)-)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;

export interface ProjectFolder {
  /** Null when the folder has no number: listed after the numbered ones. */
  order: number | null;
  slug: string;
}

export function parseFolder(name: string): ProjectFolder {
  const m = FOLDER.exec(name);
  if (!m)
    throw new Error(
      `project folder "${name}": use "<number>-<slug>" in lowercase letters, digits and dashes, e.g. "4-tidewater"`,
    );
  return { order: m[1] === undefined ? null : Number(m[1]), slug: m[2]! };
}

/** The project's folder name, from its index.md path. */
export function folderOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  const folder = parts.at(-2);
  if (!folder || parts.at(-1) !== "index.md")
    throw new Error(`not a project index file: ${filePath}`);
  return folder;
}

/** Highest number first; folders without a number come after, newest year first. */
export function compareProjects(
  a: { order: number | null; year: number },
  b: { order: number | null; year: number },
): number {
  if (a.order !== null && b.order !== null) return b.order - a.order;
  if (a.order !== null) return -1;
  if (b.order !== null) return 1;
  return b.year - a.year;
}

/** Two folders that would share one URL (e.g. "1-tidewater" and "2-tidewater"), or null. */
export function findSlugClash(folders: string[]): [string, string] | null {
  const seen = new Map<string, string>();
  for (const f of folders) {
    const { slug } = parseFolder(f);
    const other = seen.get(slug);
    if (other) return [other, f];
    seen.set(slug, f);
  }
  return null;
}

export interface PathLink {
  start: number;
  end: number;
  file: string;
  line?: number;
  column?: number;
}

const QUOTED = /"([^"\r\n]+)"|'([^'\r\n]+)'/g;
const ABSOLUTE = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|]+/g;
const RELATIVE = /(?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])+[\w.-]+/g;

export function findPathLinks(text: string): PathLink[] {
  const links: PathLink[] = [];
  const taken: Array<[number, number]> = [];
  const add = (start: number, raw: string): void => {
    const cleaned = raw.replace(/[.,;]+$/g, '');
    if (cleaned.length < 3 || !/[\\/]/.test(cleaned) || cleaned.includes('://')) return;
    if (text.slice(Math.max(0, start - 3), start).includes(':/')) return;
    const peeled = peelLocation(cleaned);
    if (!peeled.file || peeled.file === '.' || peeled.file === '..') return;
    let end = start + cleaned.length;
    let line = peeled.line;
    let column = peeled.column;
    if (!line) {
      const suffix = text.slice(end).match(/^(?::(\d+))(?::(\d+))?|^\((\d+)(?:,\s*(\d+))?\)/);
      if (suffix) {
        line = Number(suffix[1] ?? suffix[3]);
        const col = suffix[2] ?? suffix[4];
        column = col ? Number(col) : undefined;
        end += suffix[0].length;
      }
    }
    if (taken.some(([from, to]) => start < to && end > from)) return;
    taken.push([start, end]);
    links.push({ start, end, file: peeled.file, line, column });
  };

  for (const match of text.matchAll(QUOTED)) {
    const body = match[1] ?? match[2] ?? '';
    const offset = match.index + (match[0].startsWith(body) ? 0 : 1);
    if (looksLikePath(body)) add(offset, body);
  }
  for (const match of text.matchAll(ABSOLUTE)) add(match.index, match[0]);
  for (const match of text.matchAll(RELATIVE)) add(match.index, match[0]);
  return links.sort((a, b) => a.start - b.start);
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) && !value.includes('://');
}

function peelLocation(value: string): { file: string; line?: number; column?: number } {
  const paren = value.match(/^(.*)\((\d+)(?:,\s*(\d+))?\)$/);
  if (paren?.[1]) {
    return { file: paren[1], line: Number(paren[2]), column: paren[3] ? Number(paren[3]) : undefined };
  }
  const suffix = value.match(/^(.*?)(?::(\d+))(?::(\d+))?$/);
  if (suffix?.[1] && /[\\/]/.test(suffix[1])) {
    return { file: suffix[1], line: Number(suffix[2]), column: suffix[3] ? Number(suffix[3]) : undefined };
  }
  return { file: value };
}

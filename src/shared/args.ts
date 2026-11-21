export function commandLines(input: string): string[] {
  const lines: string[] = [];
  let current = '';
  let quote = '';
  for (const char of input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '\n') {
      if (current.trim()) lines.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export function splitArgs(input: string): string[] {
  const args: string[] = [];
  const source = input.trim();
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }
    const quote = source[index] === '"' || source[index] === "'" ? source[index] : '';
    if (quote) {
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (quote === '"' && source[index] === '\\' && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (source[index] === quote) {
        index += 1;
      }
      args.push(value);
      continue;
    }
    let value = '';
    while (index < source.length && !/\s/.test(source[index])) {
      value += source[index];
      index += 1;
    }
    args.push(value);
  }
  return args;
}

export function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return '';
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return '';
  return url.href;
}

export function commandExecutable(program: string): string {
  const lines = commandLines(program);
  const first = lines[0] ?? '';
  if (lines.length <= 1) return first;
  return splitArgs(first)[0] ?? first;
}

export function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteCmd(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

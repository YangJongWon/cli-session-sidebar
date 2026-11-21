import { t } from './i18n';
import { UserError } from './types';

export interface IconChoice {
  text: string;
  color: string;
  image?: string;
}

const PRESETS: Record<string, [string, string]> = {
  claude: ['C', '#bd775c'],
  codex: ['CX', '#75858a'],
  cursor: ['Cu', '#f54e00'],
  opencode: ['OC', '#7674d7'],
  antigravity: ['A', '#4c89d9'],
  devin: ['D', '#378d7a'],
  powershell: ['PS', '#407abd'],
  pwsh: ['7', '#2671be'],
  'git-bash': ['Gb', '#f05032'],
  cmd: ['>_', '#78828a'],
  zsh: ['Z', '#4eaa25'],
  brew: ['Hb', '#c74634'],
};

const ICON_IMAGE_LIMIT = 120_000;

export function automaticIcon(name: string, kind?: string): { text: string; color: string } {
  const preset = kind ? PRESETS[kind] : undefined;
  if (preset) return { text: preset[0], color: preset[1] };
  const label = name.trim();
  return { text: lettersFromName(label), color: colorFromName(label || 'cli') };
}

export function commandIcon(input: { name: string; kind?: string; iconText?: string; iconColor?: string; iconImage?: string }): IconChoice {
  const automatic = automaticIcon(input.name, input.kind);
  const text = normalizeIconText(input.iconText ?? '') || automatic.text;
  const color = normalizeIconColor(input.iconColor ?? '') || automatic.color;
  const image = normalizeIconImage(input.iconImage ?? '');
  return image ? { text, color, image } : { text, color };
}

export function iconOverrides(input: { name: string; kind?: string; iconText?: string; iconColor?: string; iconImage?: string }): { iconText?: string; iconColor?: string; iconImage?: string } {
  const automatic = automaticIcon(input.name, input.kind);
  const result: { iconText?: string; iconColor?: string; iconImage?: string } = {};
  const text = (input.iconText ?? '').trim();
  if (text) {
    const normalized = normalizeIconText(text);
    if (!normalized) throw new UserError(t('errBadIconText'));
    if (normalized !== automatic.text) result.iconText = normalized;
  }
  const color = (input.iconColor ?? '').trim();
  if (color) {
    const normalized = normalizeIconColor(color);
    if (!normalized) throw new UserError(t('errBadIconColor'));
    if (normalized !== automatic.color) result.iconColor = normalized;
  }
  const image = (input.iconImage ?? '').trim();
  if (image) {
    const normalized = normalizeIconImage(image);
    if (!normalized) throw new UserError(t('errBadIcon'));
    result.iconImage = normalized;
  }
  return result;
}

export function lettersFromName(name: string): string {
  const parts = name.trim().split(/[\s._/-]+/u).filter(Boolean);
  const chars = parts.length >= 2
    ? [Array.from(parts[0])[0], Array.from(parts[1])[0]].filter((item): item is string => Boolean(item))
    : Array.from(parts[0] ?? '').slice(0, 2);
  return chars.join('').toUpperCase() || '>';
}

export function normalizeIconText(value: string): string {
  const chars = Array.from(value.trim());
  if (chars.length === 0 || chars.length > 2 || chars.some((char) => /\s/u.test(char))) return '';
  return chars.join('');
}

export function normalizeIconColor(value: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : '';
}

export function normalizeIconImage(value: string): string {
  const compact = value.trim().replace(/\s/g, '');
  if (!compact || compact.length > ICON_IMAGE_LIMIT) return '';
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(compact)) return '';
  return compact;
}

function colorFromName(name: string): string {
  let hash = 0;
  for (const char of name) hash = Math.imul(hash, 31) + (char.codePointAt(0) ?? 0);
  return hslToHex(Math.abs(hash) % 360, 0.52, 0.42);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

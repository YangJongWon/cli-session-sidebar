import fs from 'fs';
import path from 'path';
import { isUiLanguage, t } from './shared/i18n';
import { SCHEMA_VERSION, UserError, emptyStore, type StoreData } from './shared/types';

export class JsonStore {
  data: StoreData;
  readonly loadError: string | null;
  readonly readOnly: boolean;

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.data = this.read();
      this.loadError = null;
      this.readOnly = false;
    } catch (error) {
      this.data = emptyStore();
      this.loadError = error instanceof Error ? error.message : String(error);
      this.readOnly = true;
    }
  }

  update(mutate: (data: StoreData) => void): StoreData {
    if (this.readOnly) {
      throw new UserError(this.loadError ?? t('errStoreProtected'));
    }
    const latest = this.read();
    mutate(latest);
    this.write(latest);
    this.data = latest;
    return latest;
  }

  private read(): StoreData {
    if (!fs.existsSync(this.file)) {
      return emptyStore();
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.preserveCorrupt();
      throw new UserError(t('errStoreRead'));
    }
    if (!parsed || typeof parsed !== 'object') {
      this.preserveCorrupt();
      throw new UserError(t('errStoreFormat'));
    }
    const record = parsed as Partial<StoreData>;
    if (record.schemaVersion !== SCHEMA_VERSION) {
      throw new UserError(t('errStoreVersion', { version: String(record.schemaVersion) }));
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      profiles: Array.isArray(record.profiles) ? record.profiles : [],
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
      activeSessionId: typeof record.activeSessionId === 'string' ? record.activeSessionId : null,
      hiddenTemplateIds: stringList(record.hiddenTemplateIds),
      removedTemplateIds: stringList(record.removedTemplateIds),
      uiLanguage: isUiLanguage(record.uiLanguage) ? record.uiLanguage : 'auto',
    };
  }

  private write(data: StoreData): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, this.file);
    } catch {
      fs.copyFileSync(tmp, this.file);
      fs.rmSync(tmp, { force: true });
    }
  }

  private preserveCorrupt(): void {
    const backup = `${this.file}.corrupt`;
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(this.file, backup);
    }
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

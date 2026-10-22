export interface FontRef { family: string; style: string; variationSettings?: Record<string, number> }
export type Scope = 'selection' | 'page' | 'pages' | 'document';
export interface ScanOptions {
  scope: Scope;
  pageIds?: string[];
  fastScan?: boolean;
  onlyNodeIds?: string[];
  includeHidden: boolean;
  includeLocked: boolean;
  includeInstances: boolean;
  includeComponents: boolean;
}
export interface FontUsage { key: string; font: FontRef; layers: number; ranges: number; missing: boolean; styled: boolean; sampleId?: string }
export interface Timings { scan?: number; plan?: number; load?: number; apply?: number; verification?: number }
export interface Inventory {
  id: string; options: ScanOptions; pageName: string; fonts: FontUsage[]; layers: number; ranges: number;
  scanned: number; skipped: Record<string, number>; excludedContainers?: Record<string, number>; duration: number;
}
export interface Mapping { source: string; target: FontRef }
export interface Review {
  id: string; inventoryId: string; layers: number; ranges: number; fontsToLoad: number; styledLayers: number;
  variableRanges: number; unmappedLayers: number; mappedStyles: number; unmappedStyles: number;
  mappings: Mapping[]; duration: number;
}
export interface Issue { id: string; name: string; reason: string; kind?: 'skipped' | 'failed' | 'verification' }
export interface Result {
  cancelled: boolean; changedLayers: number; changedRanges: number; verifiedRanges: number; verificationFailures: number;
  plannedLayers: number; processedLayers: number; remainingLayers: number; skippedLayers: number; failedLayers: number;
  issues: Issue[]; duration: number; timings: Timings; warning?: string; retryNodeIds?: string[];
}
export type Request = ({ type: 'INIT' } | { type: 'REFRESH_FONTS' } | { type: 'SCAN'; options: ScanOptions }
  | { type: 'PLAN'; inventoryId: string; mappings: Mapping[] } | { type: 'APPLY'; planId: string }
  | { type: 'CANCEL' } | { type: 'FOCUS'; id: string } | { type: 'SAVE_RECENTS'; families: string[] }
  | { type: 'RESIZE'; width: number; height: number }) & { requestId?: string };
export type Response = ({ type: 'CONTEXT'; selected: number; pageName: string; pages?: { id: string; name: string }[] }
  | { type: 'FONTS'; fonts: FontRef[] } | { type: 'RECENTS'; families: string[] }
  | { type: 'BUSY'; operation: 'scan' | 'plan' | 'apply' } | { type: 'PROGRESS'; stage: string; done: number; total: number }
  | { type: 'INVENTORY'; inventory: Inventory } | { type: 'REVIEW'; review: Review } | { type: 'RESULT'; result: Result }
  | { type: 'CANCELLED'; operation?: 'scan' | 'plan' } | { type: 'INVALIDATED'; reason: string }
  | { type: 'ERROR'; message: string; area?: 'startup' | 'operation' | 'navigation' }) & { requestId?: string };
export const defaultOptions: ScanOptions = { scope: 'page', fastScan: true, includeHidden: true, includeLocked: false, includeInstances: false, includeComponents: false };
export function fontKey(font: FontRef): string { return JSON.stringify([font.family, font.style, Object.entries(font.variationSettings || {}).sort(([a], [b]) => a.localeCompare(b))]); }
export function loadKey(font: FontRef): string { return JSON.stringify([font.family, font.style]); }
export function normalizedStyle(style: string): string { return style.toLowerCase().replace(/[\s_-]/g, ''); }
export function matchStyle(source: FontRef, targets: FontRef[]): FontRef | undefined {
  const exact = targets.find(f => f.style === source.style);
  if (exact) return exact;
  const candidates = targets.filter(f => normalizedStyle(f.style) === normalizedStyle(source.style));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function axisLabel(font: FontRef): string {
  const names: Record<string, string> = { wght: 'Weight', wdth: 'Width', slnt: 'Slant', ital: 'Italic', opsz: 'Optical size' };
  return Object.entries(font.variationSettings || {}).sort(([a], [b]) => a.localeCompare(b)).map(([tag, value]) => `${names[tag] || tag} ${value}`).join(' · ');
}
const record = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
export function isFont(value: unknown): value is FontRef {
  if (!record(value)) return false;
  return typeof value.family === 'string' && value.family.length > 0 && value.family.length < 512 && typeof value.style === 'string' && value.style.length > 0 && value.style.length < 512 &&
    (value.variationSettings === undefined || (record(value.variationSettings) && Object.entries(value.variationSettings).every(([k, v]) => /^[a-zA-Z0-9 ]{4}$/.test(k) && typeof v === 'number' && Number.isFinite(v))));
}
export function isOptions(o: unknown): o is ScanOptions {
  return record(o) && ['selection', 'page', 'pages', 'document'].includes(o.scope) &&
    ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents'].every(k => typeof o[k] === 'boolean') &&
    (o.fastScan === undefined || typeof o.fastScan === 'boolean') && (o.pageIds === undefined || (strings(o.pageIds) && o.pageIds.length < 10000)) && (o.onlyNodeIds === undefined || strings(o.onlyNodeIds));
}
export function isRequest(r: unknown): r is Request {
  if (!record(r) || (r.requestId !== undefined && (typeof r.requestId !== 'string' || r.requestId.length > 160))) return false;
  switch (r.type) {
    case 'INIT': case 'REFRESH_FONTS': case 'CANCEL': return true;
    case 'SAVE_RECENTS': return strings(r.families) && r.families.length <= 12;
    case 'FOCUS': return typeof r.id === 'string' && r.id.length < 256;
    case 'RESIZE': return Number.isFinite(r.width) && Number.isFinite(r.height);
    case 'APPLY': return typeof r.planId === 'string';
    case 'PLAN': return typeof r.inventoryId === 'string' && Array.isArray(r.mappings) && r.mappings.length < 10000 && r.mappings.every(m => record(m) && typeof m.source === 'string' && isFont(m.target));
    case 'SCAN': return isOptions(r.options);
    default: return false;
  }
}
export function isResponse(r: unknown): r is Response {
  if (!record(r) || (r.requestId !== undefined && typeof r.requestId !== 'string')) return false;
  switch (r.type) {
    case 'CONTEXT': return finite(r.selected) && typeof r.pageName === 'string' && (r.pages === undefined || (Array.isArray(r.pages) && r.pages.every(p => record(p) && typeof p.id === 'string' && typeof p.name === 'string')));
    case 'FONTS': return Array.isArray(r.fonts) && r.fonts.every(isFont);
    case 'RECENTS': return strings(r.families);
    case 'BUSY': return ['scan', 'plan', 'apply'].includes(r.operation);
    case 'PROGRESS': return typeof r.stage === 'string' && finite(r.done) && finite(r.total);
    case 'INVENTORY': return record(r.inventory) && typeof r.inventory.id === 'string' && typeof r.inventory.pageName === 'string' && isOptions(r.inventory.options) && ['layers', 'ranges', 'duration', 'scanned'].every(k => finite(r.inventory[k])) && record(r.inventory.skipped) && Object.values(r.inventory.skipped).every(finite) && (r.inventory.excludedContainers === undefined || (record(r.inventory.excludedContainers) && Object.values(r.inventory.excludedContainers).every(finite))) && Array.isArray(r.inventory.fonts) && r.inventory.fonts.every(f => record(f) && typeof f.key === 'string' && isFont(f.font) && finite(f.layers) && finite(f.ranges) && typeof f.missing === 'boolean' && typeof f.styled === 'boolean' && (f.sampleId === undefined || typeof f.sampleId === 'string'));
    case 'REVIEW': return record(r.review) && typeof r.review.id === 'string' && typeof r.review.inventoryId === 'string' && ['layers', 'ranges', 'fontsToLoad', 'styledLayers', 'variableRanges', 'unmappedLayers', 'mappedStyles', 'unmappedStyles', 'duration'].every(k => finite(r.review[k])) && Array.isArray(r.review.mappings) && r.review.mappings.every(m => record(m) && typeof m.source === 'string' && isFont(m.target));
    case 'RESULT': return record(r.result) && typeof r.result.cancelled === 'boolean' && ['changedLayers', 'changedRanges', 'verifiedRanges', 'verificationFailures', 'plannedLayers', 'processedLayers', 'remainingLayers', 'skippedLayers', 'failedLayers', 'duration'].every(k => finite(r.result[k])) && record(r.result.timings) && Array.isArray(r.result.issues) && r.result.issues.every(i => record(i) && typeof i.id === 'string' && typeof i.name === 'string' && typeof i.reason === 'string');
    case 'CANCELLED': return true;
    case 'INVALIDATED': return typeof r.reason === 'string';
    case 'ERROR': return typeof r.message === 'string';
    default: return false;
  }
}

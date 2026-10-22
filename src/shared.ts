export interface FontRef {
  family: string;
  style: string;
  variationSettings?: Record<string, number>;
}
export type Scope = 'selection' | 'page' | 'document';
export interface ScanOptions {
  scope: Scope;
  includeHidden: boolean;
  includeLocked: boolean;
  includeInstances: boolean;
  includeComponents: boolean;
}
export interface FontUsage {
  key: string;
  font: FontRef;
  layers: number;
  ranges: number;
  missing: boolean;
  styled: boolean;
}
export interface Inventory {
  id: string;
  options: ScanOptions;
  pageName: string;
  fonts: FontUsage[];
  layers: number;
  ranges: number;
  scanned: number;
  skipped: Record<string, number>;
  duration: number;
}
export interface Mapping { source: string; target: FontRef }
export interface Review {
  id: string;
  inventoryId: string;
  layers: number;
  ranges: number;
  fontsToLoad: number;
  styledLayers: number;
  variableRanges: number;
  unmappedLayers: number;
}
export interface Issue { id: string; name: string; reason: string }
export interface Result {
  cancelled: boolean;
  changedLayers: number;
  changedRanges: number;
  skippedLayers: number;
  failedLayers: number;
  issues: Issue[];
  duration: number;
}
export type Request =
  | { type: 'INIT' }
  | { type: 'REFRESH_FONTS' }
  | { type: 'SCAN'; options: ScanOptions }
  | { type: 'PLAN'; inventoryId: string; mappings: Mapping[] }
  | { type: 'APPLY'; planId: string }
  | { type: 'CANCEL' }
  | { type: 'FOCUS'; id: string }
  | { type: 'RESIZE'; width: number; height: number };
export type Response =
  | { type: 'CONTEXT'; selected: number; pageName: string }
  | { type: 'FONTS'; fonts: FontRef[] }
  | { type: 'BUSY'; operation: 'scan' | 'apply' }
  | { type: 'PROGRESS'; stage: string; done: number; total: number }
  | { type: 'INVENTORY'; inventory: Inventory }
  | { type: 'REVIEW'; review: Review }
  | { type: 'RESULT'; result: Result }
  | { type: 'CANCELLED' }
  | { type: 'INVALIDATED'; reason: string }
  | { type: 'ERROR'; message: string };

export const defaultOptions: ScanOptions = { scope: 'page', includeHidden: true, includeLocked: false, includeInstances: false, includeComponents: false };
export function fontKey(font: FontRef): string {
  return JSON.stringify([font.family, font.style, Object.entries(font.variationSettings || {}).sort(([a], [b]) => a.localeCompare(b))]);
}
export function loadKey(font: FontRef): string { return JSON.stringify([font.family, font.style]); }
export function normalizedStyle(style: string): string { return style.toLowerCase().replace(/[\s_-]/g, ''); }
export function matchStyle(source: FontRef, targets: FontRef[]): FontRef | undefined {
  const exact = targets.find(f => f.style === source.style);
  if (exact) return exact;
  const candidates = targets.filter(f => normalizedStyle(f.style) === normalizedStyle(source.style));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function isFont(value: unknown): value is FontRef {
  if (!value || typeof value !== 'object') return false;
  const f = value as FontRef;
  return typeof f.family === 'string' && f.family.length > 0 && f.family.length < 512 && typeof f.style === 'string' && f.style.length > 0 && f.style.length < 512 &&
    (f.variationSettings === undefined || (typeof f.variationSettings === 'object' && f.variationSettings !== null && Object.entries(f.variationSettings).every(([k, v]) => /^[a-zA-Z0-9 ]{4}$/.test(k) && typeof v === 'number' && Number.isFinite(v))));
}
export function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  switch (r.type) {
    case 'INIT': case 'REFRESH_FONTS': case 'CANCEL': return true;
    case 'FOCUS': return typeof r.id === 'string' && r.id.length < 256;
    case 'RESIZE': return Number.isFinite(r.width) && Number.isFinite(r.height);
    case 'APPLY': return typeof r.planId === 'string';
    case 'PLAN': return typeof r.inventoryId === 'string' && Array.isArray(r.mappings) && r.mappings.length < 10000 && r.mappings.every(m => m && typeof m.source === 'string' && isFont(m.target));
    case 'SCAN': {
      const o = r.options as ScanOptions | undefined;
      return !!o && ['selection', 'page', 'document'].includes(o.scope) && ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents'].every(k => typeof o[k as keyof ScanOptions] === 'boolean');
    }
    default: return false;
  }
}

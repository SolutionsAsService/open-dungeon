/**
 * Characters: a universal record (name, owner, portrait) plus ruleset-defined sheet data.
 * The ruleset's sheet sections (shared/rules) decide which keys exist and what type each value has;
 * this module validates patches against them so stored data always matches a known field.
 */
import { z } from 'zod';
import type { RulesetModule, SheetField } from './rules/types';

export type ResourceValue = { value: number; max: number | null };
export type SheetValue = string | number | ResourceValue;
export type SheetData = Record<string, SheetValue>;

export const SHEET_LIMITS = { maxPatchKeys: 64, text: 200, textarea: 10000, number: 1e9 } as const;

const Id = z.string().min(1).max(64);
const SheetPatch = z.record(z.string().min(1).max(64), z.unknown());
export const CharacterCreate = z.object({
  name: z.string().trim().min(1).max(80),
  ownerId: Id.nullable().optional(),
  portraitAssetId: Id.nullable().optional(),
  data: SheetPatch.optional(),
});
export type CharacterCreate = z.infer<typeof CharacterCreate>;
export const CharacterUpdate = z.object({
  baseVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  ownerId: Id.nullable().optional(),
  portraitAssetId: Id.nullable().optional(),
  /** Partial sheet data: keys present are set, a null value clears the field. */
  data: SheetPatch.optional(),
});
export type CharacterUpdate = z.infer<typeof CharacterUpdate>;

export interface CharacterView {
  id: string; campaignId: string; name: string; ownerId: string | null; ownerName: string | null;
  portraitAssetId: string | null; rulesetId: string; sheetSchemaVersion: number; data: SheetData; version: number; updatedAt: string;
}

export class SheetError extends Error {}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= SHEET_LIMITS.number;

function checkValue(f: SheetField, v: unknown): SheetValue {
  switch (f.type) {
    case 'text':
    case 'textarea': {
      if (typeof v !== 'string') throw new SheetError(f.label + ' must be text');
      const max = f.type === 'text' ? SHEET_LIMITS.text : SHEET_LIMITS.textarea;
      if (v.length > max) throw new SheetError(f.label + ' is too long (max ' + max + ' characters)');
      return v;
    }
    case 'number':
      if (!finite(v)) throw new SheetError(f.label + ' must be a number');
      return v;
    case 'resource': {
      const o = v as ResourceValue;
      if (!o || typeof o !== 'object' || !finite(o.value) || !(o.max === null || o.max === undefined || finite(o.max))) throw new SheetError(f.label + ' must be { value, max }');
      return { value: o.value, max: o.max ?? null };
    }
  }
}

/** All fields of a ruleset's sheet, keyed by field key. */
export function sheetFields(rs: RulesetModule): Map<string, SheetField> {
  const m = new Map<string, SheetField>();
  for (const s of rs.sheet.sections) for (const f of s.fields) m.set(f.key, f);
  return m;
}

/**
 * Validate a partial sheet update. Returns the cleaned values to set and the keys to clear.
 * Unknown keys are rejected so typos and stale clients can't write fields the ruleset doesn't define.
 */
export function validateSheetPatch(rs: RulesetModule, patch: Record<string, unknown>): { set: SheetData; clear: string[] } {
  const keys = Object.keys(patch);
  if (keys.length > SHEET_LIMITS.maxPatchKeys) throw new SheetError('Too many fields in one update');
  const fields = sheetFields(rs);
  const set: SheetData = {}; const clear: string[] = [];
  for (const k of keys) {
    const f = fields.get(k);
    if (!f) throw new SheetError('Unknown sheet field "' + k + '" for ' + rs.manifest.name);
    if (patch[k] === null) clear.push(k); else set[k] = checkValue(f, patch[k]);
  }
  return { set, clear };
}

export function applySheetPatch(stored: SheetData, p: { set: SheetData; clear: string[] }): SheetData {
  const next: SheetData = { ...stored, ...p.set };
  for (const k of p.clear) delete next[k];
  return next;
}

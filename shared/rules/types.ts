/**
 * Ruleset extension contracts. The tabletop engine only ever talks to these interfaces;
 * adding a game system means adding a RulesetModule, never editing the engine.
 * See docs/architecture/ruleset-system.md.
 */
import { z } from 'zod';
import { DiagonalRule } from '../grid';

export const RULESET_API_VERSION = 1;

export const RulesetManifest = z.object({
  apiVersion: z.literal(RULESET_API_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(400),
  license: z.string().max(120),
  capabilities: z.object({ initiative: z.boolean(), health: z.boolean(), gridMovement: z.boolean() }),
});
export type RulesetManifest = z.infer<typeof RulesetManifest>;

export interface DistancePolicy { unitsPerCell: number; unit: string; diagonal: z.infer<typeof DiagonalRule> }
export interface ConditionDef { id: string; label: string; color: string }
export interface RollPreset { label: string; expression: string }
export interface SheetField { key: string; label: string; type: 'text' | 'number' | 'textarea' | 'resource' }
export interface SheetSection { id: string; label: string; fields: SheetField[] }
export interface EncounterPolicy { initiativeFormula: string | null; sortDescending: boolean }
/** Optional movement cost hook for grid maps; default is the engine's geometric distance. */
export interface MovementPolicy { costPerCell?(terrain: string | null): number }

export interface RulesetModule {
  manifest: RulesetManifest;
  distance: DistancePolicy;
  conditions: ConditionDef[];
  rollPresets: RollPreset[];
  sheet: { schemaVersion: number; sections: SheetSection[] };
  encounter: EncounterPolicy | null;
  movement?: MovementPolicy;
}

/** Validate a module at registration time so a broken ruleset fails loudly, not at the table. */
export function defineRuleset(m: RulesetModule): RulesetModule {
  RulesetManifest.parse(m.manifest);
  const ids = new Set<string>();
  for (const c of m.conditions) { if (ids.has(c.id)) throw new Error(m.manifest.id + ': duplicate condition ' + c.id); ids.add(c.id); }
  const keys = new Set<string>();
  for (const s of m.sheet.sections) for (const f of s.fields) { if (keys.has(f.key)) throw new Error(m.manifest.id + ': duplicate sheet field ' + f.key); keys.add(f.key); }
  return m;
}

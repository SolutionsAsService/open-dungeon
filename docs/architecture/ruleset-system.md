# Ruleset system

The table engine knows nothing about any game. Game systems are **ruleset modules**: typed TypeScript objects
registered in `shared/rules/registry.ts` and validated at load time by `defineRuleset` (`shared/rules/types.ts`).

## Contract (API version 1)
```ts
interface RulesetModule {
  manifest: RulesetManifest;          // apiVersion 1, id, name, semver version, description, license,
                                      // capabilities { initiative, health, gridMovement }
  distance: DistancePolicy;           // unitsPerCell, unit, diagonal rule → default grid scale for new maps
  conditions: ConditionDef[];         // { id, label, color } offered in the token inspector
  rollPresets: RollPreset[];          // quick rolls in the dice bar
  sheet: { schemaVersion; sections: SheetSection[] };  // character sheet layout (fields: text|number|textarea|resource)
  encounter: EncounterPolicy | null;  // initiativeFormula (e.g. '1d20') and sort order, or null = no turn order
  movement?: MovementPolicy;          // optional cost hook (costPerCell) — engine geometry stays in shared/grid.ts
}
```
`defineRuleset` validates the manifest with zod and rejects duplicate condition ids and duplicate sheet field keys,
so a broken module fails at startup and in `tests/unit/rulesets.test.ts`, not at the table.

## Where the engine consults the ruleset
| Engine feature | Ruleset input |
|---|---|
| New map grid scale (createSession) | `distance` |
| Inspector conditions, HP fields | `conditions`, `manifest.capabilities.health` |
| Dice bar presets | `rollPresets` |
| "Add to turns" / Turn order tab | `encounter` (formula rolled server-side; tab explains when a system has no turn order) |
| Character sheets (campaign page + table "Sheets" tab) | `sheet.sections` — rendered by `web/src/characters/CharacterSheet.tsx`, validated server-side by `validateSheetPatch` |

Unknown ruleset ids fall back to `generic` (`getRuleset`).

## Bundled modules
- `generic` — rules-light: squares as the unit, a few neutral conditions, free dice.
- `d20-fantasy` — demo: 5-ft squares, d20 checks with 2d20kh1/kl1 presets, rolled initiative, HP, common conditions.
  Uses only generic terms; contains no proprietary rules text.
- `stress-and-story` — homebrew example: metres, euclidean distance, 2d6 rolls, stress/story resources,
  **no initiative and no HP**. It proves a second, very different system needs no engine change.

## Adding a ruleset
1. Create a module with `defineRuleset({...})` (copy one in `registry.ts`). Choose a unique lowercase id and a
   semver version; bump the version when you change sheet fields.
2. Add it to `RULESETS`.
3. Run `npm test` — `rulesets.test.ts` validates every registered module.
4. It appears in the "Game system" picker when creating a campaign and on the /rulesets page.

### Extending sheets, dice and movement
- **Sheets**: add sections/fields to `sheet.sections`; field `type` controls the input. Increase
  `sheet.schemaVersion` when renaming or removing keys so stored data can be migrated.
- **Dice**: presets are plain expressions of the shared grammar (`shared/dice.ts`: NdS, kh/kl/dh/dl, d%,
  ± constants). The parser is never extended with code from rulesets.
- **Movement**: set `distance.diagonal` (chebyshev, alternating, manhattan, euclidean) and optionally
  `movement.costPerCell`. Geometry (snapping, hex math, gridless calibration) remains in `shared/grid.ts`.

## Licensing
Bundled rulesets contain original text only. SRD-derived content may be added only with its license and
attribution in the manifest `license` field.

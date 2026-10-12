import { RULESETS } from '../../../shared/rules/registry';

export function RulesetsPage() {
  return (
    <div>
      <h1 className="font-display text-2xl text-accent">Game systems</h1>
      <p className="mt-1 text-sm text-ink-dim">The table itself is system-agnostic. A game system adds distance units, conditions, quick rolls, sheet sections and an optional turn order.</p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {RULESETS.map((r) => (
          <li key={r.manifest.id} className="card">
            <div className="font-semibold">{r.manifest.name}</div>
            <div className="text-xs text-ink-dim">v{r.manifest.version} · {r.manifest.license}</div>
            <p className="mt-2 text-sm">{r.manifest.description}</p>
            <p className="mt-2 text-xs text-ink-dim">1 cell = {r.distance.unitsPerCell} {r.distance.unit} · {r.encounter ? 'turn order' : 'no turn order'} · {r.conditions.length} conditions</p>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-dim">Custom rulesets: see docs/architecture/ruleset-system.md (an editor UI is planned).</p>
    </div>
  );
}

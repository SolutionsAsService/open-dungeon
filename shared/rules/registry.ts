import { defineRuleset, type RulesetModule } from './types';

/** Rules-light default: no assumptions beyond a grid and some dice. */
export const generic = defineRuleset({
  manifest: { apiVersion: 1, id: 'generic', name: 'Generic (rules-light)', version: '1.0.0', description: 'No automation. Any dice, free-form notes, optional turn order.', license: 'Original, MIT', capabilities: { initiative: true, health: true, gridMovement: true } },
  distance: { unitsPerCell: 1, unit: 'sq', diagonal: 'chebyshev' },
  conditions: [
    { id: 'marked', label: 'Marked', color: '#e0a95b' }, { id: 'hurt', label: 'Hurt', color: '#e0675b' }, { id: 'hidden', label: 'Hidden', color: '#7f8c8d' },
  ],
  rollPresets: [{ label: 'd6', expression: '1d6' }, { label: '2d6', expression: '2d6' }, { label: 'd20', expression: '1d20' }, { label: 'd100', expression: '1d100' }],
  sheet: { schemaVersion: 1, sections: [{ id: 'overview', label: 'Overview', fields: [{ key: 'concept', label: 'Concept', type: 'text' }, { key: 'notes', label: 'Notes', type: 'textarea' }] }] },
  encounter: { initiativeFormula: null, sortDescending: true },
});

/**
 * d20 fantasy demonstration ruleset using generic terms common to open d20 reference documents.
 * Contains no proprietary rules text. Compatible with games that use 5-ft squares and d20 checks.
 */
export const d20Fantasy = defineRuleset({
  manifest: { apiVersion: 1, id: 'd20-fantasy', name: 'd20 Fantasy (demo)', version: '1.0.0', description: '5-ft squares, d20 checks with advantage/disadvantage, rolled initiative, hit points and common conditions.', license: 'Original, MIT. No proprietary rules text.', capabilities: { initiative: true, health: true, gridMovement: true } },
  distance: { unitsPerCell: 5, unit: 'ft', diagonal: 'chebyshev' },
  conditions: [
    { id: 'prone', label: 'Prone', color: '#a0522d' }, { id: 'blinded', label: 'Blinded', color: '#555' }, { id: 'poisoned', label: 'Poisoned', color: '#6ab04c' },
    { id: 'stunned', label: 'Stunned', color: '#f0c419' }, { id: 'grappled', label: 'Grappled', color: '#8e44ad' }, { id: 'invisible', label: 'Invisible', color: '#85c1e9' },
    { id: 'frightened', label: 'Frightened', color: '#c0392b' }, { id: 'concentrating', label: 'Concentrating', color: '#3498db' },
  ],
  rollPresets: [{ label: 'd20', expression: '1d20' }, { label: 'Advantage', expression: '2d20kh1' }, { label: 'Disadvantage', expression: '2d20kl1' }, { label: 'Ability scores', expression: '4d6dl1' }, { label: 'd8', expression: '1d8' }, { label: 'd12', expression: '1d12' }],
  sheet: { schemaVersion: 1, sections: [
    { id: 'core', label: 'Core', fields: [{ key: 'level', label: 'Level', type: 'number' }, { key: 'ac', label: 'Armor class', type: 'number' }, { key: 'speed', label: 'Speed (ft)', type: 'number' }] },
    { id: 'abilities', label: 'Abilities', fields: ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => ({ key: k, label: k.toUpperCase(), type: 'number' as const })) },
    { id: 'notes', label: 'Notes', fields: [{ key: 'features', label: 'Features & spells', type: 'textarea' }] },
  ] },
  encounter: { initiativeFormula: '1d20', sortDescending: true },
});

/** Homebrew example: a narrative game with stress tracks, metres, and no initiative or hit points. */
export const stressAndStory = defineRuleset({
  manifest: { apiVersion: 1, id: 'stress-and-story', name: 'Stress & Story (homebrew example)', version: '0.1.0', description: 'Narrative play: 2d6 action rolls, stress and harm instead of hit points, metres instead of squares, no initiative.', license: 'Original, MIT', capabilities: { initiative: false, health: false, gridMovement: false } },
  distance: { unitsPerCell: 1.5, unit: 'm', diagonal: 'euclidean' },
  conditions: [{ id: 'stressed', label: 'Stressed', color: '#e67e22' }, { id: 'harmed', label: 'Harmed', color: '#c0392b' }, { id: 'inspired', label: 'Inspired', color: '#2ecc71' }],
  rollPresets: [{ label: 'Action (2d6)', expression: '2d6' }, { label: 'Desperate (3d6 keep 2 low)', expression: '3d6kl2' }, { label: 'Fortune (1d6)', expression: '1d6' }],
  sheet: { schemaVersion: 1, sections: [
    { id: 'self', label: 'Who you are', fields: [{ key: 'drive', label: 'Drive', type: 'text' }, { key: 'bonds', label: 'Relationships', type: 'textarea' }] },
    { id: 'tracks', label: 'Tracks', fields: [{ key: 'stress', label: 'Stress', type: 'resource' }, { key: 'story', label: 'Story points', type: 'resource' }] },
  ] },
  encounter: null,
});

export const RULESETS: RulesetModule[] = [generic, d20Fantasy, stressAndStory];
export const getRuleset = (id: string): RulesetModule => RULESETS.find((r) => r.manifest.id === id) ?? generic;

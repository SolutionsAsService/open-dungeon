# DESIGN-LOG — Title page (sign-in), DADA run

- **Artifact**: `web/src/pages/SignIn.tsx` + title-page rules in `web/src/styles.css`
- **Mode**: Adaptive (public first impression; players of any ability must get in)
- **Tools**: Playwright Chromium screenshots at 1280×800 and 390×844 of the static build (local mode); WCAG contrast computed from the design tokens. Panel reports were written sequentially in one context (a sub-agent API was available but not used — recorded as a process gap).
- **Stop conditions**: S1 every panel Request resolved or explicitly fenced; S2 no WCAG AA failure in measured pairs; S3 no horizontal overflow at 390 px; S4 two rounds without a new blocking finding; S5 time box (2 rounds + premortem).

## Traversal Plan
Seed — Stance: "Make It Bigger (Paula Scher)". Rules: "Visual Hierarchy (Arnheim, Dondis)", "Grid Systems in Graphic Design (Josef Müller-Brockmann)", "WCAG 2.2 Contrast and Perceivability (W3C)". Breaker: "Making and Breaking the Grid (Timothy Samara)", reached through "Chesterton's Fence" (know why the rule exists) and bounded by "MAYA: Most Advanced Yet Acceptable (Raymond Loewy)". Dotted counterpoint: Scher -.-> "The Vignelli Canon (Massimo Vignelli)" (*contrasts with*).
Frontier after R0: Scher, Müller-Brockmann, Samara, "In Praise of Shadows (Jun'ichirō Tanizaki)" → "White (Kenya Hara)", "Interaction of Color (Josef Albers)" (WCAG -.-> Albers: *contrast floor constrains*), "Saul Bass: A Life in Film and Design (Jennifer Bass, Pat Kirkham)", "Don't Make Me Think (Steve Krug)" ← "Designing for Emotion (Aarron Walter)".

## R0 — Premortem of the existing page
Observed: 36 px title (tracking 0.2em) centred above a generic login card; ~70 % of the viewport is an empty brown field with no meaning; the disabled Enter button (50 % opacity) measured **3.19:1** — below AA; nothing says *tabletop*. Imagined failure: "looks like every SaaS login; players bounce or can't tell the button is live". Also: on the deployed Vercel site sign-in returned **404** (no API behind the static host) — fixed separately by local mode.

## Decision Records
**D1 — Poster-scale title.** Depends on: R0. Anchors: "Make It Bigger (Paula Scher)", "Visual Hierarchy (Arnheim, Dondis)". Intent: the name is the image. Formal argument: hierarchy needs one dominant element; a 36 px heading competes with the card. Alternatives rejected: (a) logo illustration — no brand asset exists, would be generic fantasy clip-art; (b) keep small title, add hero image — adds weight without identity. Consequence: title ~150 px at 1280 (11.5vw, clamp 2.9–11rem), two lines, left-aligned. Fence: must never clip (legibility outranks drama). Frontier effect: opens Vignelli counterpoint. mode: Adaptive.

**D2 — The table as grid.** Depends on: D1. Anchors: "Grid Systems in Graphic Design (Josef Müller-Brockmann)", "Art as Technique (Viktor Shklovsky)". Intent: the empty field becomes a battle map (56 px squares) — the product's own surface, defamiliarising the login. Alternatives rejected: (a) texture/wood photo — heavier, off-token; (b) hex grid — implies one rules system, the product is system-agnostic. Consequence: 12-column layout ≥ 900 px (tagline cols 1–5, form cols 7–12), single column below. Fence: grid lines stay ground (line token at 55 %). mode: Adaptive.

**D3 — One token leaves the grid (the break).** Depends on: D1, D2. Anchors: "Making and Breaking the Grid (Timothy Samara)", "Chesterton's Fence", "MAYA: Most Advanced Yet Acceptable (Raymond Loewy)". Intent: the "O" is ringed like a miniature's base and pings twice — the app's realtime ping. Alternatives rejected: (a) tilted/rotated words — reads as broken layout; (b) d20 icon — cliché, system-specific. Consequence: `.title-token::after` ring, 2 animation iterations, disabled by the global reduced-motion rule. Fence: text stays real text (`aria-label="Open Tabletop"`), only one break. mode: Adaptive.

**D4 — Candle pool and kept emptiness.** Anchors: "In Praise of Shadows (Jun'ichirō Tanizaki)", "White (Kenya Hara)". Intent: light pools where you act (the form), edges fall to shadow; emptiness is invitation, not filler. Alternatives rejected: uniform gradient (old); bright spotlight (glare). mode: Adaptive.

**D5 — Contrast and the always-live button.** Anchors: "WCAG 2.2 Contrast and Perceivability (W3C)", "Interaction of Color (Josef Albers)", "Don't Make Me Think (Steve Krug)". Intent: Enter is never faded; empty input is caught by `required`. Measured: accent/table 8.95, ink/table 14.91, ink-dim/table 7.0, accent-ink on accent 8.81, ink-dim on panel-2 5.86 (all ≥ AA). Alternatives rejected: keep disabled state with outline — still ambiguous; remove helper text — needed honesty about dev sign-in. mode: Adaptive.

## Panel Reports
### R1 (screenshots of first implementation)
| Critic | Anchor | Observed | Verdict | Requested change |
| --- | --- | --- | --- | --- |
| Critic: Provocateur (Debord) | The Society of the Spectacle (Guy Debord) | Ping halo large and glowing — spectacle for its own sake | Concern | Shrink halo, limit repeats |
| Critic: Provocateur (Shklovsky) | Art as Technique (Viktor Shklovsky) | Grid backdrop makes the login strange in a good way | Pass | — |
| Critic: Inclusion (Holmes) | Mismatch: How Inclusion Shapes Design (Kat Holmes) | Mobile: Enter button and notice cut off the right edge | **Block** | Fix overflow at 390 px |
| Critic: Inclusion (Mace) | The Principles of Universal Design (Ronald Mace et al.) | "TABLETOP" clipped to "TABLETOF" on desktop | Block | Title must fit at every width |
| Critic: Usability (Krug) | Don't Make Me Think (Steve Krug) | Enter now visibly live; label kept | Pass | — |
| Critic: Craft (Bringhurst) | The Elements of Typographic Style (Robert Bringhurst) | Caps tracking 0.04em too loose at display size, drives overflow | Concern | Tighten to ~0.02em |
| Critic: Cross-Cultural (Tanizaki) | In Praise of Shadows (Jun'ichirō Tanizaki) | Candle pool works; halo competes with it | Concern | Quieter ping |
| Critic: Historian (Meggs) | Meggs' History of Graphic Design | Poster-scale type over grid recalls Swiss posters reset for games — coherent | Pass | — |

CRP — Statements: identity achieved; two blocking legibility/overflow defects. Questions: is clipping a deliberate bleed? (No — fenced in D1.) Opinions: Debord/Krug dotted pair disagree on the ping; resolved by keeping it but shrinking (MAYA). Andon: pulled by Holmes (mobile overflow).

Cause found: 12 columns × 3 rem gaps exceed 390 px. **R2 changes**: single-column layout below 900 px, gap 1.25 rem; title 11.5vw / tracking 0.02em; halo spread 0.35em → 0.18em, 3 → 2 iterations.

### R2
| Critic | Observed | Verdict |
| --- | --- | --- |
| Holmes / Mace | 390 px: no overflow, Enter fully visible, title fits; desktop title fits with margin | Pass |
| Debord / Tanizaki | Halo subordinate to candle pool | Pass |
| Bringhurst | Display tracking and leading (0.88) balanced | Pass |
| Krug / Shklovsky / Meggs | No regressions | Pass |

## Anchor Ledger
Used: Scher, Arnheim/Dondis, Müller-Brockmann, WCAG 2.2, Samara, Chesterton's Fence, MAYA, Vignelli (counterpoint), Shklovsky, Tanizaki, Hara, Albers, Krug, Walter, Bass (considered: title-sequence boldness informed D1), Premortem. Panel lenses: Debord, Shklovsky, Holmes, Mace, Krug, Bringhurst, Tanizaki, Meggs.

## Compliance Check
Mode declared ✓ · seed (Stance, ≥2 Rules, Breaker, dotted counterpoint) ✓ · premortem R0 ✓ · decision records before moves ✓ · panels with Provocateur + Inclusion seats ✓ · measurements recorded ✓ · stop conditions S1–S4 met after R2 ✓ · gap: panels sequential, not one agent per reference.

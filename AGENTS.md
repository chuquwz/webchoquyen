# Project Guidelines & Agent Instructions

This repository contains **QuyenHealth**, a personal health & weight-tracking web application built with a Go backend and a vanilla HTML5/CSS3/JavaScript Progressive Web App (PWA) frontend located in `web/`.

## Frontend Design Engineering Skills

The project integrates the agent skills from [jakubkrehel/skills](https://github.com/jakubkrehel/skills) located in `.agents/skills/`.

When reviewing, designing, building, or modifying any frontend code (`web/index.html`, `web/style.css`, `web/app.js`):

### 1. Available Design Skills
- **`better-interface`** (`.agents/skills/better-interface/`): Multi-discipline UI review and orchestration.
- **`better-ui`** (`.agents/skills/better-ui/`): Micro-interactions, outer/inner radius alignment (`R_outer = R_inner + padding`), layered elevation shadows, optical centering, and transitions (`scale(0.96)` press states).
- **`better-typography`** (`.agents/skills/better-typography/`): Type scale, line-heights, tabular numbers (`font-variant-numeric: tabular-nums`) for health metrics (weight, calories, dates), and text wrapping.
- **`better-colors`** (`.agents/skills/better-colors/`): Semantic tokens, WCAG 2.2 contrast compliance (4.5:1 for text, 3:1 for controls), and multi-modal state indication (never color alone).
- **`better-accessibility`** (`.agents/skills/better-accessibility/`): Keyboard navigation, accessible names, visible focus outlines, touch targets $\ge$ 44x44px, and `prefers-reduced-motion` compliance.
- **`better-layout`** (`.agents/skills/better-layout/`): Mobile-first layouts, 320px viewport resilience, touch-friendly density, and spatial grouping.
- **`better-writing`** (`.agents/skills/better-writing/`): Friendly, actionable Vietnamese microcopy, clear error states with recovery instructions, and confirmation for destructive actions.
- **`interface-review`** (`.agents/skills/interface-review/`): Evaluating UI diffs for regressions and introduced issues.

### 2. High-Priority Triggers (Always Avoid or Fix Immediately)
- Controls without accessible names or aria attributes.
- Interactive elements unreachable via keyboard or missing visible `:focus-visible` styles.
- Contrast failures on text or interactive borders against their backgrounds.
- Elements clipping or breaking at 320px width or when zoomed.
- Animations ignoring `prefers-reduced-motion`.
- Destructive operations without confirmation dialog or undo toast.


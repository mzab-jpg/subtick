# Legacy tools archive

This directory preserves retired experimentation tools for historical reference only.
They are **not** part of Tangent's supported development, validation, deployment, or
recommendation workflow.

## Contents

- `local-simulator/` — an older self-contained local ranking simulation and its
  matching verification scripts. It uses its own static assumptions and does not
  call Tangent's current backend or live scoring configuration.
- `legacy-simulator.html` — a duplicate legacy browser simulator retained only
  for reference.
- `legacy-live-bot-simulator.js` — an older synthetic-user script that no
  longer matches Tangent's current category and tooling setup.

For current local testing, use the emulator guide in
[`docs/emulator/EMULATOR_GUIDE.md`](../../docs/emulator/EMULATOR_GUIDE.md), the
High-Fidelity Matrix at `scripts/high_fidelity_matrix.html`, the Control Dashboard
at `scripts/control_dashboard.html`, and the supported `npm` validation scripts.

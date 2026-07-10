# Registration Pitch: CRM Field Check

**Track:** 1 (Widget Development)
**Team:** Tim (solo)
**Platform:** Zoho CRM (web tab widget)

## Project pitch

**CRM Field Check answers the question Zoho can't: "what breaks if I delete this field?"**

When you delete a CRM field, Zoho warns you about workflows and blueprints, but says nothing about Zoho Analytics or Deluge code. The field disappears, and days later a client's dashboard is broken, a query table errors out, or a function starts failing silently. Every admin and consultant has felt this, and today the only "solution" is manually opening every report and script to look.

CRM Field Check is a web tab widget inside CRM that inventories every field in every module and shows exactly where each one is used before you delete it. Pick a module, click a field (or check all 60 at once), and get a verdict:

- **Used in N places**, with a breakdown by source: Analytics views, formula columns, aggregate formulas, query table SQL, and CRM Deluge functions, each usage listed with a type icon, a code/SQL snippet where relevant, and a direct link to the editable view or the Functions page so you can fix it before deleting.
- **Safe to delete**, backed by Zoho Analytics' own dependency engine, not text guesswork.
- **Not in Analytics or code at all**, which doubles as a dead-field detector for org cleanup engagements.

Results export to CSV, turning a field audit into a client-ready artifact.

## How it works (architecture summary)

- CRM web tab widget built with the Zoho Extension Toolkit and the Embedded App JS SDK. No backend, no external services.
- Field metadata via `ZOHO.CRM.META`. Zoho Analytics v2 metadata APIs (workspaces, view details, and column dependents) and the CRM Functions API are reached through `ZOHO.CRM.CONNECTION.invoke()` with two named Connections, so OAuth and CORS are handled by CRM and the widget is portable to any org with a two-connection setup.
- The core insight: table view details expose each column's `columnId`, and the documented column-dependents endpoint returns every dependent view and formula straight from Zoho's dependency engine (the same one behind Analytics' delete warnings). Query table SQL and Deluge function source are additionally text-scanned with word-boundary matching on field label and API name.
- No third-party libraries. Vanilla JS, one HTML file, dark/light theming.

## Fit to judging criteria

- **Functionality/Utility (40%):** solves a real problem Zenatta hits on client engagements (safe field cleanup, org audits). Works today in a live org.
- **Code Quality (25%):** small, readable, dependency-free codebase with documented architecture and honest evidence tiers.
- **UX/Polish (20%):** guided three-step flow, filter chips, verdict breakdowns, type icons, CSV export, dark mode.
- **Creativity (15%):** nothing in the Zoho ecosystem does cross-product field impact analysis; the column-dependents approach makes it exact rather than heuristic.

## Remaining plan (build period)

Hardening and edge cases, validation in a clean second org (fresh connections, portability proof), packaged hosted deployment, demo video, and written summary.

## Hour estimate

| Work item | Hours |
|---|---|
| API discovery and spikes (Analytics v2, Functions /code behavior) | 6 |
| Core widget: scan engine, column matching, dependency lookups, verdicts | 12 |
| CRM Deluge functions layer | 4 |
| UX: dark mode, icons, filters, CSV export, breakdown verdicts | 5 |
| Hardening and testing in a clean org (portability, edge cases, rate limits) | 5 |
| Packaging and hosted deployment | 2 |
| Demo video and written summary | 4 |
| Buffer (review feedback, late bugs) | 2 |
| **Total (Tim)** | **40** |

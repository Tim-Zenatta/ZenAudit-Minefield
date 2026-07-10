# CRM Field Check

A Zoho CRM web tab widget that shows every field in every module and where each field is actually used: Zoho Analytics query tables, reports, and dashboards, plus CRM Deluge functions. Know before you delete.

UI: dark mode by default with a sun/moon toggle (persisted), per-type icons echoing Analytics' visual language, and unnamed dashboard KPI widgets collapsed into a count note instead of bare-ID rows.

Built for the Zenatta 2026 Summer Design Competition (Track 1: Widget Development).

## Why

CRM warns you about workflows and blueprints when you delete a field. It says nothing about Zoho Analytics or function scripts, so deletions silently break downstream reports and code. FieldCheck closes that gap.

## Architecture

- CRM web tab widget built with the Zoho Extension Toolkit (zet) and the CRM Embedded App JS SDK. No backend.
- CRM module and field metadata comes from `ZOHO.CRM.META` (runs as the logged-in user, no setup).
- Zoho Analytics and the CRM Functions API are reached through `ZOHO.CRM.CONNECTION.invoke()` against named Connections, so OAuth and CORS are handled server-side by CRM. Each org sets up the Connections once, which keeps the widget portable to any environment.

## One-time org setup

1. **Connections** (Setup > Developer Space > Connections > Create, service "Zoho OAuth"):
   - Link name `analytics` with scope `ZohoAnalytics.metadata.read` (the widget only reads metadata; `ZohoAnalytics.fullaccess.all` also works)
   - Link name `crm` with scope `ZohoCRM.settings.ALL` (known working; the minimal documented scope is `ZohoCRM.settings.functions.READ` if the scope picker offers it)
   - Authorize both after creating them. Custom link names are fine; enter them in the widget's settings.
2. **Widget** (Setup > Developer Space > Widgets > Create):
   - Type: Web Tab
   - Hosting: External (dev) pointing to `https://127.0.0.1:5000/app/widget.html`, or Zoho (packaged) once shipped
3. Add the widget as a web tab so it appears in the CRM tab bar.

## Local development

```
npm install -g zoho-extension-toolkit
zet run
```

Open `https://127.0.0.1:5000` once in the browser and accept the self-signed certificate, then open the web tab inside CRM.

To ship: `zet validate`, then `zet pack`, and upload `dist/FieldCheck.zip` in the widget's settings with Hosting set to Zoho. CRM serves the zip's `app/` folder as the web root, so set the Index Page to `/widget.html` (not `/app/widget.html`). Every change requires a re-pack and re-upload; use the external `https://127.0.0.1:5000/app/widget.html` URL during development instead.

## Code structure

No build step; plain files loaded as ordered script tags, shared via top-level globals.

```
app/
  widget.html      markup only (loader scene, setup card, results panels)
  css/styles.css   all styling: base/light theme, dark theme, loader
  js/
    state.js       shared state object S + scan cache key
    helpers.js     DOM/URL/text utils, Connection transport (invokeConn/analyticsGet/crmGet), runQueue
    loader.js      full-screen loader (min-hold + boot lines) and mini loader
    settings.js    persisted settings, theme toggle, setup-card UI toggles, scope copy
    scan.js        orgs/workspaces, the scan pipeline, Deluge function code fetch, cache, finishScan
    fields.js      module/field loading, column matching, dependents lookup, verdict math
    ui.js          icons, chips, filters, field list, detail panel, CSV export, recheck
    main.js        boot wiring (PageLoad, SDK init, failsafe)
```

## How it works (v2, dependency-engine based)

`app/widget.html` is the product. Instead of scraping report internals, FieldCheck asks Zoho Analytics' own dependency engine what depends on each column, via the documented v2 metadata APIs:

1. **Connect and scan**: load orgs and workspaces through the connection, pick workspaces, scan. The scan fetches view details only for **Tables** (their `columns` array carries `columnId`s) and **Query Tables** (their SQL text). All other view types are reached through the dependents API, so the scan is light. Results cache in localStorage.
2. **Fields**: pick a CRM module. Each field is mapped to physical Analytics columns by normalized name, so "Account Name", "Account_Name", and "account_name" all match. Tables named like the module are treated as primary; same-named columns in other tables are still checked but labeled. Click a field to check it, or "Check all fields" to badge the whole module.
3. **Verdict**: for each matched column, `GET .../views/{viewId}/columns/{columnId}/dependents` returns dependent views, formula columns, and aggregate formulas straight from Zoho. Query table SQL is additionally text-matched (word-boundary, label + API name) with a snippet shown. Every usage row links out via `{analytics web}/open-view/{viewId}`.

Badges: red `N hits`, green `clear` (engine says nothing depends on it), gray `not in Analytics` (field is not synced and unreferenced, also safe). Dependents responses are cached per column for the session.

**Deluge functions layer**: during the scan (optional checkbox), the widget lists org functions via `GET /crm/v8/settings/functions` and pulls each script via `GET /crm/v8/settings/functions/{id}/code` (returns raw file content) through the `crm` connection. Field checks then regex the cached code for the field's **API name** with word boundaries (Deluge references fields by API name; labels are skipped to avoid comment noise). Function hits count toward the verdict even for fields that are not synced to Analytics, show a code snippet plus reference count, and appear in the CSV export. If an org has a very large number of functions the unpaginated list call may truncate; revisit if that shows up in practice.

Key API references:
- [Get View Details](https://www.zoho.com/analytics/api/v2/metadata-api/view-details.html) (`withInvolvedMetaInfo` returns table columns with `columnId`)
- [Get Column Dependents](https://www.zoho.com/analytics/api/v2/metadata-api/get-column-dependents.html)

## API behavior notes (confirmed during development)

- `ZOHO.CRM.CONNECTION.invoke` returns JSON API responses wrapped in `{details: {statusMessage: ...}}`, but **file-download endpoints resolve as the raw text body itself** (a plain string). `GET /crm/v8/settings/functions/{id}/code` is a file download; handle both shapes.
- Custom headers such as `ZANALYTICS-ORGID` pass through `CONNECTION.invoke` correctly.
- Table view details (`withInvolvedMetaInfo: true`) return the `columns` array with each column's `columnId`, which is what the column-dependents endpoint needs.
- The functions list endpoint pages at 200 per page (`info.more_records`); orgs with more than 200 functions would need pagination.
- Analytics dependent views inside dashboards ("KPI widgets") come back with a bare numeric `viewName`; the UI collapses them into a count.

## Competition deliverables (due Aug 24)

- [ ] Deployed working widget in a live Zoho environment
- [ ] Source code repo
- [ ] Written summary: what it does, problem it solves, third-party libraries declared
- [ ] Screen recording or live demo link

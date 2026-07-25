"use strict";

// The scan pipeline: connect to Analytics, walk workspaces and views, capture
// table columns and query table SQL, and optionally pull CRM Deluge function
// code. Results land in S and are cached in localStorage.

function loadOrgs() {
  clearError();
  S.orgId = null;
  var pick = $("org-pick");
  pick.disabled = true;
  pick.innerHTML = "<option>loading orgs&hellip;</option>";
  return analyticsGet("/orgs").then(function (body) {
    var orgs = (body.data && body.data.orgs) || [];
    pick.innerHTML = "";
    orgs.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.orgId; opt.textContent = o.orgName + " (" + o.orgId + ")";
      pick.appendChild(opt);
    });
    pick.disabled = false;
    saveSettings();
    if (orgs.length) return loadWorkspaces();
  }).catch(function (err) {
    showError("Could not reach Zoho Analytics through connection \"" +
      $("conn-analytics").value + "\". Check the connection link name and that it is authorized.\n" +
      String(err && err.message || err));
  });
}
$("org-pick").onchange = function () { loadWorkspaces(); };

function loadWorkspaces() {
  clearError();
  S.orgId = $("org-pick").value;
  return analyticsGet("/workspaces").then(function (body) {
    var all = ((body.data && body.data.ownedWorkspaces) || [])
      .concat((body.data && body.data.sharedWorkspaces) || []);
    S.workspaces = all.map(function (w) {
      return { workspaceId: w.workspaceId, workspaceName: w.workspaceName, selected: true };
    });
    var box = $("ws-list");
    box.innerHTML = "";
    S.workspaces.forEach(function (w, i) {
      var lab = document.createElement("label");
      lab.className = "ws-pill on";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = true;
      cb.onchange = function () {
        S.workspaces[i].selected = cb.checked;
        lab.classList.toggle("on", cb.checked);
        updateScanButton();
        renderFolderList();
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(w.workspaceName));
      box.appendChild(lab);
    });
    updateScanButton();
    updateSelectorVisibility();
    return loadFolders();
  }).catch(function (err) { showError(String(err && err.message || err)); });
}

// The workspace/folder pickers only matter for the reverse audit (that's
// where a mixed workspace's cross-app noise actually causes problems), so
// they stay hidden otherwise to keep the normal scan card uncluttered. A
// normal scan (CRM or Creator fields alike) just covers every folder, the
// same as the CRM side always has — see scanAnalytics's filterByFolder.
// Selection state itself isn't reset when hidden, it still governs
// scanAnalytics() either way.
function updateSelectorVisibility() {
  var show = $("include-reverse-audit").checked;
  $("ws-section").classList.toggle("hidden", !show || !S.workspaces.length);
  renderFolderList();
}

// One workspace can mix tables from several apps (e.g. a consolidated "Zoho
// One" workspace), which confuses the reverse audit's name matching (that's
// the only place folder selection is actually applied, see scanAnalytics).
// Best-effort: if a workspace's folders can't be read, scanning it stays
// unfiltered rather than silently excluding everything. Default to only the
// CRM data folder selected, since that's the one real signal to trust
// automatically; everything else needs an explicit opt-in.
function loadFolders() {
  S.folders = [];
  return runQueue(S.workspaces, function (w) {
    return analyticsGet("/workspaces/" + w.workspaceId + "/folders").then(function (body) {
      var folders = (body.data && body.data.folders) || [];
      folders.forEach(function (f) {
        S.folders.push({
          folderId: f.folderId, folderName: f.folderName,
          wsId: w.workspaceId, wsName: w.workspaceName,
          selected: f.folderName.toLowerCase().indexOf("zoho crm modules (data)") >= 0
        });
      });
    }).catch(function () { /* best-effort; that workspace just scans unfiltered */ });
  }).then(renderFolderList);
}

function renderFolderList() {
  var section = $("folder-section");
  var show = $("include-reverse-audit").checked;
  var visible = S.folders.filter(function (f) {
    var ws = S.workspaces.filter(function (w) { return w.workspaceId === f.wsId; })[0];
    return ws && ws.selected;
  }).sort(function (a, b) { return (b.selected ? 1 : 0) - (a.selected ? 1 : 0); });
  if (!show || !visible.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  var box = $("folder-list");
  box.innerHTML = "";
  visible.forEach(function (f) {
    var lab = document.createElement("label");
    lab.className = "ws-pill" + (f.selected ? " on" : "");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = f.selected;
    cb.onchange = function () {
      f.selected = cb.checked;
      lab.classList.toggle("on", cb.checked);
      renderFolderList();
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(f.wsName + " / " + f.folderName));
    box.appendChild(lab);
  });
}

// Only filters a workspace's views if we actually have folder data for it;
// an unread folder list or an unrecognized folderId never blocks scanning.
function folderAllowed(wsId, folderId) {
  var wsFolders = S.folders.filter(function (f) { return f.wsId === wsId; });
  if (!wsFolders.length) return true;
  var match = wsFolders.filter(function (f) { return f.folderId === folderId; })[0];
  return match ? match.selected : true;
}

function selectedWorkspaces() {
  return S.workspaces.filter(function (w) { return w.selected; });
}

function selectedCreatorApps() {
  return S.creatorApps.filter(function (a) { return a.selected; });
}

// Source toggle tiles: keep the tile styling in sync and refresh the button
["include-an", "include-fns", "include-reports"].forEach(function (id) {
  var cb = $(id);
  cb.onchange = function () {
    cb.closest(".src-tile").classList.toggle("on", cb.checked);
    updateScanButton();
  };
});
$("include-books").onchange = function () {
  var cb = $("include-books");
  cb.closest(".src-tile").classList.toggle("on", cb.checked);
  updateScanButton();
  if (cb.checked && S.sdkReady && !S.booksOrgId) loadBooksOrgs();
};
$("include-creator").onchange = function () {
  var cb = $("include-creator");
  cb.closest(".src-tile").classList.toggle("on", cb.checked);
  updateScanButton();
  if (cb.checked && S.sdkReady && !S.creatorApps.length) loadCreatorApps();
  else renderCreatorAppList();
};

// The reverse audit is a different operation (Analytics -> CRM instead of
// CRM -> Analytics) that runs standalone; selecting it locks out the normal
// scan sources rather than combining with them.
$("include-reverse-audit").onchange = function () {
  var cb = $("include-reverse-audit");
  var exclusive = cb.checked;
  ["include-an", "include-fns", "include-books", "include-reports", "include-creator"].forEach(function (id) {
    var other = $(id);
    other.disabled = exclusive;
    other.closest(".src-tile").classList.toggle("disabled-tile", exclusive);
    if (exclusive && other.checked) {
      other.checked = false;
      other.dispatchEvent(new Event("change"));
    }
  });
  cb.closest(".src-tile").classList.toggle("on", cb.checked);
  updateScanButton();
  updateSelectorVisibility();
};

// The scan button reads as "Scan 2 sources · 4 workspaces" and stays
// disabled until at least one runnable source is ready. In reverse-audit
// mode it reads "Run reverse audit · N workspaces" instead.
function updateScanButton() {
  var btn = $("btn-scan");
  var ws = selectedWorkspaces().length;
  if ($("include-reverse-audit").checked) {
    btn.textContent = "Run reverse audit" + (ws ? " · " + ws + (ws === 1 ? " workspace" : " workspaces") : "");
    btn.disabled = !!(S.scanning || !S.sdkReady || !ws);
    return;
  }
  var an = $("include-an").checked, fns = $("include-fns").checked, books = $("include-books").checked,
    reports = $("include-reports").checked, creator = $("include-creator").checked;
  var srcs = (an ? 1 : 0) + (fns ? 1 : 0) + (books ? 1 : 0) + (reports ? 1 : 0) + (creator ? 1 : 0);
  var label = "Scan " + srcs + (srcs === 1 ? " source" : " sources");
  if (an) label += " · " + ws + (ws === 1 ? " workspace" : " workspaces");
  btn.textContent = srcs ? label : "Scan";
  btn.disabled = !!(S.scanning || !S.sdkReady || !srcs || (an && !ws) || (books && !S.booksOrgId) ||
    (creator && !selectedCreatorApps().length));
}

// Zoho Books has no readable API for its native CRM sync field mapping, so
// matching falls back to comparing names against these entities' custom fields.
var BOOKS_ENTITIES = [
  { key: "contact", label: "Contacts (Customers/Vendors)" },
  { key: "item", label: "Items" },
  { key: "invoice", label: "Invoices" },
  { key: "estimate", label: "Estimates" }
];

// Books has no schema API for its standard (non-custom) fields either, unlike
// custom fields via /settings/fields. These are hardcoded from Books' own
// field vocabulary purely so common fields (e.g. "Billing City") have
// something to name-match against; still coincidental-name matching, not a
// verified sync mapping. Labels use CRM's own terminology ("Billing Code" for
// zip) so they line up with what a CRM field is actually called; apiName
// reflects Books' real nested contact.billing_address/shipping_address keys
// (address, street2, city, state, zip, country), confirmed against Zoho's
// documented sample contact JSON.
var STANDARD_BOOKS_FIELDS = {
  contact: [
    { label: "Company Name", apiName: "company_name" },
    { label: "Email", apiName: "email" },
    { label: "Phone", apiName: "phone" },
    { label: "Mobile", apiName: "mobile" },
    { label: "Website", apiName: "website" },
    { label: "Billing Street", apiName: "billing_address.address" },
    { label: "Billing City", apiName: "billing_address.city" },
    { label: "Billing State", apiName: "billing_address.state" },
    { label: "Billing Code", apiName: "billing_address.zip" },
    { label: "Billing Country", apiName: "billing_address.country" },
    { label: "Shipping Street", apiName: "shipping_address.address" },
    { label: "Shipping City", apiName: "shipping_address.city" },
    { label: "Shipping State", apiName: "shipping_address.state" },
    { label: "Shipping Code", apiName: "shipping_address.zip" },
    { label: "Shipping Country", apiName: "shipping_address.country" }
  ],
  item: [
    { label: "Name", apiName: "name" },
    { label: "Description", apiName: "description" },
    { label: "SKU", apiName: "sku" },
    { label: "Rate", apiName: "rate" },
    { label: "Unit", apiName: "unit" }
  ],
  invoice: [
    { label: "Reference Number", apiName: "reference_number" },
    { label: "Notes", apiName: "notes" },
    { label: "Terms", apiName: "terms" },
    { label: "Due Date", apiName: "due_date" }
  ],
  estimate: [
    { label: "Reference Number", apiName: "reference_number" },
    { label: "Notes", apiName: "notes" },
    { label: "Terms", apiName: "terms" },
    { label: "Expiry Date", apiName: "expiry_date" }
  ]
};

function loadBooksOrgs() {
  var pick = $("books-org-pick");
  pick.disabled = true;
  pick.innerHTML = "<option>loading organizations&hellip;</option>";
  return invokeConn($("conn-books").value.trim(), crmApiBase() + "/books/v3/organizations", {})
    .then(function (body) {
      var orgs = body.organizations || [];
      pick.innerHTML = "";
      orgs.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.organization_id; opt.textContent = o.name;
        pick.appendChild(opt);
      });
      pick.disabled = orgs.length === 0;
      S.booksOrgId = pick.value || null;
      pick.onchange = function () { S.booksOrgId = pick.value || null; updateScanButton(); };
      saveSettings();
      updateScanButton();
    }).catch(function (err) {
      pick.innerHTML = "<option>could not load organizations</option>";
      showError("Could not reach Zoho Books through connection \"" + $("conn-books").value +
        "\". Check the connection link name and that it is authorized.\n" + String(err && err.message || err));
      updateScanButton();
    });
}

// Unlike Books' single organization, one Zoho Creator account can hold many
// independent apps, so this is a multi-select pill list (like Analytics
// workspaces) rather than a dropdown, defaulting to all selected.
function loadCreatorApps() {
  return creatorGet("/meta/applications").then(function (body) {
    var apps = (body && body.applications) || [];
    S.creatorApps = apps.map(function (a) {
      return {
        workspaceName: a.workspace_name, appName: a.application_name,
        label: (a.workspace_name ? a.workspace_name + " / " : "") + a.application_name,
        selected: true
      };
    });
    renderCreatorAppList();
    updateScanButton();
  }).catch(function (err) {
    showError("Could not reach Zoho Creator through connection \"" + $("conn-creator").value +
      "\". Check the connection link name and that it is authorized.\n" + String(err && err.message || err));
  });
}

function renderCreatorAppList() {
  var section = $("creator-app-section");
  if (!$("include-creator").checked || !S.creatorApps.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  var box = $("creator-app-list");
  box.innerHTML = "";
  S.creatorApps.forEach(function (a, i) {
    var lab = document.createElement("label");
    lab.className = "ws-pill" + (a.selected ? " on" : "");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = a.selected;
    cb.onchange = function () {
      S.creatorApps[i].selected = cb.checked;
      lab.classList.toggle("on", cb.checked);
      updateScanButton();
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(a.label));
    box.appendChild(lab);
  });
}

// The scan only needs deep details for Tables (their columns carry the
// columnIds used by the dependents API) and Query Tables (their SQL).
// Everything else is reached through Zoho's own dependency engine.
$("btn-scan").onclick = function () {
  clearError();

  if ($("include-reverse-audit").checked) {
    var wsTargets = selectedWorkspaces();
    if (!wsTargets.length) { showError("Select at least one workspace."); return; }
    S.scanning = true;
    $("btn-scan").disabled = true;
    $("scan-progress").classList.remove("done");
    S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {};
    scanAnalytics(wsTargets, true).then(function () {
      S.scannedAt = new Date().toLocaleString();
      return runReverseAudit();
    }).then(function () {
      S.scanning = false;
      hideLoader();
      updateScanButton();
      $("setup-card").classList.add("collapsed");
      var t = $("btn-toggle-setup");
      t.classList.remove("hidden");
      t.textContent = "Settings";
      $("results").classList.add("hidden");
      $("reverse-audit-card").classList.remove("hidden");
    }).catch(function (err) {
      S.scanning = false;
      hideLoader();
      updateScanButton();
      showError(String(err && err.message || err));
    });
    return;
  }

  var doAn = $("include-an").checked, doFns = $("include-fns").checked, doBooks = $("include-books").checked,
    doReports = $("include-reports").checked, doCreator = $("include-creator").checked;
  if (!doAn && !doFns && !doBooks && !doReports && !doCreator) { showError("Turn on at least one scan source."); return; }
  var targets = doAn ? selectedWorkspaces() : [];
  if (doAn && !targets.length) { showError("Select at least one workspace."); return; }
  if (doBooks && !S.booksOrgId) { showError("Select a Books organization before scanning."); return; }
  if (doCreator && !selectedCreatorApps().length) { showError("Select at least one Zoho Creator app before scanning."); return; }
  S.scanning = true;
  $("btn-scan").disabled = true;
  $("scan-progress").classList.remove("done");
  S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {}; S.results = {};

  (doAn ? scanAnalytics(targets) : Promise.resolve()).then(function () {
    return doFns ? scanFunctions() : null;
  }).then(function () {
    return doBooks ? scanBooks() : null;
  }).then(function () {
    return doReports ? scanReports() : null;
  }).then(function () {
    return doCreator ? scanCreator() : null;
  }).then(function () {
    S.scannedAt = new Date().toLocaleString();
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify({
        at: S.scannedAt, orgId: S.orgId, dc: $("dc").value,
        tables: S.tables, queryTables: S.queryTables, viewCount: S.viewCount,
        functions: S.functions, functionsScanned: S.functionsScanned,
        booksFields: S.booksFields, booksScanned: S.booksScanned, booksOrgId: S.booksOrgId,
        reports: S.reports, reportsScanned: S.reportsScanned, reportsSkippedStale: S.reportsSkippedStale,
        creatorFields: S.creatorFields, creatorScanned: S.creatorScanned
      }));
    } catch (e) { /* cache is best-effort */ }
    finishScan();
  }).catch(function (err) {
    S.scanning = false;
    hideLoader();
    updateScanButton();
    showError(String(err && err.message || err));
  });
};

// Books has no readable field-mapping API (see BOOKS_ENTITIES comment above),
// so this lists custom fields per entity via the API, then adds the
// hardcoded standard fields (STANDARD_BOOKS_FIELDS) for name-based matching.
function scanBooks() {
  S.booksFields = []; S.booksScanned = false;
  $("scan-progress").innerHTML = "Reading Zoho Books custom fields&hellip;";
  showLoader("Reading Zoho Books custom fields...");
  var failures = 0;
  return runQueue(BOOKS_ENTITIES, function (ent) {
    return booksGet("/settings/fields?entity=" + ent.key).then(function (body) {
      (body.fields || []).forEach(function (f) {
        S.booksFields.push({
          entity: ent.key, entityLabel: ent.label, fieldId: f.field_id,
          label: f.label, apiName: f.api_name, standard: false
        });
      });
    }).catch(function () { failures++; });
  }, function (i, n, ent) {
    $("scan-progress").innerHTML = "Reading Books fields <b>" + i + " / " + n + "</b> - " + esc(ent.label);
    showLoader("Reading Books fields " + i + " / " + n, n ? i / n : null);
  }).then(function () {
    BOOKS_ENTITIES.forEach(function (ent) {
      (STANDARD_BOOKS_FIELDS[ent.key] || []).forEach(function (f) {
        S.booksFields.push({
          entity: ent.key, entityLabel: ent.label, fieldId: null,
          label: f.label, apiName: f.apiName, standard: true
        });
      });
    });
    S.booksScanned = true;
    if (failures === BOOKS_ENTITIES.length) {
      showError("Could not read any Zoho Books custom fields (standard-field matching still applies). Check the \"" +
        $("conn-books").value + "\" connection, its ZohoBooks.settings.READ scope, and the selected organization.");
    }
  });
}

// Creator's form Deluge scripts aren't readable via this API, only field
// metadata is, so like Books this is a name match, purely informational.
// Walks each selected app's forms, then each form's fields. The field key
// names below (display_name/link_name) mirror the same Meta API family's
// applications/forms response shape; unconfirmed against a live org response
// for the fields endpoint specifically, verify if this comes back empty.
function scanCreator() {
  S.creatorFields = []; S.creatorScanned = false;
  var apps = selectedCreatorApps();
  var appFailures = 0, formFailures = 0;
  $("scan-progress").innerHTML = "Listing Zoho Creator forms&hellip;";
  showLoader("Listing Zoho Creator forms...");
  var formTargets = [];
  return runQueue(apps, function (a) {
    return creatorGet("/meta/" + a.workspaceName + "/" + a.appName + "/forms").then(function (body) {
      (body.forms || []).forEach(function (f) {
        formTargets.push({ app: a, linkName: f.link_name, label: f.display_name || f.link_name });
      });
    }).catch(function () { appFailures++; });
  }, function (i, n, a) {
    $("scan-progress").innerHTML = "Listing Creator forms <b>" + i + " / " + n + "</b> - " + esc(a.label);
    showLoader("Listing Creator forms " + i + " / " + n, n ? i / n : null);
  }).then(function () {
    return runQueue(formTargets, function (t) {
      return creatorGet("/meta/" + t.app.workspaceName + "/" + t.app.appName + "/form/" + t.linkName + "/fields")
        .then(function (body) {
          (body.fields || []).forEach(function (fl) {
            S.creatorFields.push({
              appLabel: t.app.label, formLabel: t.label,
              label: fl.display_name || fl.link_name, apiName: fl.link_name
            });
          });
        }).catch(function () { formFailures++; });
    }, function (i, n, t) {
      $("scan-progress").innerHTML = "Reading Creator fields <b>" + i + " / " + n + "</b> - " + esc(t.label);
      showLoader("Reading Creator fields " + i + " / " + n, n ? i / n : null);
    });
  }).then(function () {
    S.creatorScanned = true;
    if (apps.length && appFailures === apps.length) {
      showError("Could not list forms for any selected Zoho Creator app. Check the \"" + $("conn-creator").value +
        "\" connection and that it is authorized.");
    } else if (formFailures > 0 && S.creatorFields.length === 0) {
      showError("Could not read fields for any Zoho Creator form (" + formFailures +
        " unreadable). Field matching is inactive.");
    }
  });
}

// A year's worth of unused reports can be hundreds of detail calls, so this
// filters to recently-accessed ones before fetching detail at all, not after.
// Confirmed against a real list response: every report carries last_run_date,
// null when it's never been run. If it has been run, that's the real signal
// (within the past year). If it's never been run, fall back to created_time:
// a never-run report created over 6 months ago is treated as stale and
// skipped, a newer never-run one still gets a look since it just hasn't had
// time to be run yet. If neither date is usable at all, there's nothing to
// judge recency by, so it's skipped too.
var REPORT_RECENCY_DAYS = 365;
var REPORT_NEW_GRACE_DAYS = 180;
function withinDays(dateStr, days) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) <= days * 24 * 60 * 60 * 1000;
}
function wasRecentlyAccessed(r) {
  var ranRecently = withinDays(r.last_run_date, REPORT_RECENCY_DAYS);
  if (ranRecently !== null) return ranRecently;
  var createdRecently = withinDays(r.created_time, REPORT_NEW_GRACE_DAYS);
  if (createdRecently !== null) return createdRecently;
  return false;
}

// The list endpoint below (/crm/v8/Reports) is a best-effort guess, only the
// detail endpoint (/crm/v8/Reports/{id}) has been confirmed from a real
// network capture. If this comes back empty on a real org, check the
// network tab for the actual list call and fix the path here.
function scanReports() {
  S.reports = []; S.reportsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM reports&hellip;";
  showLoader("Listing CRM reports...");
  var failures = 0;
  return crmGet("/Reports").then(function (body) {
    var all = (body && (body.reports || body.Reports)) || [];
    var list = all.filter(wasRecentlyAccessed);
    var listed = list.length;
    S.reportsSkippedStale = all.length - list.length;
    return runQueue(list, function (r) {
      return crmGet("/Reports/" + r.id).then(function (detail) {
        var full = (detail && detail.Reports && detail.Reports[0]) || detail;
        if (!full) { failures++; return; }
        S.reports.push({
          id: full.id, name: full.name,
          folderName: (full.folder && full.folder.name) || "",
          moduleApiName: full.module && full.module.api_name,
          joins: (full.joins || []).map(function (j) {
            return { relation: j.relation, moduleApiName: j.module && j.module.api_name };
          }),
          refs: extractReportFieldRefs(full)
        });
      }).catch(function () { failures++; });
    }, function (i, n, r) {
      $("scan-progress").innerHTML = "Reading report <b>" + i + " / " + n + "</b> - " + esc(r.display_name || r.name || "");
      showLoader("Reading report " + i + " / " + n, n ? i / n : null);
    }).then(function () {
      S.reportsScanned = true;
      if (failures > 0) {
        showError("Read " + S.reports.length + " of " + listed + " CRM reports." +
          (S.reports.length === 0 ? " None were readable, so report matching is inactive." : ""));
      }
    });
  }).catch(function (err) {
    showError("Reports scan failed. Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.reports.READ scope.\n" + String(err && err.message || err));
  });
}

// Walks a report's columns and filters (recursively through nested filter
// groups, plus the separate date_filter) collecting every field reference.
// Scoped to columns + filters only, by design; group_by/sort_by/aggregate
// functions/territory_filter aren't included.
function extractReportFieldRefs(report) {
  var refs = [];
  (report.columns || []).forEach(function (c) {
    if (c.field && c.field.api_name) refs.push({ apiName: c.field.api_name, kind: "column" });
  });
  function walkFilter(f, kind) {
    if (!f) return;
    if (f.group && f.group.length) { f.group.forEach(function (g) { walkFilter(g, kind); }); return; }
    if (f.field && f.field.api_name) refs.push({ apiName: f.field.api_name, kind: kind });
  }
  walkFilter(report.filters, "filter");
  walkFilter(report.date_filter, "date filter");
  return refs;
}

// filterByFolder is only ever true for the reverse audit, which is the one
// case that actually needs it (narrowing a mixed workspace so its Analytics
// -> CRM name matching doesn't drown in unrelated apps' tables). A normal
// scan, whether checking CRM or Creator fields, covers every folder, same
// as it always has for CRM: field-name matching doesn't care what folder a
// table lives in, only the reverse audit's blind "every column" sweep does.
function scanAnalytics(targets, filterByFolder) {
  showLoader("Listing Analytics views…");
  var detailTargets = [];
  return runQueue(targets, function (w) {
    $("scan-progress").innerHTML = "Listing views in <b>" + esc(w.workspaceName) + "</b>&hellip;";
    showLoader("Listing views in “" + w.workspaceName + "”…");
    return analyticsGet("/workspaces/" + w.workspaceId + "/views", { noOfResult: 1000 })
      .then(function (body) {
        var views = (body.data && body.data.views) || [];
        views.forEach(function (v) {
          if (filterByFolder && !folderAllowed(w.workspaceId, v.folderId)) return;
          S.viewCount++;
          if (v.viewType === "Table" || v.viewType === "QueryTable") {
            detailTargets.push({ ws: w, view: v });
          }
        });
      });
  }).then(function () {
    return runQueue(detailTargets, function (t) {
      return analyticsGet("/views/" + t.view.viewId, { withInvolvedMetaInfo: true })
        .then(function (body) {
          var d = (body.data && body.data.views) || {};
          if (t.view.viewType === "Table") {
            S.tables.push({
              wsId: t.ws.workspaceId, wsName: t.ws.workspaceName,
              viewId: t.view.viewId, viewName: t.view.viewName,
              columns: (d.columns || []).map(function (c) {
                return {
                  columnId: c.columnId, columnName: c.columnName,
                  dataType: c.dataTypeName || c.dataType || null,
                  formula: c.formulaDisplayName || ""
                };
              })
            });
          } else {
            // SQL key name is plan-dependent; take any long string under a sql/query key
            var sql = "";
            (function walk(o) {
              if (!o || typeof o !== "object") return;
              Object.keys(o).forEach(function (k) {
                if (typeof o[k] === "string" && /sql|query/i.test(k) && o[k].length > 10) sql += o[k] + "\n";
                else if (typeof o[k] === "object") walk(o[k]);
              });
            })(d);
            S.queryTables.push({
              wsId: t.ws.workspaceId, wsName: t.ws.workspaceName,
              viewId: t.view.viewId, viewName: t.view.viewName, sql: sql
            });
          }
        })
        .catch(function () { /* skip unreadable views; surfaced in totals */ });
    }, function (i, n, t) {
      $("scan-progress").innerHTML = "Reading structure <b>" + i + " / " + n + "</b> &mdash; " + esc(t.view.viewName);
      showLoader("Reading structure " + i + " / " + n, n ? i / n : null);
    });
  });
}

// Invoke without the JSON-failure check: /code returns raw file content
// whose shape through CONNECTION.invoke is not a normal JSON body.
function invokeRaw(connName, url) {
  var req = { url: url, method: "GET", param_type: 1, parameters: {}, headers: {} };
  return ZOHO.CRM.CONNECTION.invoke(connName, req);
}

// Pull script text out of whatever shape the response takes: a raw text
// body, a JSON string, or an object with the code nested under some key.
function extractCode(x) {
  if (!x) return null;
  if (typeof x === "string") {
    var t = x.trim();
    if (!t) return null;
    if (t[0] === "{" || t[0] === "[") {
      try { return extractCode(JSON.parse(t)); } catch (e) { return t; }
    }
    return t;
  }
  if (typeof x !== "object") return null;
  // Error payloads: {"code":"INVALID_TOKEN","message":...} must not pass as script
  if (x.status === "failure" || (typeof x.code === "string" && x.message)) return null;
  var keyed = [], other = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === "string") {
        if (/script|code|workflow|content|response|body|file|data/i.test(k) && v.length >= 20) keyed.push(v);
        else if (v.length >= 60) other.push(v);
      } else if (typeof v === "object") walk(v);
    });
  })(x);
  var pool = keyed.length ? keyed : other;
  if (!pool.length) return null;
  return pool.sort(function (a, b) { return b.length - a.length; })[0];
}

var loggedFirstCodeResp = false;
function fetchFunctionCode(fn) {
  var conn = $("conn-crm").value.trim();
  var base = crmApiBase() + "/crm/v8/settings/functions/" + fn.id;
  return invokeRaw(conn, base + "/code").then(function (resp) {
    if (!loggedFirstCodeResp) {
      loggedFirstCodeResp = true;
      console.log("FieldCheck: raw /code response for", fn.name, resp);
    }
    // File downloads resolve as the raw text body itself; JSON APIs
    // resolve as {details: {statusMessage: ...}}. Handle both.
    var payload = (resp && resp.details) ? (resp.details.statusMessage || resp.details) : resp;
    var code = extractCode(payload);
    if (code) return { code: code, raw: null };
    // Fallback: the single-function endpoint returns JSON that can carry the script
    return invokeRaw(conn, base + "?source=crm").then(function (r2) {
      var c2 = extractCode(r2 && r2.details && r2.details.statusMessage) ||
               extractCode(r2 && r2.details);
      return { code: c2, raw: c2 ? null : JSON.stringify({ codeResp: resp, detailResp: r2 }).slice(0, 800) };
    });
  });
}

function scanFunctions() {
  S.functions = []; S.functionsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM Deluge functions&hellip;";
  showLoader("Listing CRM Deluge functions…");
  var failures = 0, firstSample = "";
  return crmGet("/settings/functions").then(function (body) {
    var fns = (body && body.functions) || [];
    var listed = fns.length;
    return runQueue(fns, function (fn) {
      return fetchFunctionCode(fn).then(function (out) {
        if (out.code) {
          S.functions.push({ id: fn.id, name: fn.display_name || fn.name, code: out.code });
        } else {
          failures++;
          if (!firstSample && out.raw) firstSample = out.raw;
        }
      }).catch(function (err) {
        failures++;
        if (!firstSample) firstSample = String(err && err.message || err).slice(0, 800);
      });
    }, function (i, n, fn) {
      $("scan-progress").innerHTML = "Reading function code <b>" + i + " / " + n + "</b> &mdash; " +
        esc(fn.display_name || fn.name);
      showLoader("Reading function code " + i + " / " + n, n ? i / n : null);
    }).then(function () {
      S.functionsScanned = true;
      if (failures > 0) {
        showError("Read code for " + S.functions.length + " of " + listed + " functions." +
          (S.functions.length === 0 ? " None were readable, so function matching is inactive." : "") +
          (firstSample ? "\nFirst unreadable response sample:\n" + firstSample : ""));
      }
    });
  }).catch(function (err) {
    showError("Functions scan failed (Analytics results are unaffected). Check the \"" +
      $("conn-crm").value + "\" connection and its ZohoCRM.settings.functions.READ scope.\n" +
      String(err && err.message || err));
  });
}

$("btn-cache").onclick = function () {
  var c = JSON.parse(localStorage.getItem(SCAN_KEY));
  S.tables = c.tables; S.queryTables = c.queryTables; S.viewCount = c.viewCount;
  S.functions = c.functions || []; S.functionsScanned = !!c.functionsScanned;
  S.booksFields = c.booksFields || []; S.booksScanned = !!c.booksScanned; S.booksOrgId = c.booksOrgId || null;
  S.reports = c.reports || []; S.reportsScanned = !!c.reportsScanned;
  S.reportsSkippedStale = c.reportsSkippedStale || 0;
  S.creatorFields = c.creatorFields || []; S.creatorScanned = !!c.creatorScanned;
  S.orgId = c.orgId; S.scannedAt = c.at; $("dc").value = c.dc;
  finishScan();
};

function finishScan() {
  S.scanning = false;
  hideLoader();
  var colCount = S.tables.reduce(function (n, t) { return n + t.columns.length; }, 0);
  var stats = [
    "<b>" + S.viewCount + "</b> views",
    "<b>" + S.tables.length + "</b> tables (" + colCount + " columns)",
    "<b>" + S.queryTables.length + "</b> query " + (S.queryTables.length === 1 ? "table" : "tables")
  ];
  if (S.functionsScanned) stats.push("<b>" + S.functions.length + "</b> functions");
  if (S.booksScanned) stats.push("<b>" + S.booksFields.length + "</b> Books fields");
  if (S.creatorScanned) stats.push("<b>" + S.creatorFields.length + "</b> Creator fields");
  if (S.reportsScanned) {
    stats.push("<b>" + S.reports.length + "</b> reports" +
      (S.reportsSkippedStale ? " (" + S.reportsSkippedStale + " skipped, not accessed in the past year)" : ""));
  }
  var p = $("scan-progress");
  p.classList.add("done");
  p.innerHTML = "<b>Last scan · " + esc(S.scannedAt) + "</b>" +
    "<span class='scan-stats'>" + stats.join(" · ") + "</span>";
  updateScanButton();
  $("results").classList.remove("hidden");
  $("reverse-audit-card").classList.add("hidden");
  $("setup-card").classList.add("collapsed");
  var t = $("btn-toggle-setup");
  t.classList.remove("hidden");
  t.textContent = "Settings";
  var haveCreatorFields = S.creatorScanned && S.creatorFields.length > 0;
  $("field-mode-tabs").classList.toggle("hidden", !haveCreatorFields);
  setFieldMode(haveCreatorFields && S.fieldMode === "creator" ? "creator" : "crm");
}

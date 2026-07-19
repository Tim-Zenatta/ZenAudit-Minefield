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
// they stay hidden otherwise to keep the normal scan card uncluttered.
// Selection state itself isn't reset when hidden, it still governs
// scanAnalytics() either way.
function updateSelectorVisibility() {
  var show = $("include-reverse-audit").checked;
  $("ws-section").classList.toggle("hidden", !show || !S.workspaces.length);
  renderFolderList();
}

// One workspace can mix tables from several apps (e.g. a consolidated "Zoho
// One" workspace), which confuses both this and the reverse audit's name
// matching. Folders are a natural scoping boundary for that, best-effort:
// if a workspace's folders can't be read, scanning it stays unfiltered
// rather than silently excluding everything. Default to only the CRM data
// folder selected, since that's the one real signal to trust automatically;
// everything else needs an explicit opt-in.
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

// Source toggle tiles: keep the tile styling in sync and refresh the button
["include-an", "include-fns"].forEach(function (id) {
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

// The reverse audit is a different operation (Analytics -> CRM instead of
// CRM -> Analytics) that runs standalone; selecting it locks out the normal
// scan sources rather than combining with them.
$("include-reverse-audit").onchange = function () {
  var cb = $("include-reverse-audit");
  var exclusive = cb.checked;
  ["include-an", "include-fns", "include-books"].forEach(function (id) {
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
  var an = $("include-an").checked, fns = $("include-fns").checked, books = $("include-books").checked;
  var srcs = (an ? 1 : 0) + (fns ? 1 : 0) + (books ? 1 : 0);
  var label = "Scan " + srcs + (srcs === 1 ? " source" : " sources");
  if (an) label += " · " + ws + (ws === 1 ? " workspace" : " workspaces");
  btn.textContent = srcs ? label : "Scan";
  btn.disabled = !!(S.scanning || !S.sdkReady || !srcs || (an && !ws) || (books && !S.booksOrgId));
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
    scanAnalytics(wsTargets).then(function () {
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

  var doAn = $("include-an").checked, doFns = $("include-fns").checked, doBooks = $("include-books").checked;
  if (!doAn && !doFns && !doBooks) { showError("Turn on at least one scan source."); return; }
  var targets = doAn ? selectedWorkspaces() : [];
  if (doAn && !targets.length) { showError("Select at least one workspace."); return; }
  if (doBooks && !S.booksOrgId) { showError("Select a Books organization before scanning."); return; }
  S.scanning = true;
  $("btn-scan").disabled = true;
  $("scan-progress").classList.remove("done");
  S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {}; S.results = {};

  (doAn ? scanAnalytics(targets) : Promise.resolve()).then(function () {
    return doFns ? scanFunctions() : null;
  }).then(function () {
    return doBooks ? scanBooks() : null;
  }).then(function () {
    S.scannedAt = new Date().toLocaleString();
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify({
        at: S.scannedAt, orgId: S.orgId, dc: $("dc").value,
        tables: S.tables, queryTables: S.queryTables, viewCount: S.viewCount,
        functions: S.functions, functionsScanned: S.functionsScanned,
        booksFields: S.booksFields, booksScanned: S.booksScanned, booksOrgId: S.booksOrgId
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

function scanAnalytics(targets) {
  showLoader("Listing Analytics views…");
  var detailTargets = [];
  return runQueue(targets, function (w) {
    $("scan-progress").innerHTML = "Listing views in <b>" + esc(w.workspaceName) + "</b>&hellip;";
    showLoader("Listing views in “" + w.workspaceName + "”…");
    return analyticsGet("/workspaces/" + w.workspaceId + "/views", { noOfResult: 1000 })
      .then(function (body) {
        var views = (body.data && body.data.views) || [];
        views.forEach(function (v) {
          if (!folderAllowed(w.workspaceId, v.folderId)) return;
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
  loadFields();
}

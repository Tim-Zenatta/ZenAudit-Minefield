"use strict";

// The scan pipeline: connect to Analytics, walk workspaces and views, capture
// table columns and query table SQL, and optionally pull CRM Deluge function
// code. Results land in S and are cached in localStorage.

function loadOrgs() {
  clearError();
  S.orgId = null;
  return analyticsGet("/orgs").then(function (body) {
    var orgs = (body.data && body.data.orgs) || [];
    var pick = $("org-pick");
    pick.innerHTML = "";
    orgs.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.orgId; opt.textContent = o.orgName + " (" + o.orgId + ")";
      pick.appendChild(opt);
    });
    pick.disabled = false;
    $("btn-workspaces").disabled = false;
    saveSettings();
    if (orgs.length === 1) return loadWorkspaces();
  }).catch(function (err) {
    showError("Could not reach Zoho Analytics through connection \"" +
      $("conn-analytics").value + "\". Check the connection link name and that it is authorized.\n" +
      String(err && err.message || err));
  });
}
$("btn-orgs").onclick = loadOrgs;

function loadWorkspaces() {
  clearError();
  S.orgId = $("org-pick").value;
  return analyticsGet("/workspaces").then(function (body) {
    var all = ((body.data && body.data.ownedWorkspaces) || [])
      .concat((body.data && body.data.sharedWorkspaces) || []);
    S.workspaces = all.map(function (w) {
      return { workspaceId: w.workspaceId, workspaceName: w.workspaceName, selected: true };
    });
    $("ws-section").classList.remove("hidden");
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
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(w.workspaceName));
      box.appendChild(lab);
    });
    $("btn-scan").disabled = false;
  }).catch(function (err) { showError(String(err && err.message || err)); });
}
$("btn-workspaces").onclick = loadWorkspaces;

// The scan only needs deep details for Tables (their columns carry the
// columnIds used by the dependents API) and Query Tables (their SQL).
// Everything else is reached through Zoho's own dependency engine.
$("btn-scan").onclick = function () {
  clearError();
  var targets = S.workspaces.filter(function (w) { return w.selected; });
  if (!targets.length) { showError("Select at least one workspace."); return; }
  $("btn-scan").disabled = true;
  S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {}; S.results = {};

  showLoader("Listing Analytics views…");
  var detailTargets = [];
  runQueue(targets, function (w) {
    $("scan-progress").innerHTML = "Listing views in <b>" + esc(w.workspaceName) + "</b>&hellip;";
    showLoader("Listing views in “" + w.workspaceName + "”…");
    return analyticsGet("/workspaces/" + w.workspaceId + "/views", { noOfResult: 1000 })
      .then(function (body) {
        var views = (body.data && body.data.views) || [];
        S.viewCount += views.length;
        views.forEach(function (v) {
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
                return { columnId: c.columnId, columnName: c.columnName };
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
  }).then(function () {
    return $("include-fns").checked ? scanFunctions() : null;
  }).then(function () {
    S.scannedAt = new Date().toLocaleString();
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify({
        at: S.scannedAt, orgId: S.orgId, dc: $("dc").value,
        tables: S.tables, queryTables: S.queryTables, viewCount: S.viewCount,
        functions: S.functions, functionsScanned: S.functionsScanned
      }));
    } catch (e) { /* cache is best-effort */ }
    finishScan();
  }).catch(function (err) {
    hideLoader();
    $("btn-scan").disabled = false;
    showError(String(err && err.message || err));
  });
};

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
  S.orgId = c.orgId; S.scannedAt = c.at; $("dc").value = c.dc;
  finishScan();
};

function finishScan() {
  hideLoader();
  var colCount = S.tables.reduce(function (n, t) { return n + t.columns.length; }, 0);
  $("scan-progress").innerHTML = "Scan complete (" + S.scannedAt + "): <b>" + S.viewCount +
    "</b> views seen, <b>" + S.tables.length + "</b> tables (" + colCount + " columns), <b>" +
    S.queryTables.length + "</b> query tables" +
    (S.functionsScanned ? ", <b>" + S.functions.length + "</b> CRM Deluge functions." : ". Functions not scanned.");
  $("btn-scan").disabled = false;
  $("btn-scan").textContent = "Rescan";
  $("results").classList.remove("hidden");
  $("setup-card").classList.add("collapsed");
  var t = $("btn-toggle-setup");
  t.classList.remove("hidden");
  t.textContent = "show settings";
  loadFields();
}

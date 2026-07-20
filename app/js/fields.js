"use strict";

// CRM field loading plus the analysis layer: mapping fields to Analytics
// columns, fetching dependents, and computing verdicts.

function loadModules() {
  ZOHO.CRM.META.getModules().then(function (resp) {
    S.modules = (resp.modules || []).filter(function (m) {
      return m.api_supported && m.generated_type !== "linking";
    });
    var pick = $("module-pick");
    pick.innerHTML = "";
    S.modules.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.api_name; opt.textContent = m.plural_label;
      pick.appendChild(opt);
    });
    pick.onchange = loadFields;
  });
}

function loadFields() {
  var mod = $("module-pick").value;
  if (!mod) return;
  ZOHO.CRM.META.getFields({ Entity: mod }).then(function (resp) {
    S.fields = (resp.fields || []).map(function (f) {
      return { api_name: f.api_name, label: f.field_label, type: f.data_type, custom: !!f.custom_field };
    });
    S.results = {};
    S.activeField = null;
    renderFieldList();
    $("detail-body").innerHTML = "<p class='section-note'>Select a field on the left, or run \"Check all fields\".</p>";
  });
}

function moduleTableFirst(field) {
  // Columns whose normalized name equals the field's label or API name.
  // Tables named like the module are checked first and flagged primary;
  // same-named columns in other tables still get checked, labeled by table.
  var modNorm = norm($("module-pick").selectedOptions[0].textContent);
  var wanted = {}; wanted[norm(field.label)] = 1; wanted[norm(field.api_name)] = 1;
  var matches = [];
  S.tables.forEach(function (t) {
    t.columns.forEach(function (c) {
      if (wanted[norm(c.columnName)]) {
        matches.push({ table: t, col: c, primary: norm(t.viewName).indexOf(modNorm) >= 0 });
      }
    });
  });
  matches.sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); });
  return matches;
}

function getDependents(m) {
  if (S.depCache[m.col.columnId]) return Promise.resolve(S.depCache[m.col.columnId]);
  return analyticsGet("/workspaces/" + m.table.wsId + "/views/" + m.table.viewId +
    "/columns/" + m.col.columnId + "/dependents").then(function (body) {
    var d = body.data || {};
    var payload = {
      views: d.views || [],
      customFormulas: d.customFormulas || [],
      aggregateFormulas: d.aggregateFormulas || []
    };
    S.depCache[m.col.columnId] = payload;
    return payload;
  });
}

function sqlHits(field) {
  var hits = [];
  [field.label, field.api_name].forEach(function (needle) {
    if (!needle || needle.length < 3) return;
    var re = new RegExp("(^|[^A-Za-z0-9_])" + escRe(needle) + "([^A-Za-z0-9_]|$)", "i");
    S.queryTables.forEach(function (qt) {
      if (qt.sql && re.test(qt.sql) && !hits.some(function (h) { return h.viewId === qt.viewId; })) {
        var m = qt.sql.match(new RegExp(".{0,50}" + escRe(needle) + ".{0,50}", "i"));
        hits.push({ viewId: qt.viewId, viewName: qt.viewName, wsName: qt.wsName, wsId: qt.wsId,
                    snippet: m ? m[0].replace(/\s+/g, " ") : "" });
      }
    });
  });
  return hits;
}

// Deluge scripts reference fields by API name (record.get("Stage"),
// input.Stage, criteria strings), so functions are searched on API name only.
function functionHits(field) {
  var hits = [];
  if (!field.api_name || field.api_name.length < 3) return hits;
  var re = new RegExp("(^|[^A-Za-z0-9_])" + escRe(field.api_name) + "([^A-Za-z0-9_]|$)", "i");
  S.functions.forEach(function (fn) {
    if (!re.test(fn.code)) return;
    var count = (fn.code.match(new RegExp(escRe(field.api_name), "gi")) || []).length;
    var m = fn.code.match(new RegExp(".{0,60}" + escRe(field.api_name) + ".{0,60}", "i"));
    hits.push({ name: fn.name, count: count, snippet: m ? m[0].replace(/\s+/g, " ") : "" });
  });
  return hits;
}

// Zoho's native CRM-Books sync mapping isn't readable via API, so this is a
// name match against Books custom and standard fields, purely informational
// (see scan.js BOOKS_ENTITIES/STANDARD_BOOKS_FIELDS). Never affects hitCount/categoryOf.
function bookMatches(field) {
  if (!S.booksScanned) return [];
  var wanted = {}; wanted[norm(field.label)] = 1; wanted[norm(field.api_name)] = 1;
  return S.booksFields.filter(function (bf) {
    return wanted[norm(bf.label)] || wanted[norm(bf.apiName)];
  });
}

// A report field reference is either bare ("Achievement", on the report's
// own module), one hop through a join ("Forecast_Name.Group_Id", resolved
// via that report's joins list), or a multi-hop lookup chain
// ("Forecast_Name.Group_Id.Forecast_Group_Name") that can't be resolved to a
// module without extra API calls per intermediate module. Bare and one-hop
// references are verified against the currently checked field's module;
// anything deeper is reported by name only, flagged unverified rather than
// silently treated as equally certain.
function resolveRefModule(report, parts) {
  if (parts.length === 1) return { known: true, moduleApiName: report.moduleApiName };
  if (parts.length === 2) {
    var j = (report.joins || []).filter(function (x) { return x.relation === parts[0]; })[0];
    return j ? { known: true, moduleApiName: j.moduleApiName } : { known: false, moduleApiName: null };
  }
  return { known: false, moduleApiName: null };
}

// Report references are by api_name only, same reasoning as functionHits.
// Counts toward hitCount/categoryOf just like Analytics and function hits,
// per your call that this should behave "just like functions."
function reportHits(field) {
  if (!S.reportsScanned || !field.api_name) return [];
  var currentModule = $("module-pick").value;
  var hits = [];
  S.reports.forEach(function (r) {
    r.refs.forEach(function (ref) {
      var parts = ref.apiName.split(".");
      var tail = parts[parts.length - 1];
      if (norm(tail) !== norm(field.api_name)) return;
      var resolved = resolveRefModule(r, parts);
      if (resolved.known && resolved.moduleApiName !== currentModule) return;
      hits.push({
        reportId: r.id, reportName: r.name, folderName: r.folderName,
        kind: ref.kind, confident: resolved.known
      });
    });
  });
  return hits;
}

function checkField(field) {
  if (S.results[field.api_name]) return Promise.resolve(S.results[field.api_name]);
  var matches = moduleTableFirst(field);
  var result = {
    columns: [], sql: sqlHits(field), functions: functionHits(field), books: bookMatches(field),
    reports: reportHits(field), notSynced: matches.length === 0
  };
  return runQueue(matches, function (m) {
    return getDependents(m).then(function (dep) {
      result.columns.push({
        tableName: m.table.viewName, wsName: m.table.wsName, wsId: m.table.wsId, primary: m.primary,
        columnName: m.col.columnName, dep: dep
      });
    }).catch(function () {
      result.columns.push({ tableName: m.table.viewName, wsName: m.table.wsName, wsId: m.table.wsId,
        primary: m.primary, columnName: m.col.columnName, dep: null, error: true });
    });
  }).then(function () {
    S.results[field.api_name] = result;
    return result;
  });
}

function hitCount(result) {
  return result.columns.reduce(function (n, c) {
    if (!c.dep) return n;
    return n + c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
  }, 0) + result.sql.length + (result.functions || []).length + (result.reports || []).length;
}

function categoryOf(f) {
  var r = S.results[f.api_name];
  if (!r) return "unchecked";
  if (hitCount(r) > 0) return "used"; // function/report hits count even when not synced to Analytics
  return r.notSynced ? "na" : "clear";
}

// Two flavors of safe-to-delete: green "unused" = synced to Analytics but
// nothing depends on it; gray "not synced" = absent from Analytics entirely.
// Both imply no CRM function/report references (those force the used state).
function naLabel() { return (S.functionsScanned || S.reportsScanned) ? "not synced" : "not in Analytics"; }

function usageCounts(r) {
  var an = r.sql.length, fn = (r.functions || []).length, rpt = (r.reports || []).length;
  r.columns.forEach(function (c) {
    if (!c.dep) return;
    an += c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
  });
  return { analytics: an, functions: fn, reports: rpt, books: (r.books || []).length };
}

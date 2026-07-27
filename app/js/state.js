"use strict";

// Shared application state. Every other file reads and writes S; nothing else
// holds cross-feature data.
var S = {
  orgId: null,
  workspaces: [],     // {workspaceId, workspaceName, selected}
  folders: [],        // {folderId, folderName, wsId, wsName, selected}
  tables: [],         // {wsId, wsName, viewId, viewName, columns:[{columnId, columnName}]}
  queryTables: [],    // {wsId, wsName, viewId, viewName, sql}
  analyticsScanned: false,
  functions: [],      // {id, name, code}
  functionsScanned: false,
  booksOrgId: null,
  booksFields: [],    // {entity, entityLabel, fieldId, label, apiName}
  booksScanned: false,
  creatorApps: [],       // {workspaceName, appName, label, selected}
  creatorFields: [],     // {appLabel, formLabel, label, apiName}
  creatorScanned: false,
  reports: [],        // {id, name, folderName, moduleApiName, joins, refs:[{apiName, kind}]}
  reportsScanned: false,
  reportsSkippedStale: 0,
  // moduleId is what field-matching actually keys off; moduleApiName is kept
  // alongside for display/debugging (see fields.js currentModuleId comment
  // for why api_name alone isn't reliable across automation endpoints).
  workflowFieldUpdates: [], // {id, name, moduleApiName, moduleId, fieldApiName, value, valueType, featureType}
  workflowFieldUpdatesScanned: false,
  workflowRules: [], // {id, name, moduleApiName, moduleId, triggerFields:[apiName], criteriaFields:[apiName]}
  workflowRulesScanned: false,
  scoringRules: [], // {id, name, moduleApiName, moduleId, criteriaFields:[apiName]}
  scoringRulesScanned: false,
  blueprintFields: [], // {id, name, moduleApiName, moduleId, fieldApiName, pipelineName}
  blueprintFieldsScanned: false,
  viewCount: 0,
  modules: [],
  fieldMode: "crm",   // "crm" | "creator" — which source Step 2/3 are browsing
  fields: [],
  results: {},        // field api_name -> usage result (see checkField)
  depCache: {},       // columnId -> dependents payload
  activeField: null,
  scannedAt: null,
  checking: false,
  scanning: false,
  sdkReady: false,
  filter: "all",
  crmZgid: null,
  moduleFieldsCache: {},   // module api_name -> [{label, api_name}], for the reverse audit
  reverseAuditResults: []  // [{table, module, unmatched}], see reverse-audit.js
};
var SCAN_KEY = "fieldcheck.scan.v3";

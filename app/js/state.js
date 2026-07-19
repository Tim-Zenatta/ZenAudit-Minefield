"use strict";

// Shared application state. Every other file reads and writes S; nothing else
// holds cross-feature data.
var S = {
  orgId: null,
  workspaces: [],     // {workspaceId, workspaceName, selected}
  folders: [],        // {folderId, folderName, wsId, wsName, selected}
  tables: [],         // {wsId, wsName, viewId, viewName, columns:[{columnId, columnName}]}
  queryTables: [],    // {wsId, wsName, viewId, viewName, sql}
  functions: [],      // {id, name, code}
  functionsScanned: false,
  booksOrgId: null,
  booksFields: [],    // {entity, entityLabel, fieldId, label, apiName}
  booksScanned: false,
  viewCount: 0,
  modules: [],
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

"use strict";

// Persisted settings (connection names, data center, theme), theme toggle,
// and small setup-card UI toggles.

var SETTINGS_KEY = "fieldcheck.settings.v1";
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      conn: $("conn-analytics").value, crmConn: $("conn-crm").value, dc: $("dc").value, theme: THEME
    }));
  } catch (e) { /* best-effort */ }
}
function restoreSettings() {
  var raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    var s = JSON.parse(raw);
    if (s.conn) $("conn-analytics").value = s.conn;
    if (s.crmConn) $("conn-crm").value = s.crmConn;
    if (s.dc) $("dc").value = s.dc;
    applyTheme(s.theme === "light" ? "light" : "dark");
  } catch (e) { /* ignore bad cache */ }
}
// Changing the Analytics connection or data center re-resolves orgs and
// workspaces automatically (loadOrgs is defined in scan.js, loaded later).
$("conn-analytics").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };
$("conn-crm").onchange = saveSettings;
$("dc").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };

var THEME = "dark";
function applyTheme(t) {
  THEME = t;
  document.body.classList.toggle("dark", t === "dark");
  $("theme-toggle").innerHTML = t === "dark" ? "&#9728;&#65039;" : "&#127769;";
  $("theme-toggle").title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
$("theme-toggle").onclick = function () {
  applyTheme(THEME === "dark" ? "light" : "dark");
  saveSettings();
};
$("btn-toggle-setup").onclick = function () {
  var card = $("setup-card");
  card.classList.toggle("collapsed");
  this.textContent = card.classList.contains("collapsed") ? "Settings" : "Hide settings";
};
$("btn-guide").onclick = function () { $("guide").classList.toggle("hidden"); };
// Click any scope chip to copy it for the connection form
document.addEventListener("click", function (e) {
  var el = e.target;
  if (el.tagName !== "CODE" || !(el.closest(".scopes") || el.closest(".guide"))) return;
  var text = el.textContent;
  if (text === "copied!") return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      el.textContent = "copied!";
      setTimeout(function () { el.textContent = text; }, 900);
    });
  }
});

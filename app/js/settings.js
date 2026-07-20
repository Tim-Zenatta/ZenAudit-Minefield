"use strict";

// Persisted settings (connection names, data center, theme), theme toggle,
// and small setup-card UI toggles.

var SETTINGS_KEY = "fieldcheck.settings.v1";
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      conn: $("conn-analytics").value, crmConn: $("conn-crm").value, booksConn: $("conn-books").value,
      includeBooks: $("include-books").checked, dc: $("dc").value, theme: THEME
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
    if (s.booksConn) $("conn-books").value = s.booksConn;
    if (s.includeBooks) {
      $("include-books").checked = true;
      $("include-books").closest(".src-tile").classList.add("on");
    }
    if (s.dc) $("dc").value = s.dc;
    applyTheme(THEME_META.hasOwnProperty(s.theme) ? s.theme : "dark");
  } catch (e) { /* ignore bad cache */ }
}
// Changing the Analytics connection or data center re-resolves orgs and
// workspaces automatically (loadOrgs is defined in scan.js, loaded later).
$("conn-analytics").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };
$("conn-crm").onchange = saveSettings;
$("conn-books").onchange = function () {
  saveSettings();
  S.booksOrgId = null;
  if (S.sdkReady && $("include-books").checked) loadBooksOrgs();
};
$("dc").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };

// Three themes cycle dark -> light -> zen -> dark. The toggle button shows
// the icon for whatever theme clicking it switches TO next, not the current
// one (matching the original dark/light toggle's behavior).
var THEME = "dark";
var THEME_NEXT = { dark: "light", light: "zen", zen: "dark" };
var THEME_META = {
  dark: { icon: "&#127769;", label: "dark" },        // moon
  light: { icon: "&#9728;&#65039;", label: "light" }, // sun
  zen: { icon: "&#127807;", label: "zen" }            // herb sprig
};
function applyTheme(t) {
  THEME = t;
  document.body.classList.toggle("dark", t === "dark");
  document.body.classList.toggle("zen", t === "zen");
  var next = THEME_NEXT[t];
  $("theme-toggle").innerHTML = THEME_META[next].icon;
  $("theme-toggle").title = "Switch to " + THEME_META[next].label + " mode";
}
$("theme-toggle").onclick = function () {
  applyTheme(THEME_NEXT[THEME]);
  saveSettings();
};
$("btn-toggle-setup").onclick = function () {
  var card = $("setup-card");
  card.classList.toggle("collapsed");
  this.textContent = card.classList.contains("collapsed") ? "Settings" : "Hide settings";
};
// Only ever expands (unlike the Settings link above, which toggles both
// ways); its own visibility is CSS-driven off setup-card's collapsed state,
// so it only shows up while looking at results.
$("btn-back-to-menu").onclick = function () {
  $("setup-card").classList.remove("collapsed");
  $("btn-toggle-setup").textContent = "Hide settings";
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

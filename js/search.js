/* search.js: Ctrl+K (Cmd+K) to go anywhere (owner, 2026-10-09). A <dialog> in the HUD's voice: type a place and press
   Enter, or coordinates "lat, lon" (and a height in km, "lat, lon, km"). Places are looked up with OpenStreetMap's
   Nominatim, one request per Enter (its usage policy: no search-as-you-type); pick a result (the first is focused, so
   Enter again goes) and SITE5.teleport puts the suit there, 5 km up. While the box is open SITE5.typing is set, so the
   keys and the mouse don't fly the suit. Esc or a click outside closes it. */
(function () {
  'use strict';
  var S = window.SITE5, dlg = document.getElementById('find');
  if (!S || !dlg || !dlg.showModal) return;
  var form = document.getElementById('find-form'), q = document.getElementById('find-q');
  var list = document.getElementById('find-list'), say = document.getElementById('find-say');
  var COORD = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)(?:\s*[,\s]\s*(\d+(?:\.\d+)?))?\s*$/;

  function open() {
    if (dlg.open) return;
    S.typing = true; q.value = ''; list.replaceChildren(); say.textContent = '';
    dlg.showModal(); q.focus();
  }
  function go(lat, lon, km) { S.teleport(lat, lon, km); dlg.close(); }
  addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
  });
  dlg.addEventListener('close', function () { S.typing = false; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });   // (the backdrop)
  var asked = 0;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = q.value.trim(), m = COORD.exec(text);
    if (!text) return;
    if (m) {
      var lat = +m[1], lon = +m[2];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { say.textContent = 'LATITUDE -90..90, LONGITUDE -180..180'; return; }
      go(lat, lon, m[3] === undefined ? undefined : +m[3]); return;
    }
    var n = ++asked; list.replaceChildren(); say.textContent = 'SEARCHING';
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' + encodeURIComponent(text), { headers: { 'Accept-Language': 'en' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (rs) {
        if (n !== asked) return;   // (a newer search is under way)
        say.textContent = rs.length ? '' : 'NOTHING FOUND';
        list.replaceChildren.apply(list, rs.map(function (p) {
          var li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button'; b.textContent = p.display_name;
          b.addEventListener('click', function () { go(+p.lat, +p.lon); });
          li.append(b); return li;
        }));
        var first = list.querySelector('button'); if (first) first.focus();
      })
      .catch(function () { if (n === asked) say.textContent = 'SEARCH UNAVAILABLE · TRY LAT, LON'; });
  });
})();

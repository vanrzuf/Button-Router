/**
 * Button Router — panel dla Home Assistant (vanilla JS, bez kroku budowania).
 *
 * Rejestruje custom element <button-router-panel> używany przez panel_custom.
 * Komunikuje się z integracją przez WebSocket API:
 *   button_router/get_config, save_config, clear_discovered, import_yaml,
 *   test_event, set_options, run_action, clear_stats
 * plus subskrypcja push zdarzeń: button_router_event, button_router_config_updated
 * (polling co 5 s zostaje jako rezerwa).
 */
const DEFAULT_EVENT_TYPES = ["esphome.short", "esphome.double", "esphome.long"];
const EVENT_CHOICES = [
  "esphome.short",
  "esphome.double",
  "esphome.long",
  "esphome.press",
  "esphome.hold",
  "esphome.release",
  "esphome.click",
];
const RECENT_LIMIT = 50;

function esc(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pl-PL");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("pl-PL")
    : d.toLocaleString("pl-PL");
}

function stripEsp(es) {
  return String(es || "").replace(/^esphome\./, "");
}

const CSS = `
:host { display: block; padding: 12px 16px 64px; }
.wrap { max-width: 1280px; margin: 0 auto; }
.loading { padding: 24px; color: var(--secondary-text-color); }
.head h1 { font-size: 24px; margin: 8px 0 4px; color: var(--primary-text-color); }
.sub { color: var(--secondary-text-color); margin-bottom: 12px; font-size: 13px; }
code { background: var(--secondary-background-color); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.toolbar input[type="search"] { flex: 1; min-width: 180px; }
.card { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); padding: 14px 16px; margin-bottom: 14px; }
.card h2 { margin: 2px 0 6px; font-size: 18px; color: var(--primary-text-color); }
.cardhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cardhead button:last-child { margin-left: auto; }
.badge { background: var(--primary-color); color: var(--text-primary-color, #fff); border-radius: 10px; padding: 1px 8px; font-size: 12px; vertical-align: middle; }
.hint { color: var(--secondary-text-color); font-size: 12.5px; margin: 4px 0 10px; line-height: 1.5; }
.empty { color: var(--secondary-text-color); font-style: italic; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--divider-color); vertical-align: top; font-size: 13.5px; color: var(--primary-text-color); }
th { color: var(--secondary-text-color); font-weight: 600; font-size: 12px; white-space: nowrap; }
tbody tr:last-child td { border-bottom: none; }
tr.flash { animation: rowflash 1.6s ease; }
@keyframes rowflash { 0% { background: var(--primary-color); } 100% { background: transparent; } }
.muted { color: var(--secondary-text-color); }
.nowrap { white-space: nowrap; }
.btn { font: inherit; cursor: pointer; border: 1px solid var(--divider-color); background: var(--card-background-color, transparent); color: var(--primary-color); border-radius: 6px; padding: 6px 10px; }
.btn:hover { filter: brightness(1.06); }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
.btn.danger { color: var(--error-color, #db4437); }
.btn.sm { padding: 3px 8px; font-size: 12.5px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0; align-items: center; }
.row input { flex: 1; min-width: 140px; }
.cell { min-width: 220px; }
.act { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 2px; }
.act input { flex: 1 1 120px; width: auto; min-width: 110px; margin: 1px 0; }
.act input.datain { flex-basis: 100%; font-family: var(--code-font-family, monospace); font-size: 12px; }
.act .actbtns { display: flex; gap: 3px; }
input.invalid { border-color: var(--error-color, #db4437) !important; background: rgba(219, 68, 55, 0.08); }
.brow { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bname { font-weight: 600; word-break: break-all; }
.statline { font-size: 11.5px; margin-top: 2px; }
.rowbtns { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.tag { display: inline-block; background: var(--secondary-background-color); border: 1px solid var(--divider-color); color: var(--primary-text-color); border-radius: 10px; padding: 1px 7px; font-size: 11.5px; margin: 1px; }
tr.ignored td { opacity: 0.55; }
.chk { color: var(--primary-text-color); font-size: 13px; display: flex; gap: 6px; align-items: center; }
.chk.big { font-size: 14px; margin: 10px 0; }
.optgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px 12px; margin: 6px 0 10px; }
summary { cursor: pointer; font-weight: 600; color: var(--primary-color); }
textarea { width: 100%; font-family: var(--code-font-family, monospace); font-size: 12.5px; }
.toast { position: fixed; left: 50%; transform: translateX(-50%) translateY(20px); bottom: 24px; background: var(--primary-color); color: var(--text-primary-color, #fff); padding: 10px 18px; border-radius: 10px; opacity: 0; pointer-events: auto; cursor: pointer; transition: all 0.25s; z-index: 999; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); max-width: 80vw; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.toast.err { background: var(--error-color, #db4437); }
.foot { text-align: center; color: var(--secondary-text-color); font-size: 12px; margin-top: 8px; }
@media (max-width: 720px) {
  :host { padding: 8px 8px 48px; }
  .card { padding: 10px 12px; }
  table.map, table.map tbody, table.map tr, table.map td { display: block; width: 100%; }
  table.map thead { display: none; }
  table.map tr[data-btn-name] { border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
  .cell { min-width: 0; }
  .act input { flex-basis: 100%; }
  .toolbar input[type="search"] { min-width: 0; }
}
`;

class ButtonRouterPanel extends HTMLElement {
  constructor() {
    super();
    // UWAGA: ŻADNYCH operacji DOM w konstruktorze! HA frontend używa
    // polyfill scoped-custom-element-registry, który tworzy wtedy martwy
    // HTMLUnknownElement (Firefox: NotSupportedError, panel zostaje pusty).
    // Cały DOM inicjalizujemy w connectedCallback.
    this._hass = null;
    this._ready = false;
    this._initStarted = false;
    this._domReady = false;
    this._dirty = false;
    this._buttons = {};
    this._discovered = {};
    this._stats = {};
    this._recent = [];
    this._options = {
      event_types: [...DEFAULT_EVENT_TYPES],
      data_key: "input",
      create_event_entities: false,
    };
    this._services = [];
    this._entities = [];
    this._lastEntitiesAt = 0;
    this._showIgnored = false;
    this._tt = null;
    this._cfgTimer = null;
    this._pollTimer = null;
    this._pollInFlight = false;
    this._lastDiscJson = "";
    this._lastRecentJson = "";
    this._lastStatsJson = "";
    this._unsubPush = null;
    this._unsubConfig = null;
    this._undoFn = null;
    this._boundClick = (e) => this._onClick(e);
    this._boundChange = (e) => this._onChange(e);
    this._boundInput = (e) => this._onInput(e);
    this._boundKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")) {
        if (this._dirty) {
          e.preventDefault();
          this._save();
        }
      }
    };
    this._boundUnload = (e) => {
      if (this._dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
  }

  connectedCallback() {
    // Pierwszy kontakt z DOM dopiero tutaj (element jest już w dokumencie).
    if (!this._domReady) {
      this._domReady = true;
      this.innerHTML = `<style>${CSS}</style><div class="loading">Ładowanie panelu…</div>`;
      this.addEventListener("click", this._boundClick);
      this.addEventListener("change", this._boundChange);
      this.addEventListener("input", this._boundInput);
    }
    document.addEventListener("keydown", this._boundKey);
    window.addEventListener("beforeunload", this._boundUnload);
    if (this._hass && !this._initStarted) {
      this._initStarted = true;
      this._init();
    } else if (this._ready) {
      // powrót do panelu po odczłączeniu przez partial-panel-resolver
      this._startPolling();
      this._subscribePush();
    }
  }

  disconnectedCallback() {
    this._stopPolling();
    this._unsubscribePush();
    document.removeEventListener("keydown", this._boundKey);
    window.removeEventListener("beforeunload", this._boundUnload);
  }

  set hass(hass) {
    this._hass = hass;
    if (this._ready) {
      this._refreshEntities(false);
      return;
    }
    if (this._domReady && !this._initStarted) {
      this._initStarted = true;
      this._init();
    }
  }

  get hass() {
    return this._hass;
  }

  async _init() {
    try {
      const cfg = await this._ws("button_router/get_config");
      this._applyConfig(cfg);
      this._services = await this._loadServices();
      this._refreshEntities(true);
      this._ready = true;
      this._render();
      this._startPolling();
      this._subscribePush();
    } catch (err) {
      this.innerHTML = `<style>${CSS}</style>
        <div class="wrap">
          <div class="card">
            <h2>Nie udało się załadować panelu</h2>
            <p>${esc(err && err.message ? err.message : err)}</p>
            <p class="hint">Sprawdź, czy integracja „Button Router” jest skonfigurowana (Ustawienia → Urządzenia i integracje).</p>
            <button class="btn" data-act="retry">Spróbuj ponownie</button>
          </div>
        </div>`;
    }
  }

  _applyConfig(cfg) {
    cfg = cfg || {};
    this._buttons = cfg.buttons || {};
    this._discovered = cfg.discovered || {};
    this._stats = cfg.stats || {};
    this._recent = Array.isArray(cfg.recent) ? cfg.recent : [];
    const o = cfg.options || {};
    this._options = {
      event_types:
        Array.isArray(o.event_types) && o.event_types.length
          ? o.event_types
          : [...DEFAULT_EVENT_TYPES],
      data_key: o.data_key || "input",
      create_event_entities: !!o.create_event_entities,
    };
    this._lastDiscJson = JSON.stringify(this._discovered || {});
    this._lastRecentJson = JSON.stringify(this._recent || []);
    this._lastStatsJson = JSON.stringify(this._stats || {});
  }

  /* ---- Live push z integracji (zdarzenia na magistrali HA) ---- */

  async _subscribePush() {
    if (!this._hass || !this._hass.connection) return;
    try {
      if (!this._unsubPush) {
        this._unsubPush = await this._hass.connection.subscribeEvents(
          (ev) => this._onPush((ev && ev.data) || ev),
          "button_router_event"
        );
      }
      if (!this._unsubConfig) {
        this._unsubConfig = await this._hass.connection.subscribeEvents(
          () => this._onConfigPush(),
          "button_router_config_updated"
        );
      }
    } catch (err) {
      /* brak push — polling zostaje jako rezerwa */
    }
  }

  _unsubscribePush() {
    try {
      if (this._unsubPush) this._unsubPush.then((u) => u()).catch(() => {});
    } catch (err) { /* noop */ }
    try {
      if (this._unsubConfig) this._unsubConfig.then((u) => u()).catch(() => {});
    } catch (err) { /* noop */ }
    this._unsubPush = null;
    this._unsubConfig = null;
    clearTimeout(this._cfgTimer);
  }

  _onPush(d) {
    if (!d || typeof d.name !== "string" || !this._ready) return;
    const nowIso = new Date().toISOString();
    if (d.discovered) {
      // Nieznany przycisk — od razu na listę „Nowo wykryte”.
      const disc = this._discovered || (this._discovered = {});
      const e = disc[d.name] || (disc[d.name] = { first_seen: nowIso, last_seen: "", count: 0, events: {}, ignored: false });
      e.last_seen = nowIso;
      e.count = (e.count || 0) + 1;
      e.events = e.events || {};
      e.events[d.event_type] = (e.events[d.event_type] || 0) + 1;
      this._lastDiscJson = JSON.stringify(disc);
      this._toast("Wykryto nowy przycisk: " + d.name);
      this._updateDiscCard();
      return;
    }
    // Zmapowany przycisk — puls w tabeli + odświeżenie statystyk i historii.
    const st = this._stats[d.name] || (this._stats[d.name] = { count: 0, by_type: {}, last_fired: "", last_type: "" });
    st.count = (st.count || 0) + 1;
    st.by_type = st.by_type || {};
    st.by_type[d.event_type] = (st.by_type[d.event_type] || 0) + 1;
    st.last_fired = nowIso;
    st.last_type = d.event_type;
    this._lastStatsJson = JSON.stringify(this._stats);
    const rec = {
      time: nowIso,
      button: d.name,
      event_type: d.event_type,
      executed: d.executed || 0,
      enabled: d.enabled !== false,
    };
    this._recent = this._recent || [];
    this._recent.unshift(rec);
    this._recent = this._recent.slice(0, RECENT_LIMIT);
    this._lastRecentJson = JSON.stringify(this._recent);
    this._updateLogCard();
    this._updateStatLine(d.name);
    this._flashRow(d.name);
    if (d.enabled === false) {
      this._toast("Przycisk „" + d.name + "” jest wyłączony — akcje nie zostały wykonane.");
    }
  }

  _onConfigPush() {
    // Konfiguracja zmieniła się (inny panel/okno albo reload opcji) — cicho dociągnij.
    if (this._dirty || !this._ready || document.hidden) return;
    clearTimeout(this._cfgTimer);
    this._cfgTimer = setTimeout(() => {
      if (this.isConnected && !this._dirty) this._reload(true);
    }, 800);
  }

  /* ---- Polling (rezerwa dla push) ---- */

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._pollConfig(), 5000);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _pollConfig() {
    // Live refresh co 5 s jako rezerwa dla push. Nie odświeżamy gdy użytkownik
    // ma niezapisane zmiany albo karta jest schowana.
    if (this._dirty || this._pollInFlight || document.hidden || !this._ready) return;
    this._pollInFlight = true;
    try {
      const cfg = await this._ws("button_router/get_config");
      const o = cfg.options || {};
      const optsChanged =
        JSON.stringify(o.event_types) !== JSON.stringify(this._options.event_types) ||
        (o.data_key || "input") !== this._options.data_key ||
        !!o.create_event_entities !== !!this._options.create_event_entities;
      if (optsChanged) {
        this._applyConfig(cfg);
        this._render();
        return;
      }
      const newDisc = cfg.discovered || {};
      const discJson = JSON.stringify(newDisc);
      if (discJson !== this._lastDiscJson) {
        const prev = this._discovered || {};
        const added = Object.keys(newDisc).filter((n) => !prev[n]);
        this._discovered = newDisc;
        this._lastDiscJson = discJson;
        if (added.length) this._toast("Wykryto nowy przycisk: " + added.join(", "));
        this._updateDiscCard();
      }
      const newRecent = Array.isArray(cfg.recent) ? cfg.recent : [];
      const recJson = JSON.stringify(newRecent);
      if (recJson !== this._lastRecentJson) {
        this._recent = newRecent;
        this._lastRecentJson = recJson;
        this._updateLogCard();
      }
      const newStats = cfg.stats || {};
      const stJson = JSON.stringify(newStats);
      if (stJson !== this._lastStatsJson) {
        this._stats = newStats;
        this._lastStatsJson = stJson;
        this._refreshStatLines();
      }
    } catch (err) {
      /* cicho — zostają ostatnie dane; retry w następnym cyklu */
    } finally {
      this._pollInFlight = false;
    }
  }
  _updateDiscCard() {
    const card = this.querySelector("#disc-card");
    if (card) card.outerHTML = this._discCardHtml();
  }

  _updateLogCard() {
    const card = this.querySelector("#log-card");
    if (card) card.outerHTML = this._logCardHtml();
  }

  _statLineHtml(name) {
    const st = this._stats[name];
    if (!st || !st.count) return '<span class="muted">— brak użyć</span>';
    const t = stripEsp(st.last_type);
    return `×${esc(st.count)} · ost. ${esc(fmtWhen(st.last_fired))}${t ? " (" + esc(t) + ")" : ""}`;
  }

  _logCardHtml() {
    const all = this._recent || [];
    const rows = all.slice(0, 30);
    return `<div class="card" id="log-card">
          <div class="cardhead"><h2>Ostatnie zdarzenia <span class="badge">${all.length}</span></h2>
            <button class="btn sm" data-act="clear-stats" title="Resetuj liczniki i historię">Wyczyść statystyki</button></div>
          ${
            rows.length
              ? `<table><thead><tr><th>Czas</th><th>Przycisk</th><th>Typ</th><th>Wynik</th></tr></thead>
                  <tbody>${rows.map((r) => this._logRow(r)).join("")}</tbody>
                </table>`
              : '<p class="empty">Brak zdarzeń — naciśnij fizyczny przycisk albo wyślij test.</p>'
          }
          <p class="hint">Wynik = liczba wykonanych akcji. „brak akcji” = przycisk bez mapowania na ten typ kliknięcia; „wyłączony” = checkbox przy przycisku jest odznaczony.</p>
        </div>`;
  }

  _logRow(r) {
    const res =
      r.enabled === false
        ? '<span class="muted">wyłączony</span>'
        : r.executed
          ? esc(r.executed) + " akcji"
          : '<span class="muted">brak akcji</span>';
    return `<tr>
          <td class="nowrap">${esc(fmtWhen(r.time))}</td>
          <td class="bname">${esc(r.button)}</td>
          <td><span class="tag">${esc(stripEsp(r.event_type))}</span></td>
          <td>${res}</td>
        </tr>`;
  }

  _discCardHtml() {
    const disc = Object.entries(this._discovered || {});
    const visibleDisc = disc.filter(([, e]) => this._showIgnored || !e.ignored);
    const ignoredCount = disc.filter(([, e]) => e.ignored).length;
    return `<div class="card" id="disc-card">
          <h2>Nowo wykryte przyciski <span class="badge">${visibleDisc.length}</span></h2>
          <p class="hint">Naciśnij fizyczny przycisk bez konfiguracji — pojawi się tutaj natychmiast (live push; odświeżanie rezerwowe co 5 s). „+ Dodaj” przenosi go do mapowania poniżej.</p>
          ${
            visibleDisc.length
              ? `<table>
                  <thead><tr><th>Przycisk</th><th>Zdarzenia</th><th>Ostatnio</th><th>Akcje</th></tr></thead>
                  <tbody>${visibleDisc.map(([name, e]) => this._discRow(name, e)).join("")}</tbody>
                </table>`
              : '<p class="empty">Na razie pusto — brak nieznanych przycisków.</p>'
          }
          <div class="row">
            <button class="btn sm" data-act="clear-discovered">Wyczyść listę</button>
            <label class="chk"><input type="checkbox" id="show-ignored" ${this._showIgnored ? "checked" : ""} /> pokaż ignorowane (${ignoredCount})</label>
          </div>
          <p class="hint">💡 Diagnostyka: jeśli naciśnięcie fizycznego przycisku nic nie dodaje — sprawdź w <b>Narzędzia deweloperskie → Zdarzenia</b>, czy zdarzenie w ogóle przychodzi (posłuchaj typu <code>esphome.short</code>) i pod jakim kluczem przesyłana jest nazwa przycisku (klucz zmienisz w ⚙ Opcjach niżej). Możesz też użyć „🧪 Test zdarzenia” poniżej.</p>
        </div>`;
  }

  async _reload(silent) {
    if (this._dirty && !confirm("Masz niezapisane zmiany — odświeżyć i je porzucić?")) return;
    try {
      this._applyConfig(await this._ws("button_router/get_config"));
      this._dirty = false;
      this._render();
      if (!silent) this._toast("Odświeżono.");
    } catch (err) {
      if (!silent) this._toast("Błąd odświeżania: " + (err.message || err), true);
    }
  }

  _ws(type, extra) {
    return this._hass.callWS(Object.assign({ type: type }, extra || {}));
  }

  async _loadServices() {
    try {
      const data = await this._hass.callWS({ type: "config/services/get" });
      const list = [];
      (Array.isArray(data) ? data : []).forEach((domainEntry) => {
        Object.keys(domainEntry.services || {}).forEach((svc) =>
          list.push(domainEntry.domain + "." + svc)
        );
      });
      list.sort();
      return list;
    } catch (err) {
      return [];
    }
  }

  _refreshEntities(force) {
    const now = Date.now();
    if (!force && now - this._lastEntitiesAt < 15000) return;
    this._lastEntitiesAt = now;
    this._entities = Object.keys((this._hass && this._hass.states) || {}).sort();
    const dl = this.querySelector("#dl-entities");
    if (dl) dl.innerHTML = this._entities.map((e) => `<option value="${esc(e)}">`).join("");
  }

  _columns() {
    const set = new Set(this._options.event_types);
    Object.values(this._buttons).forEach((cfg) => {
      Object.keys((cfg && cfg.actions) || {}).forEach((et) => set.add(et));
    });
    return Array.from(set);
  }

  _render() {
    if (!this._ready) return;
    this._refreshEntities(false);
    const cols = this._columns();
    const dataKey = esc(this._options.data_key);
    const entOn = this._options.create_event_entities;

    this.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <div class="head">
          <h1>Przyciski — Button Router</h1>
          <div class="sub">Nasłuchiwane zdarzenia: <code>${this._options.event_types.map(esc).join("</code>, <code>")}</code> · klucz danych: <code>${dataKey}</code> · encje zdarzeń: ${entOn ? "<b>tak</b>" : "nie"}</div>
          <div class="toolbar">
            <input id="search" type="search" placeholder="Szukaj przycisku…" />
            <button class="btn" data-act="reload" title="Odśwież dane z integracji">↻ Odśwież</button>
            <button class="btn" data-act="export" title="Pobierz kopię mapowania (JSON)">⬇ Eksport</button>
            <button class="btn" data-act="import-file" title="Wczytaj mapowanie z pliku JSON/YAML">⬆ Import z pliku</button>
            <button class="btn primary" id="btn-save" data-act="save" ${this._dirty ? "" : "disabled"}>💾 Zapisz zmiany (Ctrl+S)</button>
          </div>
        </div>

        ${this._discCardHtml()}

        ${this._logCardHtml()}

        <div class="card">
          <h2>Mapowanie: przycisk + typ kliknięcia → akcje</h2>
          <p class="hint">W komórce podaj usługę (np. <code>light.toggle</code>) i encję (np. <code>light.salon</code>); opcjonalnie parametry JSON, np. <code>{"brightness_pct": 50}</code> — wartości mogą być szablonami Jinja, np. <code>{{ states('sensor.temp') }}</code>. ▶ wykonuje akcję od razu (także przed zapisem). Encja <code>all</code> działa jak w Twojej starej automatyzacji. Pusta komórka = brak reakcji.</p>
          <div class="row addrow">
            <input id="manual-name" placeholder="nazwa nowego przycisku (dokładnie jak w zdarzeniu)" />
            <button class="btn sm" data-act="add-manual">+ Dodaj ręcznie</button>
          </div>
          <table class="map">
            <thead><tr><th>Przycisk</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}<th></th></tr></thead>
            <tbody>${Object.keys(this._buttons).sort().map((name) => this._btnRow(name, cols)).join("")}</tbody>
          </table>
        </div>

        <div class="card">
          <details>
            <summary>⚙ Opcje (typy zdarzeń, klucz danych, encje zdarzeń)</summary>
            <p class="hint">Zapis opcji od razu przeładowuje integrację (kilka sekund). Te same ustawienia znajdziesz w: Ustawienia → Urządzenia i integracje → Button Router → Konfiguruj.</p>
            <div class="optgrid">${EVENT_CHOICES.map(
              (c) =>
                `<label class="chk"><input type="checkbox" class="opt-evt" value="${esc(c)}" ${this._options.event_types.includes(c) ? "checked" : ""} /> <code>${esc(c)}</code></label>`
            ).join("")}</div>
            <div class="row">
              <input id="opt-extra" placeholder="dodatkowe typy (po przecinku, np. esphome.quad)" />
              <input id="opt-datakey" placeholder="klucz danych (np. input)" value="${dataKey}" />
            </div>
            <label class="chk big"><input type="checkbox" id="opt-entities" ${entOn ? "checked" : ""} /> Twórz encje zdarzeń (<code>event.*</code>) dla zmapowanych przycisków</label>
            <p class="hint">Encje zdarzeń (domyślnie <b>wyłączone</b>) udostępniają każdy przycisk jako natywną encję HA: automatyzacje bez panelu (wyzwalacz: stan encji <code>event.btn_x</code>, atrybut <code>event_type</code> = <code>short</code>/<code>double</code>/<code>long</code>) oraz historię naciśnięć w logbooku.</p>
            <button class="btn primary" data-act="apply-options">Zastosuj opcje</button>
          </details>
        </div>

        <div class="card">
          <details>
            <summary>📦 Import z istniejącej automatyzacji (YAML)</summary>
            <p class="hint">Wklej zawartość zmiennej <code>a</code> ze swojej automatyzacji (od <code>{</code> do <code>}</code>), albo cały blok <code>variables:</code>, albo nawet cały YAML automatyzacji — parser sam odnajdzie mapowanie. Import wypełnia edytor (potem kliknij „Zapisz zmiany”). Puste wpisy typu <code>["", ""]</code> zostaną pominięte.</p>
            <textarea id="import-yaml" rows="10" spellcheck="false" placeholder='{
  "btn_franek_1": {
    "esphome.short": [["light.toggle", "light.a32_1_sufit_franek"]],
    "esphome.double": [["light.toggle", "light.a32_1_led_schody"]]
  }
}'></textarea>
            <div class="row"><button class="btn primary" data-act="import">Importuj do edytora</button></div>
          </details>
        </div>

        <div class="card">
          <details>
            <summary>🧪 Test zdarzenia</summary>
            <div class="row">
              <input id="test-name" placeholder="nazwa przycisku" />
              <select id="test-type">${cols.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
              <button class="btn" data-act="test">Wyślij test</button>
            </div>
            <p class="hint">Wysyła zdarzenie na magistralę HA — działa jak fizyczne naciśnięcie: znane przyciski wykonają akcje, a nieznane trafią do sekcji „Nowo wykryte”.</p>
          </details>
        </div>

        <div class="foot">Panel integracji Button Router v0.2.0 · typy zdarzeń zmienisz wyżej, w ⚙ Opcjach</div>
      </div>

      <input type="file" id="file-import" accept=".json,.yaml,.yml,.txt" style="display:none" />
      <datalist id="dl-services">${this._services.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-entities">${this._entities.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;

    this._validateInputs();
  }

  _discRow(name, e) {
    const tags = Object.entries(e.events || {})
      .map(
        ([et, c]) =>
          `<span class="tag">${esc(stripEsp(et))} ×${esc(c)}</span>`
      )
      .join(" ");
    const ign = !!e.ignored;
    return `
      <tr class="${ign ? "ignored" : ""}" data-disc-name="${esc(name)}">
        <td class="bname">${esc(name)}</td>
        <td>${tags || '<span class="tag">—</span>'}</td>
        <td class="muted">${fmtDate(e.last_seen)}</td>
        <td class="nowrap">
          <button class="btn sm primary" data-act="add-discovered" data-btn="${esc(name)}">+ Dodaj</button>
          <button class="btn sm" data-act="${ign ? "unignore-discovered" : "ignore-discovered"}" data-btn="${esc(name)}">${ign ? "Przywróć" : "Ignoruj"}</button>
          <button class="btn sm danger" data-act="del-discovered" data-btn="${esc(name)}">Usuń</button>
        </td>
      </tr>`;
  }

  _btnRow(name, cols) {
    const cfg = this._buttons[name] || { enabled: true, actions: {} };
    return `
      <tr data-btn-name="${esc(name)}">
        <td class="btn-name">
          <div class="brow">
            <input type="checkbox" title="Włączony" data-btn="${esc(name)}" data-field="enabled" ${cfg.enabled ? "checked" : ""} />
            <span class="bname">${esc(name)}</span>
          </div>
          <div class="muted statline" data-statline>${this._statLineHtml(name)}</div>
          <div class="rowbtns">
            <button class="btn sm" data-act="dup-btn" data-btn="${esc(name)}" title="Utwórz kopię tej konfiguracji">⧉ Duplikuj</button>
            <button class="btn sm danger" data-act="del-btn" data-btn="${esc(name)}">Usuń przycisk</button>
          </div>
        </td>
        ${cols.map((et) => this._cell(name, et)).join("")}
        <td></td>
      </tr>`;
  }

  _cell(name, et) {
    const actions = ((this._buttons[name] || {}).actions || {})[et] || [];
    const rows = actions
      .map(
        (a, i) => `
        <div class="act">
          <input list="dl-services" placeholder="domena.usługa" data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" data-field="service" value="${esc(a.service)}" />
          <input list="dl-entities" placeholder="encja (opcjonalnie)" data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" data-field="entity" value="${esc(a.entity_id)}" />
          <input class="datain" placeholder='data JSON, np. {"brightness_pct":50}' data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" data-field="data" value="${a.data ? esc(JSON.stringify(a.data)) : ""}" />
          <span class="actbtns">
            <button class="btn sm" data-act="run-action" data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" title="Wykonaj tę akcję teraz">▶</button>
            <button class="btn sm" data-act="del-action" data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" title="Usuń tę akcję">×</button>
          </span>
        </div>`
      )
      .join("");
    return `<td class="cell">${rows}<button class="btn sm add" data-act="add-action" data-btn="${esc(name)}" data-evt="${esc(et)}">+ akcja</button></td>`;
  }
  _onClick(e) {
    // Toast jako „cofnij” (undo).
    if (e.target.closest(".toast") && this._undoFn) {
      const fn = this._undoFn;
      this._undoFn = null;
      fn();
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const d = el.dataset;
    switch (act) {
      case "retry":
        this._initStarted = true;
        this._init();
        break;
      case "save":
        this._save();
        break;
      case "reload":
        this._reload();
        break;
      case "export":
        this._doExport();
        break;
      case "import-file": {
        const f = this.querySelector("#file-import");
        if (f) f.click();
        break;
      }
      case "run-action": {
        const arr = ((this._buttons[d.btn] || {}).actions || {})[d.evt];
        const a = arr && arr[Number(d.idx)];
        if (!a || !a.service || a.service.indexOf(".") < 0) {
          this._toast("Podaj najpierw usługę w postaci domena.usługa.", true);
          break;
        }
        this._ws("button_router/run_action", {
          service: a.service,
          entity_id: a.entity_id || "",
          data: a.data || {},
        })
          .then(() =>
            this._toast("Wykonano: " + a.service + (a.entity_id ? " → " + a.entity_id : ""))
          )
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      }
      case "add-action": {
        const arr = this._ensureActions(d.btn, d.evt);
        arr.push({ service: "", entity_id: "" });
        this._dirty = true;
        this._render();
        break;
      }
      case "del-action": {
        const arr = ((this._buttons[d.btn] || {}).actions || {})[d.evt];
        if (arr) {
          const snap = this._snapshot();
          arr.splice(Number(d.idx), 1);
          this._dirty = true;
          this._render();
          this._showUndo("Usunięto akcję.", snap);
        }
        break;
      }
      case "del-btn": {
        const snap = this._snapshot();
        delete this._buttons[d.btn];
        this._dirty = true;
        this._render();
        this._showUndo("Usunięto przycisk „" + d.btn + "”.", snap);
        break;
      }
      case "dup-btn": {
        const nn = prompt("Nazwa duplikatu przycisku „" + d.btn + "”:", d.btn + "_kopia");
        if (nn === null) break;
        const name = nn.trim();
        if (!name) {
          this._toast("Podaj nazwę duplikatu.", true);
          break;
        }
        if (this._buttons[name]) {
          this._toast("Taki przycisk już istnieje w mapowaniu.", true);
          break;
        }
        this._buttons[name] = JSON.parse(
          JSON.stringify(this._buttons[d.btn] || { enabled: true, actions: {} })
        );
        this._dirty = true;
        this._render();
        this._flashRow(name);
        break;
      }
      case "add-discovered": {
        const known = d.btn;
        if (!this._buttons[known]) this._buttons[known] = { enabled: true, actions: {} };
        delete this._discovered[known];
        this._dirty = true;
        this._render();
        this._flashRow(known);
        this._ws("button_router/clear_discovered", { name: known })
          .then((res) => {
            if (res && res.discovered) {
              this._discovered = res.discovered;
              this._lastDiscJson = JSON.stringify(this._discovered || {});
            }
          })
          .catch(() => {});
        break;
      }
      case "ignore-discovered":
      case "unignore-discovered": {
        const ignored = act === "ignore-discovered";
        this._ws("button_router/clear_discovered", { name: d.btn, ignored: ignored })
          .then((res) => {
            if (res && res.discovered) {
              this._discovered = res.discovered;
              this._lastDiscJson = JSON.stringify(this._discovered || {});
            }
            this._updateDiscCard();
          })
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      }
      case "del-discovered":
        this._ws("button_router/clear_discovered", { name: d.btn })
          .then((res) => {
            if (res && res.discovered) {
              this._discovered = res.discovered;
              this._lastDiscJson = JSON.stringify(this._discovered || {});
            }
            this._updateDiscCard();
          })
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      case "clear-discovered":
        if (confirm("Wyczyścić całą listę wykrytych przycisków?")) {
          this._ws("button_router/clear_discovered", {})
            .then((res) => {
              if (res && res.discovered) {
                this._discovered = res.discovered;
                this._lastDiscJson = JSON.stringify(this._discovered || {});
              }
              this._updateDiscCard();
            })
            .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        }
        break;
      case "add-manual": {
        const inp = this.querySelector("#manual-name");
        const n = ((inp && inp.value) || "").trim();
        if (!n) {
          this._toast("Podaj nazwę przycisku.", true);
          break;
        }
        if (this._buttons[n]) {
          this._toast("Taki przycisk już istnieje w mapowaniu.", true);
          break;
        }
        this._buttons[n] = { enabled: true, actions: {} };
        this._dirty = true;
        this._render();
        this._flashRow(n);
        break;
      }
      case "import":
        this._doImport();
        break;
      case "test":
        this._doTest();
        break;
      case "clear-stats":
        this._ws("button_router/clear_stats")
          .then(() => {
            this._stats = {};
            this._recent = [];
            this._lastStatsJson = "{}";
            this._lastRecentJson = "[]";
            this._refreshStatLines();
            this._updateLogCard();
            this._toast("Statystyki i historia wyczyszczone.");
          })
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      case "apply-options":
        this._applyOptions();
        break;
    }
  }

  _onChange(e) {
    const t = e.target;
    if (t.id === "show-ignored") {
      this._showIgnored = t.checked;
      this._updateDiscCard();
      return;
    }
    if (t.id === "file-import") {
      const f = t.files && t.files[0];
      if (f) {
        f.text()
          .then((txt) => this._importText(txt))
          .catch((err) => this._toast("Nie udało się odczytać pliku: " + (err.message || err), true));
      }
      t.value = "";
      return;
    }
    if (t.dataset && t.dataset.btn && t.dataset.field === "enabled") {
      const cfg = this._buttons[t.dataset.btn];
      if (cfg) {
        cfg.enabled = t.checked;
        this._dirty = true;
        this._updateSaveBtn();
      }
    }
  }

  _onInput(e) {
    const t = e.target;
    if (t.id === "search") {
      this._applyFilter(t.value);
      return;
    }
    if (t.dataset && t.dataset.btn && t.dataset.evt && t.dataset.field) {
      const idx = Number(t.dataset.idx);
      const arr = ((this._buttons[t.dataset.btn] || {}).actions || {})[t.dataset.evt];
      if (!arr || !arr[idx]) return;
      const v = t.value.trim();
      if (t.dataset.field === "service") {
        arr[idx].service = v;
        t.classList.toggle("invalid", !!v && !this._services.includes(v));
        this._dirty = true;
        this._updateSaveBtn();
      } else if (t.dataset.field === "entity") {
        arr[idx].entity_id = v;
        const ok = !v || v === "all" || (this._hass && this._hass.states && this._hass.states[v] !== undefined);
        t.classList.toggle("invalid", !ok);
        this._dirty = true;
        this._updateSaveBtn();
      } else if (t.dataset.field === "data") {
        if (!v) {
          delete arr[idx].data;
          t.classList.remove("invalid");
          this._dirty = true;
          this._updateSaveBtn();
          return;
        }
        try {
          const o = JSON.parse(v);
          if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("nie jest obiektem");
          arr[idx].data = o;
          t.classList.remove("invalid");
          this._dirty = true;
          this._updateSaveBtn();
        } catch (err) {
          // Niepoprawny JSON — czerwona ramka; blokada nastąpi przy zapisie.
          t.classList.add("invalid");
        }
      }
    }
  }

  _validateInputs() {
    const svc = new Set(this._services);
    this.querySelectorAll('input[data-field="service"]').forEach((i) => {
      const v = i.value.trim();
      i.classList.toggle("invalid", !!v && !svc.has(v));
    });
    this.querySelectorAll('input[data-field="entity"]').forEach((i) => {
      const v = i.value.trim();
      const ok =
        !v || v === "all" || (this._hass && this._hass.states && this._hass.states[v] !== undefined);
      i.classList.toggle("invalid", !ok);
    });
  }

  _ensureActions(btn, evt) {
    const cfg = this._buttons[btn] || (this._buttons[btn] = { enabled: true, actions: {} });
    cfg.actions = cfg.actions || {};
    return cfg.actions[evt] || (cfg.actions[evt] = []);
  }

  _updateSaveBtn() {
    const b = this.querySelector("#btn-save");
    if (b) b.disabled = !this._dirty;
  }

  _applyFilter(q) {
    const needle = (q || "").trim().toLowerCase();
    this.querySelectorAll("tr[data-btn-name]").forEach((tr) => {
      const match = !needle || String(tr.dataset.btnName).toLowerCase().includes(needle);
      tr.style.display = match ? "" : "none";
    });
  }

  _flashRow(name) {
    const tr = Array.from(this.querySelectorAll("tr[data-btn-name]")).find(
      (r) => r.dataset.btnName === name
    );
    if (!tr) return;
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
    tr.classList.remove("flash");
    // wymuś restart animacji
    void tr.offsetWidth;
    tr.classList.add("flash");
    setTimeout(() => tr.classList.remove("flash"), 1600);
  }

  _updateStatLine(name) {
    const tr = Array.from(this.querySelectorAll("tr[data-btn-name]")).find(
      (r) => r.dataset.btnName === name
    );
    if (!tr) return;
    const el = tr.querySelector("[data-statline]");
    if (el) el.innerHTML = this._statLineHtml(name);
  }

  _refreshStatLines() {
    this.querySelectorAll("tr[data-btn-name]").forEach((tr) => {
      const el = tr.querySelector("[data-statline]");
      if (el) el.innerHTML = this._statLineHtml(tr.dataset.btnName);
    });
  }

  _snapshot() {
    return JSON.stringify({ buttons: this._buttons, discovered: this._discovered });
  }

  _showUndo(msg, snap) {
    this._undoFn = () => {
      try {
        const st = JSON.parse(snap);
        this._buttons = st.buttons || {};
        this._discovered = st.discovered || {};
        this._dirty = true;
        this._render();
        this._toast("Przywrócono ✓");
      } catch (err) {
        this._toast("Nie udało się cofnąć zmiany.", true);
      }
      this._undoFn = null;
    };
    this._toast(msg + " Kliknij tutaj, aby cofnąć.", false, true);
  }

  async _save() {
    const badJson = this.querySelector('input[data-field="data"].invalid');
    if (badJson) {
      this._toast("Popraw zaznaczone na czerwono pola JSON przed zapisem.", true);
      return;
    }
    try {
      const res = await this._ws("button_router/save_config", { buttons: this._buttons });
      this._dirty = false;
      if (res && res.discovered) {
        this._discovered = res.discovered;
        this._lastDiscJson = JSON.stringify(this._discovered || {});
      }
      this._render();
      this._toast("Zapisano ✓ (" + (res && res.saved ? res.saved : 0) + " przycisków)");
    } catch (err) {
      this._toast("Błąd zapisu: " + (err.message || err), true);
    }
  }

  async _importText(text) {
    if (!text || !text.trim()) {
      this._toast("Brak treści do importu.", true);
      return;
    }
    try {
      const res = await this._ws("button_router/import_yaml", { yaml: text });
      const imported = res.buttons || {};
      const names = Object.keys(imported);
      if (!names.length) {
        this._toast("Nie znaleziono mapowania w podanym tekście.", true);
        return;
      }
      names.forEach((n) => {
        this._buttons[n] = imported[n];
        delete this._discovered[n];
      });
      this._dirty = true;
      this._render();
      this._toast("Zaimportowano " + names.length + " przycisk(ów) — kliknij „Zapisz zmiany”.");
    } catch (err) {
      this._toast("Import nie powiódł się: " + (err.message || err), true);
    }
  }

  async _doImport() {
    const ta = this.querySelector("#import-yaml");
    if (!ta || !ta.value.trim()) {
      this._toast("Wklej najpierw tekst do importu.", true);
      return;
    }
    await this._importText(ta.value);
  }

  _doExport() {
    const payload = {
      source: "button_router",
      exported_at: new Date().toISOString(),
      buttons: this._buttons,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "button-router-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this._toast("Wyeksportowano " + Object.keys(this._buttons).length + " przycisków.");
  }

  async _doTest() {
    const nEl = this.querySelector("#test-name");
    const tEl = this.querySelector("#test-type");
    const n = ((nEl && nEl.value) || "").trim();
    const et = (tEl && tEl.value) || this._options.event_types[0];
    if (!n) {
      this._toast("Podaj nazwę przycisku do testu.", true);
      return;
    }
    try {
      const res = await this._ws("button_router/test_event", { name: n, event_type: et });
      const cnt = res && res.actions ? res.actions.length : 0;
      this._toast(
        cnt
          ? "Test wysłany — wykonane akcje: " + cnt
          : "Test wysłany (brak zmapowanych akcji)."
      );
    } catch (err) {
      this._toast("Błąd testu: " + (err.message || err), true);
    }
  }

  async _applyOptions() {
    const types = Array.from(this.querySelectorAll(".opt-evt"))
      .filter((c) => c.checked)
      .map((c) => c.value);
    const extraEl = this.querySelector("#opt-extra");
    const extra = ((extraEl && extraEl.value) || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    extra.forEach((x) => {
      if (!types.includes(x)) types.push(x);
    });
    if (!types.length) {
      this._toast("Wybierz co najmniej jeden typ zdarzenia.", true);
      return;
    }
    const dkEl = this.querySelector("#opt-datakey");
    const dk = ((dkEl && dkEl.value) || "").trim() || "input";
    const entEl = this.querySelector("#opt-entities");
    const entities = !!(entEl && entEl.checked);
    try {
      await this._ws("button_router/set_options", {
        event_types: types,
        data_key: dk,
        create_event_entities: entities,
      });
      this._toast("Opcje zapisane — integracja się przeładowuje (kilka sekund)…");
      if (!this._dirty) {
        setTimeout(() => {
          if (this.isConnected && this._ready && !this._dirty) this._reload(true);
        }, 2500);
      }
    } catch (err) {
      this._toast("Błąd zapisu opcji: " + (err.message || err), true);
    }
  }

  _toast(msg, isErr, keepUndo) {
    if (!keepUndo) this._undoFn = null;
    let t = this.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      this.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove("show"), 4200);
  }
}

// Rejestracja elementu (guard chroni przed podwójnym define w scoped registry).
if (!customElements.get("button-router-panel")) {
  customElements.define("button-router-panel", ButtonRouterPanel);
}

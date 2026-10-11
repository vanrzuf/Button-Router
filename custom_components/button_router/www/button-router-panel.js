/**
 * Button Router — panel dla Home Assistant (vanilla JS, bez kroku budowania).
 *
 * Rejestruje custom element <button-router-panel> używany przez panel_custom.
 * Komunikuje się z integracją przez WebSocket API:
 *   button_router/get_config, save_config, clear_discovered, import_yaml, test_event
 */
const DEFAULT_EVENT_TYPES = ["esphome.short", "esphome.double", "esphome.long"];

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
.btn.danger { color: var(--error-color, #db4437); border-color: currentColor; background: transparent; }
.btn.sm { padding: 3px 8px; font-size: 12.5px; }
.btn.add { margin-top: 4px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.addrow input { flex: 1; min-width: 220px; }
input, select, textarea { font: inherit; color: var(--primary-text-color); background: var(--secondary-background-color, transparent); border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; }
.act { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.act input { width: 46%; min-width: 130px; margin: 2px 0; }
.cell { min-width: 220px; }
.brow { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bname { font-weight: 600; word-break: break-all; }
.tag { display: inline-block; background: var(--secondary-background-color); border: 1px solid var(--divider-color); color: var(--primary-text-color); border-radius: 10px; padding: 1px 7px; font-size: 11.5px; margin: 1px; }
tr.ignored td { opacity: 0.55; }
.chk { color: var(--secondary-text-color); font-size: 13px; display: flex; gap: 6px; align-items: center; }
summary { cursor: pointer; font-weight: 600; color: var(--primary-color); }
textarea { width: 100%; font-family: var(--code-font-family, monospace); font-size: 12.5px; }
.toast { position: fixed; left: 50%; transform: translateX(-50%) translateY(20px); bottom: 24px; background: var(--primary-color); color: var(--text-primary-color, #fff); padding: 10px 18px; border-radius: 10px; opacity: 0; pointer-events: none; transition: all 0.25s; z-index: 999; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); max-width: 80vw; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.toast.err { background: var(--error-color, #db4437); }
.foot { text-align: center; color: var(--secondary-text-color); font-size: 12px; margin-top: 8px; }
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
    this._options = { event_types: [...DEFAULT_EVENT_TYPES], data_key: "input" };
    this._services = [];
    this._entities = [];
    this._lastEntitiesAt = 0;
    this._showIgnored = false;
    this._tt = null;
    this._pollTimer = null;
    this._pollInFlight = false;
    this._lastDiscJson = "";
    this._boundClick = (e) => this._onClick(e);
    this._boundChange = (e) => this._onChange(e);
    this._boundInput = (e) => this._onInput(e);
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
    if (this._hass && !this._initStarted) {
      this._initStarted = true;
      this._init();
    } else if (this._ready) {
      // powrót do panelu po odczłączeniu przez partial-panel-resolver
      this._startPolling();
    }
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
      this._lastDiscJson = JSON.stringify(this._discovered || {});
      this._startPolling();
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
    const o = cfg.options || {};
    this._options = {
      event_types:
        Array.isArray(o.event_types) && o.event_types.length
          ? o.event_types
          : [...DEFAULT_EVENT_TYPES],
      data_key: o.data_key || "input",
    };
  }

  disconnectedCallback() {
    this._stopPolling();
  }

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
    // Live refresh co 5 s: nowo wykryte przyciski pojawiają się same.
    // Nie odświeżamy gdy użytkownik ma niezapisane zmiany albo karta jest
    // schowana — pełny render nadpisałby stan edytora.
    if (this._dirty || this._pollInFlight || document.hidden || !this._ready) return;
    this._pollInFlight = true;
    try {
      const cfg = await this._ws("button_router/get_config");
      const newDisc = cfg.discovered || {};
      const discJson = JSON.stringify(newDisc);
      const o = cfg.options || {};
      const optsChanged =
        JSON.stringify(o.event_types) !== JSON.stringify(this._options.event_types) ||
        (o.data_key || "input") !== this._options.data_key;
      if (optsChanged) {
        this._applyConfig(cfg);
        this._lastDiscJson = discJson;
        this._render();
        return;
      }
      if (discJson !== this._lastDiscJson) {
        const prev = this._discovered || {};
        const added = Object.keys(newDisc).filter((n) => !prev[n]);
        this._discovered = newDisc;
        this._lastDiscJson = discJson;
        if (added.length) {
          this._toast("Wykryto nowy przycisk: " + added.join(", "));
        }
        this._updateDiscCard();
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

  _discCardHtml() {
    const disc = Object.entries(this._discovered || {});
    const visibleDisc = disc.filter(([, e]) => this._showIgnored || !e.ignored);
    const ignoredCount = disc.filter(([, e]) => e.ignored).length;
    return `<div class="card" id="disc-card">
          <h2>Nowo wykryte przyciski <span class="badge">${visibleDisc.length}</span></h2>
          <p class="hint">Naciśnij fizyczny przycisk bez konfiguracji — pojawi się tutaj automatycznie (panel odświeża dane co 5 s). „+ Dodaj” przenosi go do mapowania poniżej.</p>
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
          <p class="hint">💡 Diagnostyka: jeśli naciśnięcie fizycznego przycisku nic nie dodaje — sprawdź w <b>Narzędzia deweloperskie → Zdarzenia</b>, czy zdarzenie w ogóle przychodzi (posłuchaj typu <code>esphome.short</code>) i pod jakim kluczem przesyłana jest nazwa przycisku (panel oczekuje klucza z opcji integracji). Możesz też użyć „🧪 Test zdarzenia” poniżej — to sprawdza całą ścieżkę panel → integracja.</p>
        </div>`;
  }

  async _reload() {
    if (this._dirty && !confirm("Masz niezapisane zmiany — odświeżyć i je porzucić?")) return;
    try {
      this._applyConfig(await this._ws("button_router/get_config"));
      this._dirty = false;
      this._render();
      this._toast("Odświeżono.");
    } catch (err) {
      this._toast("Błąd odświeżania: " + (err.message || err), true);
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

    this.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <div class="head">
          <h1>Przyciski — Button Router</h1>
          <div class="sub">Nasłuchiwane zdarzenia: <code>${this._options.event_types.map(esc).join("</code>, <code>")}</code> · klucz danych: <code>${dataKey}</code></div>
          <div class="toolbar">
            <input id="search" type="search" placeholder="Szukaj przycisku…" />
            <button class="btn" data-act="reload">↻ Odśwież</button>
            <button class="btn primary" id="btn-save" data-act="save" ${this._dirty ? "" : "disabled"}>💾 Zapisz zmiany</button>
          </div>
        </div>

        ${this._discCardHtml()}

        <div class="card">
          <h2>Mapowanie: przycisk + typ kliknięcia → akcje</h2>
          <p class="hint">W komórce podaj usługę (np. <code>light.toggle</code>) i encję (np. <code>light.salon</code>). Wiele akcji = wiele wierszy w komórce. Pusta komórka = brak reakcji. Odpowiednik „all” z Twojej automatyzacji: wpisz <code>all</code> jako encję.</p>
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

        <div class="foot">Panel integracji Button Router · typy zdarzeń zmienisz w: Ustawienia → Urządzenia i integracje → Button Router → Konfiguruj</div>
      </div>

      <datalist id="dl-services">${this._services.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-entities">${this._entities.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
  }

  _discRow(name, e) {
    const tags = Object.entries(e.events || {})
      .map(
        ([et, c]) =>
          `<span class="tag">${esc(String(et).replace("esphome.", ""))} ×${esc(c)}</span>`
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
          <button class="btn sm danger" data-act="del-btn" data-btn="${esc(name)}">Usuń przycisk</button>
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
          <button class="btn sm" data-act="del-action" data-btn="${esc(name)}" data-evt="${esc(et)}" data-idx="${i}" title="Usuń tę akcję">×</button>
        </div>`
      )
      .join("");
    return `<td class="cell">${rows}<button class="btn sm add" data-act="add-action" data-btn="${esc(name)}" data-evt="${esc(et)}">+ akcja</button></td>`;
  }

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const d = el.dataset;
    switch (act) {
      case "retry":
        this._init();
        break;
      case "save":
        this._save();
        break;
      case "reload":
        this._reload();
        break;
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
          arr.splice(Number(d.idx), 1);
          this._dirty = true;
          this._render();
        }
        break;
      }
      case "del-btn":
        if (confirm('Usunąć przycisk "' + d.btn + '" z mapowania?')) {
          delete this._buttons[d.btn];
          this._dirty = true;
          this._render();
        }
        break;
      case "add-discovered": {
        const known = d.btn;
        if (!this._buttons[known]) this._buttons[known] = { enabled: true, actions: {} };
        delete this._discovered[known];
        this._dirty = true;
        this._render();
        this._flashRow(known);
        this._ws("button_router/clear_discovered", { name: known })
          .then((res) => {
            if (res && res.discovered) this._discovered = res.discovered;
          })
          .catch(() => {});
        break;
      }
      case "ignore-discovered":
      case "unignore-discovered": {
        const ignored = act === "ignore-discovered";
        this._ws("button_router/clear_discovered", { name: d.btn, ignored: ignored })
          .then((res) => {
            if (res && res.discovered) this._discovered = res.discovered;
            this._render();
          })
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      }
      case "del-discovered":
        this._ws("button_router/clear_discovered", { name: d.btn })
          .then((res) => {
            if (res && res.discovered) this._discovered = res.discovered;
            this._render();
          })
          .catch((err) => this._toast("Błąd: " + (err.message || err), true));
        break;
      case "clear-discovered":
        if (confirm("Wyczyścić całą listę wykrytych przycisków?")) {
          this._ws("button_router/clear_discovered", {})
            .then((res) => {
              if (res && res.discovered) this._discovered = res.discovered;
              this._render();
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
    }
  }

  _onChange(e) {
    const t = e.target;
    if (t.id === "show-ignored") {
      this._showIgnored = t.checked;
      this._render();
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
      if (arr && arr[idx]) {
        const v = t.value.trim();
        if (t.dataset.field === "service") arr[idx].service = v;
        else arr[idx].entity_id = v;
        this._dirty = true;
        this._updateSaveBtn();
      }
    }
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
    tr.classList.add("flash");
    setTimeout(() => tr.classList.remove("flash"), 1600);
  }

  async _save() {
    try {
      const res = await this._ws("button_router/save_config", { buttons: this._buttons });
      this._dirty = false;
      if (res && res.discovered) this._discovered = res.discovered;
      this._render();
      this._toast("Zapisano ✓ (" + (res && res.saved ? res.saved : 0) + " przycisków)");
    } catch (err) {
      this._toast("Błąd zapisu: " + (err.message || err), true);
    }
  }

  async _doImport() {
    const ta = this.querySelector("#import-yaml");
    if (!ta || !ta.value.trim()) {
      this._toast("Wklej najpierw tekst do importu.", true);
      return;
    }
    try {
      const res = await this._ws("button_router/import_yaml", { yaml: ta.value });
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

  _toast(msg, isErr) {
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

customElements.define("button-router-panel", ButtonRouterPanel);

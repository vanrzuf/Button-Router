# Changelog

## 0.2.0 (2026-10-12)

Największa aktualizacja funkcjonalna — wszystkie usprawnienia wygody z roadmapy.

### Dodane

- **Live push zamiast czekania na odświeżenie** — panele subskrybują zdarzenie
  `button_router_event` na magistrali HA; naciśnięcie zmapowanego przycisku
  natychmiast podświetla wiersz, aktualizuje licznik użyć i kartę „Ostatnie
  zdarzenia”. Polling co 5 s zostaje jako rezerwa.
- **Statystyki per przycisk** — licznik naciśnięć, rozkład na typy zdarzeń
  i znacznik ostatniego użycia (widoczne przy każdym przycisku w mapowaniu).
- **Karta „Ostatnie zdarzenia”** — dziennik ostatnich 50 zdarzeń (czas,
  przycisk, typ, liczba wykonanych akcji) + „Wyczyść statystyki”
  (`button_router/clear_stats`).
- **Parametry akcji (`data`) z szablonami Jinja** — opcjonalne pole JSON
  przy każdej akcji, np. `{"brightness_pct": 50}` albo `{"message": "{{ now() }}"}`;
  renderowane przed wywołaniem usługi, błąd szablonu nie blokuje akcji.
- **Test akcji (▶)** — natychmiastowe wykonanie pojedynczej akcji z edytora,
  także przed zapisem (`button_router/run_action`).
- **Duplikowanie przycisków** — klonowanie całej konfiguracji przycisku
  na nową nazwę.
- **Backup mapowania** — eksport do pliku JSON (⬇ Eksport) i import z pliku
  (⬆ Import z pliku; obsługuje też YAML).
- **Opcje w panelu** — karta ⚙ Opcje: typy zdarzeń, dodatkowe typy, klucz
  danych oraz włączenie encji zdarzeń bez wychodzenia z panelu
  (`button_router/set_options`).
- **Encje zdarzeń `event.*`** (opcjonalne, **domyślnie wyłączone**) — każdy
  zmapowany przycisk jako natywna encja HA (`short`/`double`/`long`):
  automatyzacje bez panelu, historia w logbooku; włączasz pstryczkiem
  w ⚙ Opcjach lub w konfiguracji integracji. Wymagany HA ≥ 2024.4
  (`hacs.json` podniesiony).
- **QoL** — walidacja usługi/encji na czerwono, `Ctrl+S` = zapis, „Cofnij”
  (toast z undo) zamiast blokujących `confirm()` przy usuwaniu, ostrzeżenie
  przed opuszczeniem strony z niezapisanymi zmianami, responsywny widok
  mobilny (wiersze mapowania jako karty).

### Zmienione

- `get_config` zwraca dodatkowo `stats` i `recent`.
- Panel aktualizuje opcje/encje żywo też między otwartymi oknami
  (`button_router_config_updated`).
- Minimalna wersja HA: **2024.4.0** (encje zdarzeń).

## 0.1.4 (2026-10-11)

- Naprawa pustego panelu: `NotSupportedError` w Firefox przy polyfillu
  scoped-custom-element-registry — wszystkie operacje DOM przeniesione
  z konstruktora do `connectedCallback`.

## 0.1.3 (2026-10-11)

- Live odświeżanie panelu (polling co 5 s) + toast przy wykryciu nowego
  przycisku; log wykrycia INFO.

## 0.1.2 (2026-10-10)

- hassfest: porządek w manifest.json + `CONFIG_SCHEMA`.

## 0.1.1 (2026-10-10)

- Naprawa `AttributeError: 'HomeAssistant' object has no attribute 'frontend'`.

## 0.1.0 (2026-10-09)

- Pierwsze wydanie: mapowanie zdarzeń ESPHome na akcje HA, panel w sidebarze,
  automatyczne wykrywanie przycisków, import YAML, test zdarzenia.

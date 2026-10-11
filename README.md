# Button Router — przyciski fizyczne z panelem w Home Assistant

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![Wydanie](https://img.shields.io/github/v/release/twoj-login/button-router)](https://github.com/twoj-login/button-router/releases)
[![Walidacja](https://github.com/twoj-login/button-router/actions/workflows/validate.yaml/badge.svg)](https://github.com/twoj-login/button-router/actions/workflows/validate.yaml)
![Licencja](https://img.shields.io/github/license/twoj-login/button-router)

Custom integration dla **Home Assistant**, która zastępuje ręcznie utrzymywaną
automatyzację mapującą zdarzenia fizycznych przycisków (np. ESPHome:
`esphome.short`, `esphome.double`, `esphome.long`) na akcje HA.

## Co potrafi

- **Panel w sidebarze** („Przyciski”, ikona gestu) — pełny edytor mapowania:
  przycisk × typ kliknięcia → lista akcji (usługa + encja), wiele akcji na
  komórkę, włącz/wyłącz przycisk, usuwanie.
- **Automatyczne wykrywanie nowych przycisków** — naciśnięcie nieznanego
  przycisku dodaje go do sekcji „Nowo wykryte” (z licznikiem naciśnięć i
  znacznikiem czasu); stamtąd jednym kliknięciem przenosisz go do mapowania.
- **Import z obecnej automatyzacji** — wklejasz zawartość zmiennej `a`
  (albo cały YAML automatyzacji), parser sam buduje mapowanie. Puste wpisy
  typu `["", ""]` są pomijane, zbędne przecinki na końcach linii są tolerowane.
- **Test zdarzenia** — symuluje naciśnięcie (zdarzenie na magistrali HA)
  bez biegania do ściany.
- **Konfigurowalne typy zdarzeń i klucz danych** — domyślnie
  `esphome.short/double/long` + `input`, zmienisz w opcjach integracji.
- Trwałe przechowywanie konfiguracji (`.storage/button_router/storage`),
  zapis z debounce'em, brak konieczności restartów przy zmianach w panelu.

## Instalacja przez HACS

Repozytorium jest gotowe pod HACS (struktura `custom_components/button_router`,
`hacs.json`, walidacja hassfest/HACS w GitHub Actions).

**Jeśli repozytorium jest już opublikowane na GitHubie** (np.
`https://github.com/twoj-login/button-router`):

1. **HACS → ⋮ (menu) → Custom repositories**,
2. wklej URL repozytorium, kategoria: **Integration**,
3. kliknij **Pobierz** przy „Button Router”,
4. zrestartuj Home Assistant,
5. **Ustawienia → Urządzenia i integracje → Dodaj integrację → „Button Router”**,
6. w sidebarze pojawi się pozycja **Przyciski**.

HACS korzysta z wydań GitHub: po wypchnięciu taga `v*` workflow `release.yaml`
automatycznie buduje `button_router.zip` i dołącza go do wydania (ten sam zip
możesz też pobrać i rozpakować do `config/` przy instalacji ręcznej).

### Publikacja własnego repozytorium (pierwszy raz)

```bash
cd button_router
git init && git add . && git commit -m "Button Router 0.1.0"
git branch -M main
git remote add origin https://github.com/twoj-login/button-router.git
git push -u origin main
# wydanie v0.1.0 — workflow sam zbuduje i dołączy button_router.zip:
git tag v0.1.0 && git push origin v0.1.0
```

> Podmień `twoj-login` na swoją nazwę użytkownika GitHub (także w
> `manifest.json` — pola `documentation` i `issue_tracker` — oraz w badge'ach
> i `LICENSE`).

Opcjonalnie: dodaj wpis w repozytorium
[brands](https://github.com/hacs/brands/pulls) (ikona w HACS i w HA) — bez
tego HACS pokaże tylko ostrzeżenie, integracja działa normalnie.

## Instalacja ręczna (bez HACS)

1. Skopiuj katalog `custom_components/button_router` do katalogu
   konfiguracyjnego HA (`config/custom_components/button_router`).
2. Zrestartuj Home Assistant.
3. **Ustawienia → Urządzenia i integracje → Dodaj integrację → „Button Router”**.

## Migracja z Twojej obecnej automatyzacji

1. Otwórz panel **Przyciski** → sekcja **📦 Import z istniejącej automatyzacji**.
2. Wklej **zawartość zmiennej `a`** ze swojej automatyzacji
   („ESPHome przyciski ultra”) — od `{` do `}`. Możesz też wkleić cały blok
   `variables:` albo cały YAML automatyzacji — parser sam odnajdzie mapowanie.
3. Kliknij **Importuj do edytora**, przejrzyj (puste akcje `["", ""]`
   zniknęły, reszta 1:1), popraw co trzeba.
4. Kliknij **💾 Zapisz zmiany**.
5. **Wyłącz** starą automatyzację (nie usuwaj jej od razu — niech ty leży
   jako fallback na kilka dni).
6. Naciśnij dowolny nowy, jeszcze nie skonfigurowany przycisk — powinien
   pojawić się w sekcji „Nowo wykryte”.

## Jak działa wykrywanie

Integracja nasłuchuje na magistrali zdarzeń wskazanych typów (domyślnie
`esphome.short`, `esphome.double`, `esphome.long`). Gdy zdarzenie ma w danych
klucz `input` (konfigurowalny) z nazwą przycisku:

- **znany przycisk** → wykonuje zmapowane akcje (odpowiednik Twojego `repeat`
  z `for_each`, łącznie z obsługą encji `all`, np. `light.turn_off` + `all`),
- **nieznany przycisk** → zapisany w sekcji „Nowo wykryte” z licznikiem
  i godziną ostatniego naciśnięcia.

Zapis konfiguracji jest debouncowany (3 s), więc naciskanie przycisków nie
męczy dysku.

## Opcje integracji

Ustawienia → Urządzenia i integracje → Button Router → **Konfiguruj**:

- **Typy zdarzeń** — multi-select (`esphome.short/double/long` + podpowiedzi),
- **Dodatkowe typy** — dowolne inne, po przecinku (np. `esphome.quad`),
- **Klucz danych** — nazwa klucza w danych zdarzenia z nazwą przycisku
  (domyślnie `input`).

Zmiana opcji przeładowuje nasłuch automatycznie.

## API WebSocket (dla ciekawych)

| Komenda | Opis |
|---|---|
| `button_router/get_config` | mapowanie + wykryte przyciski + opcje |
| `button_router/save_config` | podmiana całego mapowania |
| `button_router/clear_discovered` | usuń jeden/wszystkie, ustaw ignoruj |
| `button_router/import_yaml` | parsowanie wklejonego YAML-a |
| `button_router/test_event` | testowe zdarzenie na magistrali |

Komendy modyfikujące wymagają konta administratora; panel widzą wszyscy
użytkownicy (podgląd).

## Rozwiązywanie problemów

- **Brak panelu w sidebarze** — odśwież przeglądarkę z pominięciem cache
  (Ctrl+F5 / Cmd+Shift+R); sprawdź logi pod kątem błędów `button_router`.
- **Przyciski się nie pojawiają** — sprawdź w *Narzędzia deweloperskie →
  Zdarzenia*, czy zdarzenie faktycznie ma postać `esphome.short` + dane
  `input: ...`; ewentualnie popraw typy zdarzeń/klucz danych w opcjach.
- **Panel pokazuje błąd ładowania** — upewnij się, że integracja jest
  skonfigurowana (dodana w UI), nie tylko skopiowana do katalogu.
- **Chcę wrócić do starej automatyzacji** — po prostu ją włącz, a integrację
  wyłącz (przełącznik na karcie integracji). Konfiguracja zostaje w `.storage`.
- **HACS nie widzi wersji** — sprawdź, czy istnieje wydanie z tagiem `v*`
  (zakładka Releases); przy instalacji z gałęzi domyślnej HACS pokaże
  `main` jako wersję.

## Deinstalacja

1. Usuń integrację w UI (mapowanie zostaje w `.storage` — skasuj plik
   `.storage/button_router/storage`, jeśli chcesz wyczyścić całkowicie).
2. Odinstaluj w HACS (lub usuń katalog `custom_components/button_router`)
   i zrestartuj HA.

## Plan rozwoju (roadmapa)

- Tłumaczenie panelu na EN (obecnie UI po polsku),
- wyszukiwarka encji z filtrowaniem po domenie usługi,
- per-przycisk notatki/etykiety i grupowanie po pomieszczeniach,
- eksport/import mapowania do pliku (backup).

## Licencja

MIT — szczegóły w [LICENSE](LICENSE).

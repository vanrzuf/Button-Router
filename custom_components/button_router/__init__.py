"""The Button Router integration.

Maps events fired by physical buttons (e.g. ESPHome devices firing
``esphome.short`` / ``esphome.double`` / ``esphome.long`` with the button name
in the event data) to Home Assistant service calls -- with automatic discovery
of new buttons and a sidebar configuration panel.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

try:
    from homeassistant.components.frontend import (
        async_register_built_in_panel,
        async_remove_panel,
    )
except ImportError:  # pragma: no cover - defensywnie (frontend w dependencies)
    async_register_built_in_panel = None  # type: ignore[assignment]
    async_remove_panel = None  # type: ignore[assignment]

try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:  # pragma: no cover - Home Assistant < 2024.3
    StaticPathConfig = None  # type: ignore[assignment]

from . import websocket as button_router_ws
from .const import (
    CONF_DATA_KEY,
    CONF_EVENT_TYPES,
    DEFAULT_DATA_KEY,
    DEFAULT_EVENT_TYPES,
    DOMAIN,
    PANEL_JS_URL,
    PANEL_SIDEBAR_ICON,
    PANEL_SIDEBAR_TITLE,
    PANEL_URL_PATH,
)
from .router import ButtonRouter
from .store import ButtonRouterStore

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the integration (YAML part is a no-op)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Button Router from a config entry."""
    store = ButtonRouterStore(hass)
    await store.async_load()

    options = {
        CONF_EVENT_TYPES: list(
            entry.options.get(CONF_EVENT_TYPES) or DEFAULT_EVENT_TYPES
        ),
        CONF_DATA_KEY: entry.options.get(CONF_DATA_KEY) or DEFAULT_DATA_KEY,
    }

    router = ButtonRouter(hass, store, options)
    router.async_setup_listeners()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "store": store,
        "router": router,
        "options": options,
    }

    button_router_ws.async_register_commands(hass)
    await _async_register_panel(hass)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    _LOGGER.info(
        "Button Router aktywny (nasłuchiwane zdarzenia: %s)",
        ", ".join(options[CONF_EVENT_TYPES]),
    )
    return True


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Serve the panel JS and register the sidebar panel."""
    js_path = Path(__file__).parent / "www" / "button-router-panel.js"

    if not hass.data.get(f"{DOMAIN}_static_registered"):
        if StaticPathConfig is not None:
            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        PANEL_JS_URL, str(js_path), cache_headers=False
                    )
                ]
            )
        else:  # pragma: no cover - Home Assistant < 2024.3 fallback
            hass.http.register_static_path(
                PANEL_JS_URL, str(js_path), cache_headers=False
            )
        hass.data[f"{DOMAIN}_static_registered"] = True

    if hass.data.get(f"{DOMAIN}_panel_registered"):
        return

    if async_register_built_in_panel is None:  # pragma: no cover
        _LOGGER.error(
            "Komponent frontend nie jest dostępny - panel boczny nie zostanie "
            "zarejestrowany (dodaj 'frontend' do dependencies w manifest.json)"
        )
        return

    async_register_built_in_panel(
        hass,
        component_name="custom",
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title=PANEL_SIDEBAR_TITLE,
        sidebar_icon=PANEL_SIDEBAR_ICON,
        require_admin=False,
        config={
            "_panel_custom": {
                "name": "button-router-panel",
                "js_url": PANEL_JS_URL,
                "embed_iframe": False,
                "trust_external": False,
            }
        },
    )
    hass.data[f"{DOMAIN}_panel_registered"] = True
    _LOGGER.info("Zarejestrowano panel boczny: %s", PANEL_URL_PATH)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when its options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    runtime = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if runtime:
        runtime["router"].async_shutdown()

    if async_remove_panel is not None:  # pragma: no branch
        try:
            async_remove_panel(hass, PANEL_URL_PATH)
        except (KeyError, RuntimeError):  # pragma: no cover - panel nie był zarejestrowany
            pass
    hass.data[f"{DOMAIN}_panel_registered"] = False
    _LOGGER.info("Button Router wyładowany")
    return True

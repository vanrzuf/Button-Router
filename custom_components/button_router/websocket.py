"""WebSocket API for the Button Router panel."""
from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol
import yaml

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import (
    CONF_CREATE_ENTITIES,
    CONF_DATA_KEY,
    CONF_EVENT_TYPES,
    CONFIG_EVENT,
    DEFAULT_DATA_KEY,
    DOMAIN,
)
from .router import render_value
from .store import normalize_buttons

_LOGGER = logging.getLogger(__name__)

# YAML (and the user's pasted automation snippets) often contain trailing
# commas after the last item, e.g. `[...]`,  }` -- PyYAML rejects those,
# so we strip them before parsing.
_TRAILING_COMMA = re.compile(r",\s*(?=[}\]])")


def _lenient_load(text: str) -> Any:
    """Parse YAML tolerating trailing commas."""
    return yaml.safe_load(_TRAILING_COMMA.sub("", text.strip()))


def extract_mapping(raw: Any) -> dict[str, Any]:
    """Extract the button mapping from pasted YAML/JSON/template text.

    Supported inputs (auto-detected):
      * the raw mapping dict itself: ``{"btn_x": {...}}``
      * the Jinja template from the automation variable: ``{{ { ... } }}``
      * a YAML document with a single key ``a:`` holding the mapping
      * a full automation YAML containing ``variables: a: ...``
    """
    for _ in range(4):
        if isinstance(raw, str):
            text = raw.strip()
            if text.startswith("{{") and text.endswith("}}"):
                text = text[2:-2].strip()
            if not text:
                return {}
            raw = _lenient_load(text)
            continue
        break
    if not isinstance(raw, dict):
        raise ValueError("Oczekiwano słownika mapowania przycisków.")
    variables = raw.get("variables")
    if isinstance(variables, dict) and "a" in variables:
        return extract_mapping(variables["a"])
    if set(raw.keys()) == {"a"}:
        return extract_mapping(raw["a"])
    return raw


def _get_runtime(hass: HomeAssistant) -> dict[str, Any] | None:
    """Return the runtime dict of the (single) config entry."""
    entries = hass.data.get(DOMAIN) or {}
    for runtime in entries.values():
        return runtime
    return None


def _fire_config_changed(hass: HomeAssistant) -> None:
    """Tell every open panel that the stored configuration changed."""
    try:
        hass.bus.async_fire(CONFIG_EVENT, {})
    except Exception:  # pragma: no cover - never block the WS command
        pass


@websocket_api.websocket_command({vol.Required("type"): "button_router/get_config"})
@callback
def ws_get_config(hass, connection, msg):
    """Return current mapping, discovered buttons, options, stats and log."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    store = runtime["store"]
    connection.send_result(
        msg["id"],
        {
            "buttons": store.data["buttons"],
            "discovered": store.data["discovered"],
            "options": runtime["options"],
            "stats": store.data.get("stats", {}),
            "recent": store.data.get("recent", []),
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/save_config",
        vol.Required("buttons"): dict,
    }
)
@callback
def ws_save_config(hass, connection, msg):
    """Replace the whole button mapping."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    store = runtime["store"]
    count = store.set_buttons(msg["buttons"])
    _LOGGER.info("Panel Button Router: zapisano %d przycisków", count)
    sync = runtime.get("sync_event_entities")
    if sync is not None:
        sync()
    _fire_config_changed(hass)
    connection.send_result(
        msg["id"], {"saved": count, "discovered": store.data["discovered"]}
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/clear_discovered",
        vol.Optional("name"): str,
        vol.Optional("ignored"): bool,
    }
)
@callback
def ws_clear_discovered(hass, connection, msg):
    """Remove one/all discovered buttons or toggle their ignored flag."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    store = runtime["store"]
    name = msg.get("name")
    if name:
        if "ignored" in msg:
            store.set_discovered_ignored(name, bool(msg["ignored"]))
        else:
            store.remove_discovered(name)
    else:
        store.remove_discovered(None)
    _fire_config_changed(hass)
    connection.send_result(msg["id"], {"discovered": store.data["discovered"]})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/import_yaml",
        vol.Required("yaml"): str,
    }
)
@websocket_api.async_response
async def ws_import_yaml(hass, connection, msg):
    """Parse pasted YAML from the user's automation and return the mapping."""
    try:
        mapping = extract_mapping(msg["yaml"])
        buttons = normalize_buttons(mapping)
    except Exception as err:  # noqa: BLE001 - report any parse error to the panel
        _LOGGER.warning("Import mapowania nie udał się: %s", err)
        connection.send_error(msg["id"], "import_failed", f"Nie udało się sparsować: {err}")
        return
    connection.send_result(msg["id"], {"buttons": buttons, "count": len(buttons)})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/set_options",
        vol.Optional("event_types"): [str],
        vol.Optional("data_key"): str,
        vol.Optional("create_event_entities"): bool,
    }
)
@callback
def ws_set_options(hass, connection, msg):
    """Update integration options from the panel (triggers entry reload)."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    entry = runtime["entry"]
    new_options: dict[str, Any] = dict(entry.options)
    if "event_types" in msg:
        types = [str(t).strip() for t in msg["event_types"] if str(t).strip()]
        if not types:
            connection.send_error(
                msg["id"], "no_event_types", "Wybierz co najmniej jeden typ zdarzenia."
            )
            return
        new_options[CONF_EVENT_TYPES] = types
    if "data_key" in msg:
        data_key = str(msg["data_key"]).strip()
        if not data_key:
            connection.send_error(
                msg["id"], "bad_data_key", "Klucz danych nie może być pusty."
            )
            return
        new_options[CONF_DATA_KEY] = data_key
    if "create_event_entities" in msg:
        new_options[CONF_CREATE_ENTITIES] = bool(msg["create_event_entities"])
    hass.config_entries.async_update_entry(entry, options=new_options)
    _LOGGER.info(
        "Panel Button Router: zmieniono opcje (encje zdarzeń: %s)",
        bool(new_options.get(CONF_CREATE_ENTITIES)),
    )
    _fire_config_changed(hass)
    connection.send_result(msg["id"], {"options": runtime["options"]})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/run_action",
        vol.Required("service"): str,
        vol.Optional("entity_id"): str,
        vol.Optional("data"): dict,
    }
)
@callback
def ws_run_action(hass, connection, msg):
    """Run a single action from the editor (▶ button) without saving it."""
    service = msg["service"].strip()
    if "." not in service:
        connection.send_error(
            msg["id"], "bad_service", "Usługa musi mieć postać domena.usługa."
        )
        return
    domain, _, svc_name = service.partition(".")
    service_data: dict[str, Any] = {}
    entity_id = str(msg.get("entity_id") or "").strip()
    if entity_id:
        service_data["entity_id"] = entity_id
    data = msg.get("data")
    if isinstance(data, dict) and data:
        service_data.update(render_value(hass, data))
    hass.async_create_task(
        hass.services.async_call(domain, svc_name, service_data, blocking=False)
    )
    connection.send_result(msg["id"], {"called": service, "service_data": service_data})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "button_router/clear_stats"}
)
@callback
def ws_clear_stats(hass, connection, msg):
    """Reset per-button usage stats and the recent-events log."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    runtime["store"].clear_stats()
    _fire_config_changed(hass)
    connection.send_result(msg["id"], {"cleared": True})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "button_router/test_event",
        vol.Required("name"): str,
        vol.Required("event_type"): str,
    }
)
@callback
def ws_test_event(hass, connection, msg):
    """Fire a test event on the event bus (simulates a physical press)."""
    runtime = _get_runtime(hass)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Integracja nie jest aktywna.")
        return
    if not msg["event_type"].startswith("esphome."):
        connection.send_error(
            msg["id"], "invalid_event_type", "Dozwolone są tylko zdarzenia esphome.*"
        )
        return
    data_key = runtime["options"].get(CONF_DATA_KEY) or DEFAULT_DATA_KEY
    hass.bus.async_fire(msg["event_type"], {data_key: msg["name"]})
    actions = (
        runtime["store"]
        .data["buttons"]
        .get(msg["name"], {})
        .get("actions", {})
        .get(msg["event_type"], [])
    )
    connection.send_result(msg["id"], {"fired": True, "actions": actions})


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_save_config)
    websocket_api.async_register_command(hass, ws_clear_discovered)
    websocket_api.async_register_command(hass, ws_import_yaml)
    websocket_api.async_register_command(hass, ws_test_event)
    websocket_api.async_register_command(hass, ws_set_options)
    websocket_api.async_register_command(hass, ws_run_action)
    websocket_api.async_register_command(hass, ws_clear_stats)

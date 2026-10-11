"""Event router: listens for button events, discovers new buttons, executes actions.

Since v0.2.0 actions may carry an optional ``data`` dict whose string values are
rendered as Jinja templates before the service call. Every handled event is
recorded in the store (per-button stats + recent log) and pushed to open panels
over the HA event bus, and -- when the option is enabled -- triggers the
matching ``event.*`` entity.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import template as template_helper

from .const import DEFAULT_DATA_KEY, PUSH_EVENT
from .store import ButtonRouterStore

_LOGGER = logging.getLogger(__name__)


def render_value(hass: HomeAssistant, value: Any) -> Any:
    """Recursively render Jinja templates inside action ``data``.

    Non-string values pass through untouched; malformed templates are logged
    and returned as-is so that a typo never blocks the whole action.
    """
    if isinstance(value, str):
        if "{{" in value or "{%" in value:
            try:
                return template_helper.Template(value, hass).async_render()
            except Exception as err:  # noqa: BLE001 - never break the action
                _LOGGER.warning("Button Router: błąd szablonu %r: %s", value, err)
                return value
        return value
    if isinstance(value, dict):
        return {k: render_value(hass, v) for k, v in value.items()}
    if isinstance(value, list):
        return [render_value(hass, v) for v in value]
    return value


class ButtonRouter:
    """Routes button events to configured service calls."""

    def __init__(
        self,
        hass: HomeAssistant,
        store: ButtonRouterStore,
        options: dict[str, Any],
        runtime: dict[str, Any] | None = None,
    ) -> None:
        self.hass = hass
        self.store = store
        self.options = options
        self.runtime = runtime
        self._unsubs: list[Any] = []

    @callback
    def async_setup_listeners(self) -> None:
        """(Re)register event bus listeners for all configured event types."""
        self.async_shutdown()
        event_types = self.options.get("event_types") or []
        for event_type in event_types:
            self._unsubs.append(
                self.hass.bus.async_listen(event_type, self._async_handle_event)
            )
        _LOGGER.debug("Nasłuchuję zdarzeń: %s", ", ".join(event_types))

    @callback
    def async_shutdown(self) -> None:
        """Remove all listeners."""
        while self._unsubs:
            self._unsubs.pop()()

    def _fire_push(self, payload: dict[str, Any]) -> None:
        """Notify open panels about one handled button event (live push)."""
        try:
            self.hass.bus.async_fire(PUSH_EVENT, payload)
        except Exception:  # pragma: no cover - never break routing
            pass

    def _trigger_event_entity(self, name: str, event_type: str) -> None:
        """Fire the matching event.* entity (if the option is enabled)."""
        trigger = (self.runtime or {}).get("async_trigger_event_entity")
        if trigger is None:
            return
        try:
            trigger(name, event_type)
        except Exception as err:  # pragma: no cover
            _LOGGER.warning("Button Router: encja zdarzenia dla %s: %s", name, err)

    async def _async_handle_event(self, event: Event) -> None:
        """Handle one button event from the event bus."""
        if not isinstance(event.data, dict):
            return
        data_key = self.options.get("data_key") or DEFAULT_DATA_KEY
        name = event.data.get(data_key)
        if not isinstance(name, str) or not name:
            _LOGGER.debug(
                "Zdarzenie %s bez poprawnego klucza '%s' (data=%s) - pomijam",
                event.event_type,
                data_key,
                event.data,
            )
            return

        buttons = self.store.data.get("buttons", {})
        cfg = buttons.get(name)

        if cfg is None:
            # Auto-discovery: unknown button pressed -> remember it for the panel.
            self.store.touch_discovered(name, event.event_type)
            self._fire_push(
                {
                    "name": name,
                    "event_type": event.event_type,
                    "discovered": True,
                }
            )
            _LOGGER.info(
                "Wykryto nowy przycisk: %s (%s) - pojawi się w panelu",
                name,
                event.event_type,
            )
            return

        enabled = bool(cfg.get("enabled", True))
        if not enabled:
            self.store.record_event(name, event.event_type, 0, enabled=False)
            self._fire_push(
                {
                    "name": name,
                    "event_type": event.event_type,
                    "executed": 0,
                    "enabled": False,
                }
            )
            return

        executed = 0
        actions = cfg.get("actions", {}).get(event.event_type) or []
        for action in actions:
            service = action.get("service", "")
            if "." not in service:
                continue
            domain, _, svc_name = service.partition(".")
            service_data: dict[str, Any] = {}
            entity_id = action.get("entity_id", "")
            if entity_id:
                service_data["entity_id"] = entity_id
            extra = action.get("data")
            if isinstance(extra, dict) and extra:
                service_data.update(render_value(self.hass, extra))
            _LOGGER.debug(
                "Przycisk %s [%s] -> %s %s %s",
                name,
                event.event_type,
                service,
                entity_id or "",
                extra if isinstance(extra, dict) else "",
            )
            executed += 1
            self.hass.async_create_task(
                self.hass.services.async_call(
                    domain,
                    svc_name,
                    service_data,
                    blocking=False,
                    context=event.context,
                )
            )

        self.store.record_event(name, event.event_type, executed, enabled=True)
        self._trigger_event_entity(name, event.event_type)
        self._fire_push(
            {
                "name": name,
                "event_type": event.event_type,
                "executed": executed,
                "enabled": True,
            }
        )

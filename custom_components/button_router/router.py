"""Event router: listens for button events, discovers new buttons, executes actions."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback

from .const import CONF_DATA_KEY, DEFAULT_DATA_KEY
from .store import ButtonRouterStore

_LOGGER = logging.getLogger(__name__)


class ButtonRouter:
    """Routes button events to configured service calls."""

    def __init__(
        self,
        hass: HomeAssistant,
        store: ButtonRouterStore,
        options: dict[str, Any],
    ) -> None:
        self.hass = hass
        self.store = store
        self.options = options
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
            _LOGGER.info(
                "Wykryto nowy przycisk: %s (%s) - pojawi się w panelu",
                name,
                event.event_type,
            )
            return

        if not cfg.get("enabled", True):
            return

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
            _LOGGER.debug(
                "Przycisk %s [%s] -> %s %s",
                name,
                event.event_type,
                service,
                entity_id or "",
            )
            self.hass.async_create_task(
                self.hass.services.async_call(
                    domain,
                    svc_name,
                    service_data,
                    blocking=False,
                    context=event.context,
                )
            )

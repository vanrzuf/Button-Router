"""Event entities: each mapped button as a native Home Assistant ``event.*`` entity.

Enabled by the ``create_event_entities`` option (default: **off**). When
enabled, every button in the mapping gets an event entity exposing the
configured event types (``short`` / ``double`` / ``long`` -- the ``esphome.``
prefix is stripped), so automations can react natively and the logbook keeps
a usage history.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.event import EventEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def strip_prefix(event_type: str) -> str:
    """Turn ``esphome.short`` into ``short`` (pass through unknown forms)."""
    if event_type.startswith("esphome."):
        return event_type.split(".", 1)[1]
    return event_type


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the event platform and register the dynamic sync hook."""
    runtime = (hass.data.get(DOMAIN) or {}).get(entry.entry_id)
    if runtime is None:
        return

    runtime["event_add_entities"] = async_add_entities

    @callback
    def _sync() -> None:
        """Schedule a diff of current buttons vs existing entities."""
        hass.async_create_task(async_sync_event_entities(hass, entry))

    runtime["sync_event_entities"] = _sync
    await async_sync_event_entities(hass, entry)


async def async_sync_event_entities(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Add/remove event entities so they mirror the current button mapping."""
    runtime = (hass.data.get(DOMAIN) or {}).get(entry.entry_id)
    if runtime is None:
        return
    store = runtime["store"]
    options = runtime["options"]
    entities: dict[str, ButtonRouterEventEntity] = runtime.setdefault(
        "event_entities", {}
    )

    if not bool(options.get("create_event_entities")):
        for ent in list(entities.values()):
            hass.async_create_task(ent.async_remove())
        entities.clear()
        return

    buttons = store.data.get("buttons", {})
    event_types = list(options.get("event_types") or [])

    # Refresh the exposed types of existing entities (options may have changed).
    for ent in entities.values():
        ent.update_types(event_types)

    # Add entities for newly mapped buttons.
    new = [
        ButtonRouterEventEntity(entry, name, event_types)
        for name in buttons
        if name not in entities
    ]
    for ent in new:
        entities[ent.button_name] = ent
    if new:
        _LOGGER.info(
            "Button Router: dodaję encje zdarzeń dla %d przycisków", len(new)
        )
        add = runtime.get("event_add_entities")
        if add is not None:
            add(new)

    # Remove entities whose buttons are no longer mapped.
    for name in [n for n in list(entities) if n not in buttons]:
        ent = entities.pop(name)
        hass.async_create_task(ent.async_remove())


class ButtonRouterEventEntity(EventEntity):
    """One event entity per mapped button."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(
        self,
        entry: ConfigEntry,
        name: str,
        event_types: list[str],
    ) -> None:
        self._button_name = name
        self._attr_unique_id = f"{DOMAIN}_{name}"
        self._attr_name = name
        self._attr_event_types = [strip_prefix(t) for t in event_types]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Button Router",
            manufacturer="vanrzuf",
            model="ESPHome buttons",
        )

    @property
    def button_name(self) -> str:
        """Button name this entity represents."""
        return self._button_name

    @callback
    def update_types(self, event_types: list[str]) -> None:
        """Refresh exposed event types (after an options change)."""
        types = [strip_prefix(t) for t in event_types]
        if types != self._attr_event_types:
            self._attr_event_types = types
            self.async_write_ha_state()

    @callback
    def async_handle_event(self, event_type: str) -> None:
        """Fire this entity for one physical button event."""
        self._trigger_event(strip_prefix(event_type))

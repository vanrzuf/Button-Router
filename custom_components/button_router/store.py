"""Persistent storage and normalization helpers for Button Router."""
from __future__ import annotations

import asyncio
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import SAVE_DEBOUNCE_SECONDS, STORAGE_KEY, STORAGE_VERSION


def normalize_buttons(raw: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Normalize the button -> event type -> actions mapping into canonical form.

    Accepts both the dict form used by the panel
    (``{"btn": {"actions": {"esphome.short": [{"service": ..., "entity_id": ...}]}}}``)
    and the legacy list form from the user's automation
    (``{"btn": {"esphome.short": [["light.toggle", "light.x"]]}}``).

    Placeholders like ``["", ""]`` (no-op rows) are dropped automatically.
    """
    result: dict[str, dict[str, Any]] = {}
    for name, cfg in (raw or {}).items():
        if not isinstance(cfg, dict):
            continue
        actions: dict[str, list[dict[str, str]]] = {}
        source: dict[str, Any] = cfg.get("actions") if isinstance(cfg.get("actions"), dict) else cfg
        for event_type, entries in (source or {}).items():
            if not isinstance(entries, list):
                continue
            cleaned: list[dict[str, str]] = []
            for entry in entries:
                service = ""
                entity_id = ""
                if isinstance(entry, dict):
                    service = str(entry.get("service") or "").strip()
                    entity_id = str(entry.get("entity_id") or "").strip()
                elif isinstance(entry, (list, tuple)) and entry:
                    service = str(entry[0] or "").strip()
                    entity_id = str(entry[1] if len(entry) > 1 else "").strip()
                if "." not in service:
                    # Skip placeholders like ["", ""] and malformed rows.
                    continue
                action: dict[str, str] = {"service": service}
                if entity_id:
                    action["entity_id"] = entity_id
                cleaned.append(action)
            if cleaned:
                actions[str(event_type)] = cleaned
        result[str(name)] = {
            "enabled": bool(cfg.get("enabled", True)),
            "actions": actions,
        }
    return result


class ButtonRouterStore:
    """Debounced persistent storage for mappings and discovered buttons."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, dict[str, Any]] = {"buttons": {}, "discovered": {}}
        self._unsub_save: Callable[[], None] | None = None
        self._save_lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Load data from disk (if any)."""
        restored = await self._store.async_load()
        if isinstance(restored, dict):
            discovered = restored.get("discovered")
            self._data = {
                "buttons": normalize_buttons(restored.get("buttons")),
                "discovered": discovered if isinstance(discovered, dict) else {},
            }

    @property
    def data(self) -> dict[str, dict[str, Any]]:
        """Return the current in-memory data."""
        return self._data

    def set_buttons(self, raw: dict[str, Any]) -> int:
        """Replace the button mapping; drops discovered entries now configured."""
        self._data["buttons"] = normalize_buttons(raw)
        for name in list(self._data["discovered"]):
            if name in self._data["buttons"]:
                self._data["discovered"].pop(name)
        self.schedule_save()
        return len(self._data["buttons"])

    @callback
    def touch_discovered(self, name: str, event_type: str) -> None:
        """Record an event from an unconfigured button (auto-discovery)."""
        entry = self._data["discovered"].setdefault(
            name,
            {
                "first_seen": dt_util.utcnow().isoformat(),
                "last_seen": "",
                "count": 0,
                "events": {},
                "ignored": False,
            },
        )
        now = dt_util.utcnow().isoformat()
        entry["last_seen"] = now
        entry["count"] = int(entry.get("count", 0)) + 1
        events = entry.setdefault("events", {})
        events[event_type] = int(events.get(event_type, 0)) + 1
        self.schedule_save()

    @callback
    def remove_discovered(self, name: str | None = None) -> None:
        """Remove one or all discovered entries."""
        if name:
            self._data["discovered"].pop(name, None)
        else:
            self._data["discovered"] = {}
        self.schedule_save()

    @callback
    def set_discovered_ignored(self, name: str, ignored: bool) -> None:
        """Mark a discovered button as ignored (kept, but hidden)."""
        entry = self._data["discovered"].get(name)
        if entry is not None:
            entry["ignored"] = bool(ignored)
            self.schedule_save()

    @callback
    def schedule_save(self) -> None:
        """Schedule a debounced save to disk."""
        if self._unsub_save is not None:
            self._unsub_save()
        self._unsub_save = async_call_later(
            self._hass, SAVE_DEBOUNCE_SECONDS, self._async_finish_save
        )

    @callback
    def _async_finish_save(self, _now: Any) -> None:
        self._unsub_save = None
        self._hass.async_create_task(self._async_write())

    async def _async_write(self) -> None:
        async with self._save_lock:
            await self._store.async_save(self._data)

    async def async_flush(self) -> None:
        """Cancel the pending debounce timer and save immediately."""
        if self._unsub_save is not None:
            self._unsub_save()
            self._unsub_save = None
        await self._async_write()

"""Config flow to set up the Button Router integration."""
from __future__ import annotations

import re

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import (
    CONF_DATA_KEY,
    CONF_EVENT_TYPES,
    CONF_EXTRA_TYPES,
    CONF_NAME,
    DEFAULT_DATA_KEY,
    DEFAULT_EVENT_TYPES,
    DEFAULT_NAME,
    DOMAIN,
    EVENT_TYPE_CHOICES,
)


class ButtonRouterConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Button Router."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial (and only) step."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title=user_input.get(CONF_NAME) or DEFAULT_NAME, data={}
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Optional(CONF_NAME, default="Przyciski ESPHome"): str}
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Create the options flow handler."""
        return ButtonRouterOptionsFlow(config_entry)


class ButtonRouterOptionsFlow(config_entries.OptionsFlow):
    """Handle options (event types, data key) for Button Router."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(self, user_input=None):
        """Manage the options."""
        errors: dict[str, str] = {}
        current_types = list(
            self._entry.options.get(CONF_EVENT_TYPES) or DEFAULT_EVENT_TYPES
        )
        current_key = self._entry.options.get(CONF_DATA_KEY) or DEFAULT_DATA_KEY

        if user_input is not None:
            types = list(user_input.get(CONF_EVENT_TYPES) or [])
            extra = (user_input.get(CONF_EXTRA_TYPES) or "").strip()
            if extra:
                for part in re.split(r"[,\s]+", extra):
                    part = part.strip()
                    if part and part not in types:
                        types.append(part)
            if not types:
                errors["base"] = "no_event_types"
            else:
                data_key = (
                    (user_input.get(CONF_DATA_KEY) or "").strip() or DEFAULT_DATA_KEY
                )
                return self.async_create_entry(
                    title=DEFAULT_NAME,
                    data={CONF_EVENT_TYPES: types, CONF_DATA_KEY: data_key},
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_EVENT_TYPES, default=current_types): cv.multi_select(
                    EVENT_TYPE_CHOICES
                ),
                vol.Required(CONF_DATA_KEY, default=current_key): str,
                vol.Optional(CONF_EXTRA_TYPES, default=""): str,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)

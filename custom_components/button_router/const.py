"""Constants for the Button Router integration."""
from typing import Final

DOMAIN: Final = "button_router"

CONF_NAME: Final = "name"
CONF_EVENT_TYPES: Final = "event_types"
CONF_DATA_KEY: Final = "data_key"
CONF_EXTRA_TYPES: Final = "extra_event_types"
CONF_CREATE_ENTITIES: Final = "create_event_entities"

DEFAULT_NAME: Final = "Button Router"
DEFAULT_CREATE_ENTITIES: Final = False
DEFAULT_EVENT_TYPES: Final = ["esphome.short", "esphome.double", "esphome.long"]
EXTRA_EVENT_TYPE_CHOICES: Final = [
    "esphome.press",
    "esphome.hold",
    "esphome.release",
    "esphome.click",
]
EVENT_TYPE_CHOICES: Final = DEFAULT_EVENT_TYPES + EXTRA_EVENT_TYPE_CHOICES
DEFAULT_DATA_KEY: Final = "input"

STORAGE_KEY: Final = "button_router/storage"
STORAGE_VERSION: Final = 1
SAVE_DEBOUNCE_SECONDS: Final = 3

RECENT_LIMIT: Final = 50

# HA event bus events fired by the integration for the panel (live push).
PUSH_EVENT: Final = "button_router_event"
CONFIG_EVENT: Final = "button_router_config_updated"

PANEL_URL_PATH: Final = "button_router"
PANEL_JS_URL: Final = "/button_router/panel.js"
PANEL_SIDEBAR_TITLE: Final = "Przyciski"
PANEL_SIDEBAR_ICON: Final = "mdi:gesture-tap-button"

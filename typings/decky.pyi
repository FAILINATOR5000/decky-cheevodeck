# Type stub for the `decky` module.
#
# Decky Loader injects this module into the plugin's namespace at runtime, so
# it does not exist anywhere on disk at author time and Pylance flags all 27
# backend files that import it. The stub exists purely to answer the editor —
# it is never imported and never shipped.
#
# Only the surface this plugin actually touches is declared. The DECKY_* values
# are all read through getattr() with a fallback, so they are optional here in
# practice; they are listed because having them typed makes the fallbacks
# readable rather than mysterious.

import logging
from typing import Any

logger: logging.Logger

HOME: str
DECKY_USER_HOME: str
DECKY_PLUGIN_DIR: str
DECKY_PLUGIN_VERSION: str
DECKY_PLUGIN_SETTINGS_DIR: str
DECKY_PLUGIN_RUNTIME_DIR: str

async def emit(event: str, *args: Any) -> None: ...

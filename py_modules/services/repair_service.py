import decky


class RepairService:
    """The every-boot pass that puts things back the way they should be.

    Runs once when the plugin loads, from Plugin._main, alongside the cache
    maintenance sweep it is modelled on. Its job is anything that was written
    correctly at the time and has since gone stale: a launcher carrying an old
    label, a file left behind by a feature that moved, a value stored in a
    shape the current code no longer writes.

    There is no patch level and deliberately so. Each repair decides for itself
    whether it needs to act, which makes the check its own record — nothing has
    to remember whether it ran. That also makes the whole thing self-healing
    rather than migrate-once: a restored backup or a factory reset gets fixed
    again on the next boot, where a version stamp would look at its counter and
    conclude the work was already done.

    Every repair is wrapped on its own. One failing must not skip the rest, and
    none of it may stop the plugin from loading — a repair is housekeeping, and
    housekeeping that takes the panel down with it is worse than the mess.
    """

    def __init__(self, *, update_checker_service):
        self._update_checker_service = update_checker_service

    def run_startup_repairs(self) -> dict:
        """Run every repair in turn and report which ones did anything.

        Returns the slugs of the repairs that actually changed something, so a
        boot with nothing to do returns an empty list and logs nothing at all.
        """
        fixed = []

        try:
            if self._update_checker_service.refresh_desktop_launcher():
                fixed.append("desktop_launcher")
        except Exception as e:
            decky.logger.warning(
                "repair: desktop launcher refresh failed: %s",
                type(e).__name__,
            )

        if fixed:
            decky.logger.info("repair: fixed %s", ", ".join(fixed))
        return {"fixed": fixed}

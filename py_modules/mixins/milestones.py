import asyncio

from mixins._context import PluginContext


class MilestonesMixin(PluginContext):

    async def get_milestones_state(self):
        return await asyncio.to_thread(self.milestones_service.state)

    async def request_milestones_check(self):
        self.milestones_service.request_check("panel")
        return {"ok": True}

    async def record_milestone_event(self, kind="", detail=None):
        return {"ok": self.milestones_service.record_event(str(kind or ""), detail)}

    async def reroll_quest(self, period=""):
        rolled = await asyncio.to_thread(self.milestones_service.reroll, str(period or ""))
        state = await asyncio.to_thread(self.milestones_service.state)
        state["rerolled"] = rolled
        return state

    async def mark_milestones_seen(self):
        return {"ok": await asyncio.to_thread(self.milestones_service.mark_seen)}

    async def save_milestones_collapsed(self, categories=None):
        picked = await asyncio.to_thread(self.milestones_service.save_collapsed, categories)
        return {"ok": picked is not None, "collapsed": picked or []}

    async def save_milestones_service_enabled(self, milestones_service_enabled: bool = True):
        value = self.settings_store.update_milestones_service_enabled(milestones_service_enabled)
        self.milestones_service.settings_changed()
        return {"ok": True, "milestonesServiceEnabled": value}

    async def save_milestones_tick_minutes(self, milestones_tick_minutes: int = 60):
        value = self.settings_store.update_milestones_tick_minutes(milestones_tick_minutes)
        self.milestones_service.settings_changed()
        return {"ok": True, "milestonesTickMinutes": value}

    async def save_milestones_header_style(self, milestones_header_style: str = "typed"):
        value = self.settings_store.update_milestones_header_style(milestones_header_style)
        return {"ok": True, "milestonesHeaderStyle": value}

    async def save_milestones_sort(self, milestones_sort: str = "list"):
        value = self.settings_store.update_milestones_sort(milestones_sort)
        return {"ok": True, "milestonesSort": value}

    async def clear_milestone_progress(self):
        return {"ok": await asyncio.to_thread(self.milestones_service.clear_progress)}

from mixins._context import PluginContext


class CalculatorMixin(PluginContext):

    async def get_calculator_history(self):
        return {
            "ok": True,
            "entries": self.calculator_store.list_entries(),
        }

    async def add_calculator_history_entry(self, expression: str = "", result: str = ""):
        return {
            "ok": True,
            "entries": self.calculator_store.add_entry(expression, result),
        }

    async def clear_calculator_history(self):
        return {
            "ok": True,
            "entries": self.calculator_store.clear(),
        }

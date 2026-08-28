from mixins._context import PluginContext


class NotesMixin(PluginContext):

    async def save_show_reminder_ticker(self, show_reminder_ticker: bool):
        value = self.settings_store.update_show_reminder_ticker(show_reminder_ticker)

        return {
            "ok": True,
            "showReminderTicker": value,
        }

    async def save_show_notes_dot(self, show_notes_dot: bool):
        value = self.settings_store.update_show_notes_dot(show_notes_dot)

        return {
            "ok": True,
            "showNotesDot": value,
        }

    async def save_game_notes_a_button_mode(self, game_notes_a_button_mode: str):
        value = self.settings_store.update_game_notes_a_button_mode(game_notes_a_button_mode)

        return {
            "ok": True,
            "gameNotesAButtonMode": value,
        }

    async def save_default_note_color(self, default_note_color: str = "default"):
        value = self.settings_store.update_default_note_color(default_note_color)
        return {"ok": True, "defaultNoteColor": value}

    async def load_game_notes(self, game_id=None):
        return self.notes_store.load_notes_for_game(game_id)

    async def create_game_note(
        self,
        game_id=None,
        title: str = "",
        body: str = "",
        tag=None,
        color: str = "default",
        reminder_mode: str = "off",
        reminder_every_minutes=None,
        reminder_every_value=None,
        reminder_every_unit=None,
    ):
        return self.notes_store.create_note(
            game_id,
            title=title,
            body=body,
            tag=tag,
            color=color,
            reminder_mode=reminder_mode,
            reminder_every_minutes=reminder_every_minutes,
            reminder_every_value=reminder_every_value,
            reminder_every_unit=reminder_every_unit,
        )

    async def update_game_note(
        self,
        game_id=None,
        note_id: str = "",
        title: str = "",
        body: str = "",
        tag=None,
        color: str = "default",
        reminder_mode: str = "off",
        reminder_every_minutes=None,
        reminder_every_value=None,
        reminder_every_unit=None,
        reset_reminder_timer: bool = False,
    ):
        return self.notes_store.update_note(
            game_id,
            note_id,
            title=title,
            body=body,
            tag=tag,
            color=color,
            reminder_mode=reminder_mode,
            reminder_every_minutes=reminder_every_minutes,
            reminder_every_value=reminder_every_value,
            reminder_every_unit=reminder_every_unit,
            reset_reminder_timer=reset_reminder_timer,
        )

    async def delete_game_note(self, game_id=None, note_id: str = ""):
        return self.notes_store.delete_note(game_id, note_id)

    async def reorder_game_notes(self, game_id=None, ordered_ids=None):
        if ordered_ids is None:
            ordered_ids = []
        return self.notes_store.reorder_notes(game_id, ordered_ids)

    async def set_game_notes_sort_mode(self, game_id=None, mode: str = "newest"):
        return self.notes_store.set_sort_mode(game_id, mode)

    async def get_pending_game_note_reminders(self, game_id=None):
        items = self.notes_reminder_service.get_pending(game_id)
        return {"ok": True, "reminders": items}

    async def ack_game_note_reminders(self, game_id=None, note_ids=None):
        if note_ids is None:
            note_ids = []
        return self.notes_reminder_service.ack(game_id, note_ids)

    async def clear_note_fired_dot(self, game_id=None, note_id: str = ""):
        result = self.notes_store.set_show_fired_dot(game_id, note_id, False)
        self.notes_reminder_service.ack(game_id, [note_id])
        return result

    async def mark_game_note_completed(self, game_id=None, note_id: str = "", completed: bool = True):
        result = self.notes_store.mark_note_completed(game_id, note_id, completed)
        if completed:
            self.notes_reminder_service.ack(game_id, [note_id])
        return result

    async def delete_all_notes(self):
        result = self.notes_store.delete_all_notes()
        return {
            "ok": bool(result.get("ok", False)),
            "deletedNotes": int(result.get("deletedNotes", 0)),
        }

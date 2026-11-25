import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time

import decky
import multiplayer_protocol as proto
from multiplayer_friends_store import (
    MAX_DISMISSED,
    MAX_FRIENDS,
    clean_name,
    clean_pic,
    clean_text,
    friends_digest,
    is_ulid,
)
from multiplayer_messages_store import MAX_MESSAGES
from nearby_protocol import FrameError, canonical
from notifications import emit_notification, is_type_enabled
from services import lobby_client

FRIEND_PORT = 49734
FRIEND_KIND = "cheevodeck.friend"
FRIENDS_EVENT = "cheevodeck_multiplayer_friends"

PING_SECONDS = 20
REPORT_REFRESH_SECONDS = 300
RANK_SECONDS = 60
SILENT_SECONDS = 75
REPLY_SECONDS = 5
RETRY_SECONDS = (2, 5, 10, 15, 30)
INVITE_SECONDS = 600
INVITE_WAIT_SECONDS = 2
SELF_PIC_SECONDS = 7 * 86400
DATAGRAM_BYTES = 2048
DATAGRAMS_PER_SECOND = 20
DATAGRAMS_PER_SECOND_ALL = 100
INCOMING_REQUESTS_MAX = 100
GOT_SECONDS = 20
GOT_AFTER_TAKEN_SECONDS = 6
RESEND_SECONDS = 60
NOTICE_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
NOTICE_CHARS = 4000
PLUGIN_VERSION = str(getattr(decky, "DECKY_PLUGIN_VERSION", "") or "").strip()
CLOCK_SKEW_SECONDS = 120
LIST_MAX = 500
REPORT_ULIDS_MAX = 520
SEEN_INVITES = 256
ACK_GATHER_SECONDS = 0.3
LAN_HERE_SECONDS = 10
LAN_SEEN_SECONDS = 35
OUTBOX_GAP_SECONDS = 0.2
ACK_MAX = 500
FIND_ROUNDS = 3
SYNC_ROWS = 50
SYNC_PAGES_MAX = MAX_FRIENDS // SYNC_ROWS + 1
TOASTS = {
    "request": ("Friend Request", "Request from {{name}}."),
    "accepted": ("Friend Request Accepted", "{{name}} accepted."),
    "message": ("New Message", "Message from {{name}}."),
    "invite": ("Room Invite", "{{name}} invited you."),
}

_HEX16 = set("0123456789abcdef")


def _hex16(value) -> bool:
    return isinstance(value, str) and len(value) == 16 and set(value) <= _HEX16


def _sign(key_hex: str, label: str, body: dict) -> str:
    return hmac.new(bytes.fromhex(key_hex), (label + "|" + canonical(body)).encode("ascii"),
                    hashlib.sha256).hexdigest()


def _signed(key_hex: str, label: str, body, tag) -> bool:
    if not isinstance(body, dict) or not isinstance(tag, str):
        return False
    try:
        return hmac.compare_digest(_sign(key_hex, label, body), tag)
    except (TypeError, ValueError):
        return False


def _list_row(raw):
    if not isinstance(raw, dict) or not is_ulid(raw.get("u")) or not proto.is_key(raw.get("key")):
        return None
    name = clean_name(raw.get("name")) or "?"
    added = raw.get("added")
    return {"u": raw["u"], "key": raw["key"], "name": name, "pic": clean_pic(raw.get("pic")),
            "added": added if type(added) is int and 0 < added <= time.time() + CLOCK_SKEW_SECONDS else 0,
            "f": raw.get("f") is True}


def _here_slot(key_hex: str, body: dict) -> str:
    return _sign(key_hex, "here-slot", {"at": body.get("at")})[:16]


class _Listener(asyncio.DatagramProtocol):
    def __init__(self, service):
        self._service = service
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        self._service._heard(data, addr)

    def error_received(self, exc):
        pass


class MultiplayerFriendsService:
    def __init__(self, *, store, messages_store, settings_store, game_mode, multiplayer, notifications_store,
                 ra_friends, resolved_avatars, heal, ra_call, ra, own_rank=None, notice_store=None,
                 port: int = FRIEND_PORT, peer_port: int = FRIEND_PORT, broadcast: str = "255.255.255.255"):
        self._store = store
        self._notice_store = notice_store
        self._own_rank = own_rank
        self._rank = None
        self._rank_at = None
        self._messages = messages_store
        self._resolved_avatars = resolved_avatars
        self._heal = heal
        self._settings_store = settings_store
        self._game_mode = game_mode
        self._mp = multiplayer
        self._notifications = notifications_store
        self._ra_friends = ra_friends
        self._ra_call = ra_call
        self._ra = ra
        self._port = port
        self._peer_port = peer_port
        self._broadcast = broadcast

        self._loop = None
        self._link = None
        self._writer = None
        self._send_lock = None
        self._up = False
        self._refused = ""
        self._presence = {}
        self._suggestions = []
        self._waiting = {}
        self._pings = 0
        self._pongs = 0
        self._confirming = []
        self._invites = {}
        self._seen_invites = []
        self._invite_acks = {}
        self._listener = None
        self._heard_at = []
        self._heard_from = {}
        self._sent_report = None
        self._sent_room = None
        self._sent_game = ""
        self._report_stale = True
        self._report_at = 0.0
        self._running_name = ""
        self._session_account = ""
        self._acks = []
        self._tasks = set()
        self._hotspot = None
        self._lan_seen = {}
        self._lan_here = None
        self._milestone_event = None
        self._held_notice = None
        self._holding_notices = False
        self._held_answers = None
        self._delivering = False
        self._pushed = {}
        self._pushed_at = {}
        self._assumed = {}
        self._list_waits = {}
        self._lists_off = False
        self._list_events = None
        self._resync = False
        self._syncing = False

    def set_event_loop(self, loop) -> None:
        self._loop = loop
        self._send_lock = asyncio.Lock()
        loop.call_soon_threadsafe(self._follow)

    def _soon(self, callback) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(callback)

    def sync(self) -> None:
        self._soon(self._follow)

    def set_hotspot(self, hotspot) -> None:
        self._hotspot = hotspot

    def set_milestone_event(self, record) -> None:
        self._milestone_event = record

    def _hotspot_broadcast(self) -> str:
        return self._hotspot.broadcast_address() if self._hotspot is not None else ""

    def settings_changed(self) -> None:
        self._soon(self._restart)

    def account_changed(self) -> None:
        self._soon(self._restart)

    def stop(self) -> None:
        if self._link is not None:
            self._link.cancel()
            self._link = None
        self._close_listener()

    def _restart(self) -> None:
        if self._link is not None:
            self._link.cancel()
            self._link = None
        self._close_listener()
        self._presence = {}
        self._suggestions = []
        self._invites = {}
        self._refused = ""
        self._held_answers = None
        self._set_up(False)
        self._follow()

    def _spawn(self, coro):
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _debug(self, message: str, *args) -> None:
        self._mp._debug("friends: " + message, *args)

    def _cfg(self) -> dict:
        return self._settings_store.load_config()

    def _on(self, cfg=None) -> bool:
        cfg = cfg if cfg is not None else self._cfg()
        return bool(cfg.get("mpFriendsEnabled", False))

    def _standby(self, cfg=None) -> bool:
        cfg = cfg if cfg is not None else self._cfg()
        settings = self._settings_store
        return bool(settings.get_battery_saver(cfg)) and bool(settings.get_battery_saver_disables_ez_friends(cfg))

    def _me(self) -> str:
        ulid = self._store.ulid
        return ulid if is_ulid(ulid) else ""

    def _my_name(self) -> str:
        return proto.clean_user(self._cfg().get("username") or "")

    def _data(self):
        try:
            return self._store.load()
        except Exception as e:
            decky.logger.warning("friends: couldn't read the friends file (%s)", type(e).__name__)
            return None

    def _mutate(self, change, ulid=None):
        try:
            data, result = self._store.mutate(change, ulid=ulid)
        except Exception as e:
            decky.logger.warning("friends: couldn't save (%s)", type(e).__name__)
            return None
        if data is not None:
            self._held_answers = {entry["ulid"] for entry in data["outbox"] if entry["op"] == "answer"}
        if result:
            self._report_stale = True
            self._changed()
        return result

    def _changed(self) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(decky.emit(FRIENDS_EVENT, {}), loop)

    def _wanted(self) -> bool:
        cfg = self._cfg()
        if self._refused or not self._game_mode() or not self._on(cfg) or self._standby(cfg) or not self._me() \
                or self._mp.lobby_server() is None:
            return False
        return True

    def _follow(self) -> None:
        if self._loop is None:
            return
        if self._wanted():
            if self._link is None or self._link.done():
                self._link = self._spawn(self._run_link())
        elif self._link is not None:
            self._link.cancel()
            self._link = None
            self._set_up(False)
        data = self._data()
        listen = self._game_mode() and self._on() and not self._standby() and bool(self._me()) \
            and bool(data and data["friends"])
        if listen and self._listener is None:
            self._spawn(self._open_listener())
        elif not listen:
            self._close_listener()

    def identity(self) -> tuple:
        if not self._on():
            return "", ""
        data = self._data()
        return self._me(), data["selfPic"] if data else ""

    def rank(self):
        if self._own_rank is None:
            return None
        now = time.monotonic()
        if self._rank_at is None or now - self._rank_at >= RANK_SECONDS:
            self._rank = self._own_rank()
            self._rank_at = now
        return self._rank

    def rank_changed(self) -> None:
        self._soon(self._rank_moved)

    def _rank_moved(self) -> None:
        self._rank_at = None
        self.report_changed()

    async def _refresh_self_pic(self) -> None:
        data = self._store.ensure()
        me = self._me()
        if data is None or not me or (data["selfPicAt"] and time.time() - data["selfPicAt"] < SELF_PIC_SECONDS):
            return
        key = str(self._cfg().get("webApiKey") or "").strip()
        try:
            profile = await self._ra_call(self._ra.get_user_profile, me, key)
        except Exception as e:
            self._debug("own picture lookup failed (%s)", type(e).__name__)
            return
        if not isinstance(profile, dict) or str(profile.get("ULID") or "") != me:
            return
        pic = clean_pic(profile.get("UserPic"))

        def keep(stored):
            if pic:
                stored["selfPic"] = pic
            stored["selfPicAt"] = int(time.time())
            return True
        self._mutate(keep, ulid=me)

    async def _run_link(self) -> None:
        attempt = 0
        try:
            await self._refresh_self_pic()
            while self._wanted():
                server = self._mp.lobby_server()
                if server is not None:
                    try:
                        await self._session(server)
                    except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError) as e:
                        self._debug("link failed (%s)", type(e).__name__)
                    finally:
                        if self._up:
                            attempt = 0
                        self._writer = None
                        self._set_up(False)
                    if self._refused:
                        return
                await asyncio.sleep(RETRY_SECONDS[min(attempt, len(RETRY_SECONDS) - 1)])
                attempt += 1
        finally:
            if self._link is asyncio.current_task():
                self._link = None

    def _set_up(self, up: bool) -> None:
        if not up:
            for future in self._waiting.values():
                if not future.done():
                    future.set_result(None)
            self._waiting = {}
            for _target, future in self._confirming:
                if not future.done():
                    future.set_result(False)
            self._confirming = []
            for waiting in self._list_waits.values():
                waiting.put_nowait({"op": "lost"})
            self._lists_off = False
            self._pings = 0
            self._pongs = 0
            self._sent_report = None
            self._report_stale = True
            self._sent_room = None
            self._sent_game = ""
            if self._up:
                self._presence = {}
                self._suggestions = []
        if up != self._up:
            self._up = up
            self._changed()

    def _report(self, data) -> dict:
        cfg = self._cfg()
        suggest = bool(cfg.get("mpSuggestFriends", True))
        friends = [friend["ulid"] for friend in data["friends"]][:LIST_MAX]
        visible = bool(cfg.get("mpShowOnline", True))
        presence = {"game": "", "room": None}
        if visible:
            presence = {"game": self._game(), "room": self._mp.current_room()}
        return {
            "visible": visible,
            "suggest": suggest,
            "friends": friends,
            "ra": self._mutual_follows()[:max(0, REPORT_ULIDS_MAX - len(friends))] if suggest else [],
            "presence": presence,
            "rank": self.rank(),
        }

    def _mutual_follows(self) -> list:
        rows = self._ra_rows()
        return [row["ulid"] for row in rows if row.get("isFollowingMe") and not row.get("isSelf")
                and is_ulid(row.get("ulid"))][:LIST_MAX]

    def _ra_rows(self) -> list:
        payload = self._ra_friends.get_cached_friends().get("payload") or {}
        rows = payload.get("friends") if isinstance(payload, dict) else None
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _follows(self) -> dict:
        return {row["ulid"]: row for row in self._ra_rows() if is_ulid(row.get("ulid"))}

    def _follow_identity(self, row: dict) -> tuple | None:
        verdict = self._resolved_avatars.get(row["ulid"])
        if verdict is None:
            return None
        name = clean_name(row.get("username"))
        if verdict["userPic"]:
            return name, clean_pic(verdict["userPic"])
        return name, clean_pic(f"/UserPic/{name}.png") if name else ""

    def _game(self) -> str:
        title = proto.clean_chat(self._mp.room_game())[:64]
        return title or self._running_name

    def running_app(self, name: str) -> None:
        name = proto.clean_chat(name)[:64]
        if name != self._running_name:
            self._running_name = name
            self.report_changed()

    async def _session(self, server) -> bool:
        data = self._store.ensure()
        name = self._my_name()
        if data is None or not name:
            return False
        reader, writer = await lobby_client.connect(server)
        try:
            writer.write(lobby_client.envelope({"op": "device", "v": proto.VERSION, "device": data["deviceId"]}))
            await asyncio.wait_for(writer.drain(), REPLY_SECONDS)
            challenge = await asyncio.wait_for(lobby_client.read_envelope(reader), REPLY_SECONDS)
            if challenge.get("op") == "update_required":
                self._refused = "update"
                decky.logger.warning("friends: the lobby server needs a newer CheevoDeck")
                self._changed()
                return False
            nonce = challenge.get("n")
            if challenge.get("op") != "challenge" or not proto.is_nonce(nonce):
                return False
            verifier = hashlib.sha256(bytes.fromhex(data["deviceSecret"])).hexdigest()
            proof = hmac.new(bytes.fromhex(verifier), ("device|" + nonce).encode("ascii"), hashlib.sha256).hexdigest()
            report = self._report(data)
            hello = {"op": "hello", "ulid": self._me(), "name": name, "pic": data["selfPic"], "proof": proof,
                     **report}
            if PLUGIN_VERSION:
                hello["ver"] = PLUGIN_VERSION
            hello["lists"] = True
            if challenge.get("known") is not True:
                hello["verifier"] = verifier
            writer.write(lobby_client.envelope(hello))
            await asyncio.wait_for(writer.drain(), REPLY_SECONDS)
            welcome = await asyncio.wait_for(lobby_client.read_envelope(reader), REPLY_SECONDS)
            if welcome.get("op") != "welcome" or welcome.get("ok") is not True:
                error = welcome.get("error")
                if error in ("denied", "blocked", "full"):
                    self._refused = error
                    decky.logger.warning("friends: the lobby server refused this device (%s)", error)
                    self._changed()
                return False
            self._sent_report = canonical(report)
            self._sent_room = report["presence"]["room"]
            self._sent_game = report["presence"]["game"]
            self._report_stale = False
            self._report_at = time.monotonic()
            self._session_account = self._me()
            self._acks = []
            self._lists_off = False
            self._writer = writer
            known = self._server_rows()
            self._set_up(True)
            decky.logger.info("friends: online")
            keeper = asyncio.ensure_future(self._keep())
            flusher = asyncio.ensure_future(self._flush_outbox())
            settler = asyncio.ensure_future(self._settle(welcome, known))
            try:
                while True:
                    message = await asyncio.wait_for(lobby_client.read_envelope_or_skip(reader), SILENT_SECONDS)
                    if message is not None:
                        self._take(message)
            finally:
                keeper.cancel()
                flusher.cancel()
                settler.cancel()
        finally:
            writer.close()
            if self._up:
                decky.logger.info("friends: offline")
        return True

    async def _keep(self) -> None:
        while True:
            await asyncio.sleep(PING_SECONDS)
            if not self._wanted():
                writer = self._writer
                if writer is not None:
                    writer.close()
                return
            await self._send({"op": "ping"})
            await self._update()

    async def _send(self, message: dict) -> bool:
        writer = self._writer
        if writer is None:
            return False
        async with self._send_lock:
            try:
                writer.write(lobby_client.envelope(message))
                if message.get("op") == "ping":
                    self._pings += 1
                await asyncio.wait_for(writer.drain(), REPLY_SECONDS)
            except (OSError, asyncio.TimeoutError, FrameError):
                return False
        return True

    async def _confirmed(self, message: dict) -> bool:
        writer = self._writer
        if writer is None:
            return False
        future = asyncio.get_running_loop().create_future()
        entry = None
        try:
            async with self._send_lock:
                if writer is not self._writer:
                    return False
                writer.write(lobby_client.envelope(message))
                if message.get("op") == "ping":
                    self._pings += 1
                writer.write(lobby_client.envelope({"op": "ping"}))
                self._pings += 1
                entry = (self._pings, future)
                self._confirming.append(entry)
                await asyncio.wait_for(writer.drain(), REPLY_SECONDS)
            return await asyncio.wait_for(future, REPLY_SECONDS) is True
        except (OSError, asyncio.TimeoutError, FrameError):
            return False
        finally:
            if entry in self._confirming:
                self._confirming.remove(entry)

    async def _update(self) -> None:
        if not self._up:
            return
        now = time.monotonic()
        if not self._report_stale and now - self._report_at < REPORT_REFRESH_SECONDS:
            return
        data = self._data()
        if data is None:
            return
        self._report_stale = False
        self._report_at = now
        report = self._report(data)
        said = canonical(report)
        if said == self._sent_report:
            return
        self._sent_report = said
        self._sent_room = report["presence"]["room"]
        self._sent_game = report["presence"]["game"]
        await self._send({"op": "update", **report})

    def room_changed(self) -> None:
        if self._held_answers is None:
            data = self._data()
            self._held_answers = {entry["ulid"] for entry in data["outbox"] if entry["op"] == "answer"} \
                if data is not None else set()
        if self._held_answers and not self._delivering \
                and any(self._mp.seat_of(ulid) is not None for ulid in self._held_answers):
            self._delivering = True
            self._spawn(self._deliver_held())
        if not self._up:
            return
        room = self._mp.current_room()
        game = self._game()
        if room != self._sent_room or game != self._sent_game:
            self._sent_room = room
            self._sent_game = game
            self._report_stale = True
            self._spawn(self._update())

    def report_changed(self) -> None:
        self._report_stale = True
        if self._up:
            self._spawn(self._update())

    async def _ask(self, message: dict, key: str):
        future = asyncio.get_running_loop().create_future()
        self._waiting[key] = future
        try:
            if not await self._send(message):
                return None
            return await asyncio.wait_for(future, REPLY_SECONDS)
        except asyncio.TimeoutError:
            return None
        finally:
            self._waiting.pop(key, None)

    def _flush_soon(self) -> None:
        if self._up:
            self._spawn(self._flush_outbox())

    async def _flush_outbox(self) -> None:
        data = self._data()
        if data is None or not data["outbox"]:
            return
        sent = []
        for entry in data["outbox"]:
            if entry["op"] == "remove":
                message = {"op": "remove", "ulid": entry["ulid"], "t": entry["t"]}
                if entry.get("at") and int(time.time()) >= entry["at"]:
                    message["age"] = int(time.time()) - entry["at"]
            elif entry["op"] == "withdraw":
                message = {"op": "withdraw", "to": entry["ulid"], "key": entry["key"]}
            else:
                continue
            if not await self._confirmed(message):
                break
            sent.append(entry)
            await asyncio.sleep(OUTBOX_GAP_SECONDS)

        def drop(stored):
            before = len(stored["outbox"])
            stored["outbox"] = [entry for entry in stored["outbox"] if entry not in sent]
            return len(stored["outbox"]) != before
        self._mutate(drop)
        if any(entry["op"] == "remove" for entry in sent) and self._up and not self._lists_off:
            self._spawn(self._sync_friends())

    def _take(self, message: dict) -> None:
        op = message.get("op")
        if op == "pong":
            self._pongs += 1
            for target, future in self._confirming:
                if target <= self._pongs and not future.done():
                    future.set_result(True)
            return
        if op in ("request_ok", "request_no", "answer_ok", "answer_no", "msg_ok", "msg_no", "invite_ok", "invite_no"):
            key = message.get("rid") or message.get("mid") or message.get("iid")
            future = self._waiting.get(f"{op.split('_')[0]}:{key}") if isinstance(key, str) else None
            if future is not None and not future.done():
                future.set_result(message)
            return
        if op in ("friends_same", "friends_page", "friends_up_ok", "friends_off"):
            rid = message.get("rid")
            waiting = self._list_waits.get(rid) if isinstance(rid, str) else None
            if waiting is not None:
                waiting.put_nowait(message)
            return
        if op in ("friend_synced", "friend_unsynced") and self._me() != self._session_account:
            return
        if op == "friend_synced":
            raw = message.get("rows")
            rows = [_list_row(row) for row in raw[:SYNC_ROWS]] if isinstance(raw, list) else []
            rows = [row for row in rows if row is not None]
            if not self._list_event("rows", rows):
                self._merge_list(rows)
            return
        if op == "friend_unsynced":
            self._list_event("removed", [message])
            self._drop_removed([message])
            return
        if op == "presence":
            self._take_presence(message)
        elif op == "suggest":
            self._take_suggestions(message.get("list"))
        elif op == "mail":
            self._take_mail(message)
        elif op == "invite":
            self._take_invite(message.get("from"), message.get("body"), message.get("t"))
        elif op == "notice":
            self._take_notice(message)

    def hold_notices(self) -> None:
        self._holding_notices = True

    def release_held_notice(self) -> None:
        self._holding_notices = False
        held, self._held_notice = self._held_notice, None
        if held is not None:
            self._take_notice(held)

    def _take_notice(self, message: dict) -> None:
        notice_id, text = message.get("id"), message.get("text")
        if (self._notice_store is None or not isinstance(notice_id, str) or NOTICE_ID.fullmatch(notice_id) is None
                or not isinstance(text, str) or not 0 < len(text) <= NOTICE_CHARS):
            self._debug("ignored a malformed notice")
            return
        try:
            if notice_id == self._notice_store.load_notice()["noticeId"]:
                return
            cfg = self._cfg()
            if self._holding_notices or not self._settings_store.get_viewed_intro(cfg):
                self._held_notice = message
                self._debug("notice %s held until the welcome", notice_id)
                return
            self._notice_store.record_notice(notice_id, int(time.time()))
            if notice_id == self._notice_store.load()["messageId"]:
                self._debug("notice %s already came as the broadcast", notice_id)
                return
        except Exception as e:
            decky.logger.warning("friends: couldn't read or save the notice record (%s)", type(e).__name__)
            return
        decky.logger.info("friends: notice %s from the lobby server, notifying", notice_id)
        if self._notifications is not None and is_type_enabled("system", self._settings_store, cfg):
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "actionable",
                    "iconSource": "none",
                    "title": "Message from FAILINATOR5000",
                    "body": text,
                    "source": "notifications",
                    "target": {"view": "message"},
                    "meta": {"messageId": notice_id, "via": "server"},
                })
            except Exception as e:
                decky.logger.warning("friends: the notice could not be filed (%s)", type(e).__name__)
        emit_notification(
            ntype="system",
            title_key="Message from FAILINATOR5000",
            line_key="View in Notifications",
            settings_store=self._settings_store,
            event_loop=self._loop,
        )

    def _take_presence(self, message: dict) -> None:
        ulid = message.get("ulid")
        data = self._data()
        friend = self._find(data, ulid) if is_ulid(ulid) and data is not None else None
        if friend is None:
            return
        room = message.get("room")
        if not (isinstance(room, dict) and proto.is_room_id(room.get("id")) and room.get("where") in proto.WHERES):
            room = None
        else:
            room = {"id": room["id"], "name": proto.clean_room_name(room.get("name")) or "Room",
                    "where": room["where"], "playing": room.get("playing") is True}
        seen = message.get("seen")
        self._presence[ulid] = {
            "online": message.get("online") is True,
            "game": proto.clean_chat(message.get("game"))[:64],
            "room": room,
            "seen": seen if type(seen) is int and seen > 0 else 0,
            "rank": proto.clean_rank(message.get("rank")),
        }
        claimed = clean_name(message.get("name"))
        pic = clean_pic(message.get("pic"))
        settled = ulid in self._follows() and self._resolved_avatars.get(ulid) is not None
        if not settled and ((claimed and claimed != friend["name"]) or (pic and pic != friend["userPic"])):
            self._heal.presence_differs(ulid)
        self._changed()

    def _take_suggestions(self, raw) -> None:
        rows = []
        for entry in raw if isinstance(raw, list) else []:
            if isinstance(entry, dict) and is_ulid(entry.get("ulid")) and clean_name(entry.get("name")):
                rows.append({"ulid": entry["ulid"], "name": clean_name(entry["name"]),
                             "pic": clean_pic(entry.get("pic"))})
        self._suggestions = rows[:50]
        self._changed()

    def _take_mail(self, message: dict) -> None:
        mid = message.get("mid")
        if type(mid) is not int or self._me() != self._session_account:
            return
        try:
            self._mail(message)
        except Exception as e:
            decky.logger.warning("friends: a delivery failed (%s)", type(e).__name__)
        self._acks.append(mid)
        if len(self._acks) == 1:
            self._spawn(self._send_acks())

    async def _send_acks(self) -> None:
        await asyncio.sleep(ACK_GATHER_SECONDS)
        mids, self._acks = self._acks[:ACK_MAX], self._acks[ACK_MAX:]
        await self._send({"op": "ack", "mids": mids})
        if self._acks:
            self._spawn(self._send_acks())

    def _mail(self, message: dict) -> None:
        kind = message.get("kind")
        ulid = message.get("ulid")
        name = clean_name(message.get("name"))
        pic = clean_pic(message.get("pic"))
        key = message.get("key")
        me = self._me()
        if kind == "request":
            at = message.get("at")
            if type(at) is not int or not 0 < at <= time.time() + CLOCK_SKEW_SECONDS:
                at = int(time.time())
            if is_ulid(ulid) and ulid != me and name and proto.is_key(key):
                self._incoming(ulid, name, pic, key, "server", at)
        elif kind == "accepted":
            if is_ulid(ulid) and name:
                self._accepted(ulid, name, pic, "server", key if proto.is_key(key) else None)
        elif kind == "friend_added":
            data = self._data()
            waiting = self._request_row(data, ulid, "in") if data is not None and is_ulid(ulid) else None
            if waiting is not None and waiting["pairKey"] == key:
                self._befriend(ulid, waiting["name"], waiting["userPic"], waiting["pairKey"], "server")
        elif kind == "request_gone":
            if is_ulid(ulid):
                self._drop_request(ulid, "in", key if proto.is_key(key) else None)
                if proto.is_key(key):
                    self._unhold(ulid, key)
        elif kind == "request_closed":
            if is_ulid(ulid) and proto.is_key(key):
                self._drop_request(ulid, "out", key)
        elif kind == "removed":
            data = self._data()
            friend = self._find(data, ulid) if data is not None and is_ulid(ulid) else None
            if friend is not None and _signed(friend["pairKey"], "remove", {"to": me}, message.get("t")):
                self._unfriend(ulid)
            if is_ulid(ulid):
                self._list_event("removed", [{"u": ulid, "t": message.get("t")}])
        elif kind == "msg":
            self._take_message(message.get("from"), message.get("body"), message.get("t"))

    def pair_key(self, ulid: str):
        if not self._on():
            return None
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        return bytes.fromhex(friend["pairKey"]) if friend is not None else None

    def _find(self, data, ulid: str):
        return next((friend for friend in data["friends"] if friend["ulid"] == ulid), None)

    def _request_row(self, data, ulid: str, way: str):
        return next((request for request in data["requests"] if request["ulid"] == ulid and request["way"] == way),
                    None)

    def _held(self, data, ulid: str):
        return next((entry for entry in data["outbox"] if entry["op"] == "answer" and entry["ulid"] == ulid), None)

    def _incoming(self, ulid: str, name: str, pic: str, key: str, via: str, at=None) -> bool:
        seen = {}

        def keep(stored):
            held = self._held(stored, ulid)
            if held is not None and held["key"] == key:
                if via == "server":
                    seen["answer"] = held["accept"]
                return False
            friend = self._find(stored, ulid)
            if friend is not None and friend["pairKey"] == key:
                if via == "server":
                    seen["answer"] = True
                return False
            own = self._request_row(stored, ulid, "out")
            if via == "local" and own is not None and (own["via"] == "server" or self._me() < ulid):
                seen["yielded"] = True
                return False
            mine = self._request_row(stored, ulid, "in")
            if mine is not None and mine["pairKey"] == key:
                if via == "server" and mine["via"] == "local":
                    mine["via"] = "server"
                    return True
                return False
            if mine is None and sum(1 for row in stored["requests"] if row["way"] == "in") >= INCOMING_REQUESTS_MAX:
                return False
            if held is not None:
                stored["outbox"].remove(held)
            if mine is not None:
                stored["requests"].remove(mine)
            stored["requests"].append({"ulid": ulid, "name": name, "userPic": pic, "at": at or int(time.time()),
                                       "way": "in", "pairKey": key, "via": via, "fromSeat": False})
            seen["new"] = True
            return True
        self._mutate(keep)
        if "answer" in seen:
            self._spawn(self._send_held(ulid, key, seen["answer"]))
        if "yielded" in seen:
            return True
        if "new" not in seen:
            return False
        self._notify("request", name, f"multiplayer:request:{ulid}", {"friend": ulid}, pic=pic)
        self._follow()
        return True

    def _accepted(self, ulid: str, name: str, pic: str, via: str, key=None) -> bool:
        made = {}

        def keep(stored):
            mine = self._request_row(stored, ulid, "out")
            if mine is not None and key is not None and mine["pairKey"] != key:
                return False
            if mine is None:
                waiting = {"op": "withdraw", "ulid": ulid, "key": key}
                friend = self._find(stored, ulid)
                if via != "server" or key is None or waiting not in stored["outbox"]:
                    return False
                stored["outbox"].remove(waiting)
                made["rekeyed"] = True
                if friend is None:
                    stored["outbox"].append({"op": "remove", "ulid": ulid, "t": _sign(key, "remove", {"to": ulid})})
                    return True
                friend["pairKey"] = key
                friend["via"] = via
                return True
            self._drop_rows(stored, ulid, mine["pairKey"] if via == "server" else None)
            if via == "server" and not mine["fromSeat"]:
                stored["friends"].append({"ulid": ulid, "name": mine["name"], "pairKey": mine["pairKey"],
                                          "userPic": mine["userPic"] or pic, "added": int(time.time()),
                                          "via": via, "healedAt": int(time.time()), "healTriedAt": 0})
            else:
                stored["friends"].append({"ulid": ulid, "name": name, "pairKey": mine["pairKey"],
                                          "userPic": pic or mine["userPic"], "added": int(time.time()),
                                          "via": via, "healedAt": 0, "healTriedAt": 0})
            made.update(stored["friends"][-1])
            return True
        if self._mutate(keep):
            if made.get("rekeyed"):
                self._flush_soon()
                return True
            self._flush_soon()
            if via == "local":
                self._upload_soon(ulid)
            self._heal.friend_added()
            self._notify("accepted", made["name"], f"multiplayer:friend:{ulid}", {"friend": ulid}, pic=made["userPic"])
            self._follow()
            self.report_changed()
            if self._milestone_event is not None:
                self._milestone_event("pt_friend_accepted")
            return True
        return False

    def _drop_rows(self, stored: dict, ulid: str, settled=None) -> None:
        stored["outbox"] = [entry for entry in stored["outbox"] if entry["op"] != "answer" or entry["ulid"] != ulid]
        for row in [row for row in stored["requests"] if row["ulid"] == ulid]:
            stored["requests"].remove(row)
            if row["way"] == "out" and row["via"] == "server" and row["pairKey"] != settled:
                stored["outbox"].append({"op": "withdraw", "ulid": ulid, "key": row["pairKey"]})

    def _befriend(self, ulid: str, name: str, pic: str, key: str, via: str) -> None:
        def keep(stored):
            self._drop_rows(stored, ulid)
            friend = self._find(stored, ulid)
            if friend is not None:
                friend["pairKey"] = key
                friend["via"] = via
                return True
            stored["friends"].append({"ulid": ulid, "name": name, "pairKey": key,
                                      "userPic": pic, "added": int(time.time()), "via": via,
                                      "healedAt": 0, "healTriedAt": 0})
            return True
        if self._mutate(keep):
            self._flush_soon()
            if via == "local":
                self._upload_soon(ulid)
            self._heal.friend_added()
            self._follow()
            self.report_changed()

    def _drop_request(self, ulid: str, way: str, key=None) -> None:
        def drop(stored):
            mine = self._request_row(stored, ulid, way)
            if mine is None or (key is not None and mine["pairKey"] != key):
                return False
            stored["requests"].remove(mine)
            return True
        self._mutate(drop)

    def _unfriend(self, ulid: str) -> bool:
        account = self._me()

        def drop(stored):
            friend = self._find(stored, ulid)
            if friend is None:
                return False
            stored["friends"].remove(friend)
            for marks in (stored["lastRead"], stored["unread"], stored["newestAt"]):
                marks.pop(ulid, None)
            return True
        if self._mutate(drop, ulid=account):
            self._messages.delete(ulid, ulid=account)
            self._presence.pop(ulid, None)
            self.report_changed()
            self._follow()
            return True
        return False

    def _claim_ok(self, ulid: str, name: str) -> bool:
        row = next((row for row in self._ra_rows() if row.get("ulid") == ulid), None)
        return row is None or str(row.get("username") or "").lower() == name.lower()

    def local_request(self, ulid: str, name: str, pic: str, key: bytes) -> bool:
        name = clean_name(name)
        if not self._on() or not is_ulid(ulid) or ulid == self._me() or not name or not self._claim_ok(ulid, name):
            return False
        data = self._data()
        if data is not None and self._find(data, ulid) is not None:
            return False
        return self._incoming(ulid, name, clean_pic(pic), key.hex(), "local")

    def local_answer(self, ulid: str, accepted: bool, name: str, pic: str, key=None) -> bool:
        name = clean_name(name)
        if not self._on() or not is_ulid(ulid) or not name or not self._claim_ok(ulid, name):
            return False
        key = key.hex() if key is not None else None
        if accepted:
            if self._accepted(ulid, name, clean_pic(pic), "local", key):
                return True
            data = self._data()
            friend = self._find(data, ulid) if data is not None else None
            return friend is not None and (key is None or friend["pairKey"] == key)

        def drop(stored):
            mine = self._request_row(stored, ulid, "out")
            if mine is None or (key is not None and mine["pairKey"] != key):
                return False
            stored["requests"].remove(mine)
            if mine["via"] == "server":
                stored["outbox"].append({"op": "withdraw", "ulid": ulid, "key": mine["pairKey"]})
            return True
        self._mutate(drop)
        self._flush_soon()
        return True

    def _notify(self, kind: str, name: str, land: str, meta: dict, text: str = "", pic: str = "") -> None:
        if self._notifications is not None and is_type_enabled("system", self._settings_store):
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "actionable",
                    "iconSource": "none",
                    "title": name,
                    "body": text,
                    "source": "notifications",
                    "target": {"view": "multiplayer", "tab": "friends", "land": land},
                    "meta": {"multiplayer": "friend", "card": kind, "name": name, "pic": pic, **meta},
                })
            except Exception as e:
                decky.logger.warning("friends: the notification could not be filed (%s)", type(e).__name__)
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            title_key=TOASTS[kind][0],
            line_key=TOASTS[kind][1],
            template_vars={"name": name},
            dnd_exempt=True,
        )

    def state(self) -> dict:
        cfg = self._cfg()
        data = self._data() if self._me() else None
        follows = self._follows()
        if data is not None:
            data = self._heal_follows(data, follows)
        friends = []
        requests = []
        if data is not None:
            for friend in data["friends"]:
                seen = self._seen(friend["ulid"])
                friends.append({
                    "ulid": friend["ulid"],
                    "name": friend["name"],
                    "pic": friend["userPic"],
                    "raFriend": friend["ulid"] in follows,
                    "online": bool(seen.get("online")),
                    "game": seen.get("game", ""),
                    "room": seen.get("room"),
                    "rank": seen.get("rank"),
                    "seen": seen.get("seen", 0),
                    "unread": data["unread"].get(friend["ulid"], 0),
                    "newest": data["newestAt"].get(friend["ulid"], 0),
                    "added": friend["added"],
                })
            friends.sort(key=lambda row: (not row["online"], row["name"].lower()))
            asking = {request["ulid"] for request in data["requests"] if request["way"] == "in"}
            requests = [{"ulid": request["ulid"], "name": request["name"], "pic": request["userPic"],
                         "way": request["way"], "at": request["at"], "accepted": request["accepted"]}
                        for request in data["requests"]
                        if request["way"] == "in" or request["ulid"] not in asking]
        known = {row["ulid"] for row in friends} | {row["ulid"] for row in requests}
        if data is not None:
            known |= set(data["dismissed"])
        return {
            "ok": True,
            "on": self._on(cfg),
            "standby": self._standby(cfg),
            "shown": bool(cfg.get("mpShowOnline", True)),
            "me": self._me(),
            "selfPic": data["selfPic"] if data is not None else "",
            "server": self._mp.lobby_server() is not None,
            "up": self._up,
            "refused": self._refused,
            "friends": friends,
            "requests": requests,
            "suggestions": [row for row in self._suggestions if row["ulid"] not in known]
            if cfg.get("mpSuggestFriends", True) else [],
        }

    def _heal_follows(self, data: dict, follows: dict) -> dict:
        changed = {}
        for friend in data["friends"]:
            row = follows.get(friend["ulid"])
            identity = self._follow_identity(row) if row is not None else None
            if identity is None:
                continue
            name, pic = identity
            pic = pic or friend["userPic"]
            if name and (name, pic) != (friend["name"], friend["userPic"]):
                changed[friend["ulid"]] = (name, pic)
        if not changed:
            return data

        def keep(stored):
            for friend in stored["friends"]:
                if friend["ulid"] in changed:
                    friend["name"], friend["userPic"] = changed[friend["ulid"]]
                    friend["healedAt"] = 0
            return True
        try:
            healed, _result = self._store.mutate(keep, ulid=self._me())
        except Exception as e:
            decky.logger.warning("friends: couldn't save (%s)", type(e).__name__)
            return data
        return healed if healed is not None else data

    async def _until_up(self) -> bool:
        self._follow()
        for _tick in range(int(REPLY_SECONDS * 10)):
            if self._up or self._refused:
                break
            await asyncio.sleep(0.1)
        return self._up

    async def add_profile(self, name: str, profile) -> dict:
        account = self._me()
        if not self._on() or not self._me():
            return {"ok": False, "error": "friends_off"}
        if not isinstance(profile, dict) or not is_ulid(profile.get("ULID")):
            return {"ok": False, "error": "no_user"}
        ulid = profile["ULID"]
        cased = clean_name(profile.get("User")) or clean_name(name)
        pic = clean_pic(profile.get("UserPic"))
        if ulid == self._me():
            return {"ok": False, "error": "self"}
        data = self._store.ensure()
        if data is None:
            return {"ok": False, "error": "unavailable"}
        if self._find(data, ulid) is not None:
            return {"ok": False, "error": "already"}
        if self._request_row(data, ulid, "in") is not None:
            answered = await self.answer(ulid, True)
            return {**answered, "ulid": ulid, "friend": not answered.get("waiting")} if answered["ok"] else answered
        if self._request_row(data, ulid, "out") is not None:
            return {"ok": False, "error": "pending"}
        if not await self._until_up():
            return self._unreachable()
        key = secrets.token_hex(32)
        asked = await self._ask_server(data, ulid, key)
        if not asked["ok"]:
            return asked

        def keep(stored):
            stored["requests"].append({"ulid": ulid, "name": cased, "userPic": pic, "at": int(time.time()),
                                       "way": "out", "pairKey": key, "via": "server", "fromSeat": False})
            return True
        self._mutate(keep, ulid=account)
        self._follow()
        return {"ok": True, "name": cased, "ulid": ulid}

    async def add_seat(self, seat: int, ulid: str) -> dict:
        account = self._me()
        if not self._on() or not self._me():
            return {"ok": False, "error": "friends_off"}
        person = self._mp.seat_identity(seat)
        if person is None or person["ulid"] != ulid:
            return {"ok": False, "error": "seat_changed"}
        if ulid == self._me():
            return {"ok": False, "error": "self"}
        data = self._store.ensure()
        if data is None:
            return {"ok": False, "error": "unavailable"}
        if self._find(data, ulid) is not None:
            return {"ok": False, "error": "already"}
        if self._request_row(data, ulid, "in") is not None:
            return await self.answer(ulid, True)
        if self._request_row(data, ulid, "out") is not None:
            return {"ok": False, "error": "pending"}
        key = secrets.token_bytes(32)
        if self._mp.lobby_server() is not None and await self._until_up():
            via = "server"
            asked = await self._ask_server(data, ulid, key.hex())
            if not asked["ok"]:
                return asked
            self._yield_crossed(ulid)
        else:
            via = "local"
            if not await self._mp.send_friend(seat, "ask", key):
                return {"ok": False, "error": "unavailable"}

        def keep(stored):
            stored["requests"].append({"ulid": ulid, "name": person["name"], "userPic": person["pic"],
                                       "at": int(time.time()), "way": "out", "pairKey": key.hex(), "via": via,
                                       "fromSeat": True})
            return True
        self._mutate(keep, ulid=account)
        self._follow()
        return {"ok": True}

    async def answer(self, ulid: str, accept: bool) -> dict:
        data = self._data()
        if data is None or not is_ulid(ulid):
            return {"ok": False, "error": "no_request"}
        request = self._request_row(data, ulid, "in") or self._request_row(data, ulid, "out")
        if request is None:
            return {"ok": False, "error": "no_request"}
        if request["way"] == "out":
            if accept:
                return {"ok": False, "error": "no_request"}
            if request["via"] == "server" and not (await self._until_up() and await self._confirmed(
                    {"op": "withdraw", "to": ulid, "key": request["pairKey"]})):
                return self._unreachable()
            self._drop_request(ulid, "out")
            return {"ok": True}
        if request["via"] == "server":
            if not await self._until_up():
                return self._unreachable()
            settled = await self._answer_server(ulid, accept, request["pairKey"])
            if settled is None:
                return self._unreachable()
            if not settled:
                self._drop_request(ulid, "in")
                return {"ok": False, "error": "no_request"}
        else:
            sent = await self._answer_local(ulid, accept, request["pairKey"])
            if sent == "refused":
                self._unhold(ulid, request["pairKey"])
                self._drop_request(ulid, "in", request["pairKey"])
                return {"ok": False, "error": "no_request"}
            if sent != "done":
                self._hold(request, accept)
                if sent == "pushed":
                    self._await_got(ulid, request["pairKey"])
                if accept:
                    return {"ok": True, "waiting": True}
                self._drop_request(ulid, "in")
                return {"ok": True}
        self._unhold(ulid, request["pairKey"])
        if accept:
            self._befriend(ulid, request["name"], request["userPic"], request["pairKey"], request["via"])
        else:
            self._drop_request(ulid, "in")
        return {"ok": True}

    async def _answer_local(self, ulid: str, accept: bool, key: str) -> str:
        seat = self._mp.seat_of(ulid)
        if seat is not None:
            sent = await self._mp.send_friend(seat, "accept" if accept else "decline", bytes.fromhex(key))
            if self._mp.friend_confirms(seat):
                if sent is True:
                    return "done"
                if sent is False:
                    return "refused"
            elif sent:
                return "pushed"
        if self._up and await self._answer_server(ulid, accept, key) is True:
            return "done"
        return ""

    def _await_got(self, ulid: str, key: str) -> None:
        data = self._data()
        crossing = data is not None and self._request_row(data, ulid, "out") is not None
        now = time.monotonic()
        self._pushed_at = {pushed: at for pushed, at in self._pushed_at.items() if now - at < RESEND_SECONDS}
        self._pushed[ulid] = (key, crossing)
        self._pushed_at[(ulid, key)] = now
        self._spawn(self._got_timeout(ulid, key))

    async def _got_timeout(self, ulid: str, key: str) -> None:
        deadline = time.monotonic() + GOT_SECONDS
        taken_at = None
        while time.monotonic() < deadline:
            await asyncio.sleep(min(1.0, GOT_SECONDS))
            if self._pushed.get(ulid, (None,))[0] != key:
                return
            if taken_at is None and self._mp.friend_taken(ulid):
                taken_at = time.monotonic()
            if taken_at is not None and time.monotonic() - taken_at >= GOT_AFTER_TAKEN_SECONDS:
                break
        pushed = self._pushed.get(ulid)
        if pushed is None or pushed[0] != key or pushed[1]:
            return
        data = self._data()
        entry = self._held(data, ulid) if data is not None else None
        if entry is None or entry["key"] != key:
            return
        taken = self._mp.friend_taken(ulid)
        if taken is False or (taken is None and self._mp.seat_of(ulid) is None):
            return
        if entry["accept"]:
            self._assumed[ulid] = key
        self._delivered(entry, "local")

    def local_got(self, ulid: str, ok: bool) -> bool:
        pushed = self._pushed.pop(ulid, None)
        if pushed is None:
            return False
        key = pushed[0]
        data = self._data()
        entry = self._held(data, ulid) if data is not None else None
        if entry is not None and entry["key"] == key:
            if ok:
                self._delivered(entry, "local")
            else:
                self._unhold(ulid, key)
                if entry["accept"]:
                    self._drop_request(ulid, "in", key)
            return True
        if self._assumed.pop(ulid, None) == key and not ok:
            friend = self._find(data, ulid) if data is not None else None
            if friend is not None and friend["pairKey"] == key:
                self._drop_friend(ulid)
        return True

    def _yield_crossed(self, ulid: str) -> None:
        def drop(stored):
            mine = self._request_row(stored, ulid, "in")
            if mine is None or mine["via"] != "local":
                return False
            stored["requests"].remove(mine)
            return True
        self._mutate(drop)

    def _unreachable(self) -> dict:
        return {"ok": False, "error": "update_required" if self._refused == "update" else "offline"}

    async def _answer_server(self, ulid: str, accept: bool, key: str):
        rid = secrets.token_hex(8)
        reply = await self._ask({"op": "answer", "rid": rid, "to": ulid, "accept": bool(accept), "key": key},
                                "answer:" + rid)
        if reply is None:
            return None
        return reply.get("op") == "answer_ok"

    async def _ask_server(self, data: dict, ulid: str, key: str, at=None) -> dict:
        for entry in [entry for entry in data["outbox"] if entry["op"] == "withdraw" and entry["ulid"] == ulid]:
            if not await self._confirmed({"op": "withdraw", "to": ulid, "key": entry["key"]}):
                return {"ok": False, "error": "offline"}

            def sent(stored, entry=entry):
                if entry not in stored["outbox"]:
                    return False
                stored["outbox"].remove(entry)
                return True
            self._mutate(sent)
        rid = secrets.token_hex(8)
        asked = {"op": "request", "rid": rid, "to": ulid, "name": self._my_name(), "pic": data["selfPic"], "key": key}
        if at is not None:
            asked["at"] = at
        reply = await self._ask(asked, "request:" + rid)
        if reply is None:
            return {"ok": False, "error": "offline"}
        if reply.get("op") != "request_ok":
            error = reply.get("error")
            return {"ok": False, "error": error if error in ("pending", "limit", "self") else "unavailable"}
        return {"ok": True}

    def _hold(self, request: dict, accept: bool) -> None:
        ulid = request["ulid"]

        def keep(stored):
            stored["outbox"] = [entry for entry in stored["outbox"]
                                if entry["op"] != "answer" or entry["ulid"] != ulid]
            stored["outbox"].append({"op": "answer", "ulid": ulid, "key": request["pairKey"], "accept": accept,
                                     "at": request["at"], "name": request["name"], "pic": request["userPic"]})
            mine = self._request_row(stored, ulid, "in")
            if mine is not None and mine["pairKey"] == request["pairKey"]:
                mine["accepted"] = accept
            return True
        self._mutate(keep)

    def _unhold(self, ulid: str, key: str) -> None:
        def drop(stored):
            held = self._held(stored, ulid)
            if held is None or held["key"] != key:
                return False
            stored["outbox"].remove(held)
            return True
        self._mutate(drop)

    def _delivered(self, entry: dict, via: str) -> None:
        self._unhold(entry["ulid"], entry["key"])
        if entry["accept"]:
            self._befriend(entry["ulid"], entry["name"], entry["pic"], entry["key"], via)

    async def _send_held(self, ulid: str, key: str, accept: bool) -> None:
        data = self._data()
        entry = self._held(data, ulid) if data is not None else None
        if not await self._answer_server(ulid, accept, key):
            return
        if entry is not None and entry["key"] == key:
            self._delivered(entry, "server")

    async def _deliver_held(self) -> None:
        try:
            data = self._data()
            for entry in list(data["outbox"]) if data is not None else []:
                if entry["op"] != "answer":
                    continue
                seat = self._mp.seat_of(entry["ulid"])
                pushed_at = self._pushed_at.get((entry["ulid"], entry["key"]))
                if seat is None or (pushed_at is not None and time.monotonic() - pushed_at < RESEND_SECONDS):
                    continue
                sent = await self._mp.send_friend(seat, "accept" if entry["accept"] else "decline",
                                                  bytes.fromhex(entry["key"]))
                if self._mp.friend_confirms(seat):
                    if sent is True:
                        self._delivered(entry, "local")
                    elif sent is False:
                        self._unhold(entry["ulid"], entry["key"])
                        if entry["accept"]:
                            self._drop_request(entry["ulid"], "in", entry["key"])
                elif sent:
                    self._await_got(entry["ulid"], entry["key"])
        finally:
            self._delivering = False

    def _server_rows(self) -> set:
        data = self._data()
        if data is None:
            return set()
        return {(row["ulid"], row["way"], row["pairKey"]) for row in data["requests"] if row["via"] == "server"}

    def _reconcile(self, lists: dict, known: set) -> None:
        def drop(stored):
            before = len(stored["requests"])
            stored["requests"] = [row for row in stored["requests"]
                                  if (row["ulid"], row["way"], row["pairKey"]) not in known
                                  or row["way"] not in lists or row["ulid"] in lists[row["way"]]]
            return len(stored["requests"]) != before
        self._mutate(drop)

    def _check_friends(self, welcome: dict) -> None:
        data = self._data()
        if data is None:
            return
        unrequited = welcome.get("unrequited")
        for row in unrequited if isinstance(unrequited, list) else []:
            if not isinstance(row, dict) or not is_ulid(row.get("u")) or type(row.get("at")) is not int:
                continue
            friend = self._find(data, row["u"])
            if friend is not None and row["at"] > friend["added"] + CLOCK_SKEW_SECONDS:
                decky.logger.info("friends: a friendship the other side doesn't have was dropped")
                self._drop_friend(row["u"])
        listed_by = welcome.get("listedBy")
        for ulid in listed_by if isinstance(listed_by, list) else []:
            entry = self._held(data, ulid) if is_ulid(ulid) else None
            if entry is not None and entry["accept"]:
                self._delivered(entry, "local")

    async def _settle(self, welcome: dict, known: set) -> None:
        if await self._settle_requests(welcome, known):
            await self._sync_friends()

    async def _settle_requests(self, welcome: dict, known: set) -> bool:
        lists = {}
        for way in ("out", "in"):
            listed = welcome.get(way)
            if isinstance(listed, list):
                lists[way] = {ulid for ulid in listed if is_ulid(ulid)}
        if not await self._confirmed({"op": "ping"}):
            return False
        if lists:
            self._reconcile(lists, known)
        self._check_friends(welcome)
        data = self._data()
        if data is None:
            return False
        for row in [row for row in data["requests"] if row["way"] == "out" and row["via"] == "local"]:
            asked = await self._ask_server(data, row["ulid"], row["pairKey"], row["at"])
            if asked.get("error") in ("offline", "limit"):
                return asked["error"] == "limit"
            if asked["ok"] or (asked.get("error") == "pending" and row["ulid"] in lists.get("out", ())):
                def moved(stored, ulid=row["ulid"], key=row["pairKey"]):
                    mine = self._request_row(stored, ulid, "out")
                    if mine is None or mine["pairKey"] != key:
                        return False
                    mine["via"] = "server"
                    mine["fromSeat"] = True
                    return True
                self._mutate(moved)
            await asyncio.sleep(OUTBOX_GAP_SECONDS)
        for entry in [entry for entry in data["outbox"] if entry["op"] == "answer"]:
            settled = await self._answer_server(entry["ulid"], entry["accept"], entry["key"])
            if settled is None:
                return False
            if settled:
                self._delivered(entry, "server")
            await asyncio.sleep(OUTBOX_GAP_SECONDS)
        return True

    async def _sync_friends(self) -> None:
        if self._syncing:
            self._resync = True
            return
        self._syncing = True
        try:
            await self._sync_once()
        finally:
            self._syncing = False

    async def _sync_once(self) -> None:
        data = self._data()
        if data is None or self._lists_off or self._me() != self._session_account:
            return
        self._resync = False
        self._list_events = []
        try:
            replies = await self._list_call({"op": "friends_sync", "rid": secrets.token_hex(8),
                                             "digest": friends_digest(data["friends"])})
            if replies is None:
                self._lists_off = True
                return
            if replies[-1].get("op") != "friends_page":
                self._lists_off = replies[-1].get("op") == "friends_off"
                return
            listed = {}
            for reply in replies:
                for raw in reply.get("rows") if isinstance(reply.get("rows"), list) else []:
                    row = _list_row(raw)
                    if row is not None:
                        listed[row["u"]] = row
            ended = {(entry.get("u"), entry.get("t")) for kind, rows in self._list_events if kind == "removed"
                     for entry in rows if isinstance(entry, dict)}
            self._merge_list([row for row in listed.values()
                              if (row["u"], _sign(row["key"], "remove", {"to": row["u"]})) not in ended
                              and (row["u"], _sign(row["key"], "remove", {"to": self._me()})) not in ended])
        finally:
            events, self._list_events = self._list_events, None
            for kind, rows in events or ():
                if kind == "rows":
                    self._merge_list(rows)
                else:
                    self._drop_removed(rows)
        data = self._data()
        if data is not None and self._me() == self._session_account:
            await self._upload([friend["ulid"] for friend in data["friends"]
                                if listed.get(friend["ulid"], {}).get("key") != friend["pairKey"]])
        if self._resync:
            await self._sync_once()

    def _list_event(self, kind: str, rows: list) -> bool:
        if self._list_events is None:
            return False
        self._list_events.append((kind, rows))
        return True

    async def _list_call(self, message: dict):
        rid = message["rid"]
        waiting = asyncio.Queue()
        self._list_waits[rid] = waiting
        replies = []
        try:
            if not await self._send(message):
                return None
            while len(replies) < SYNC_PAGES_MAX:
                reply = await asyncio.wait_for(waiting.get(), REPLY_SECONDS)
                if reply.get("op") == "lost":
                    return None
                replies.append(reply)
                if reply.get("op") != "friends_page" or reply.get("more") is not True:
                    return replies
            return None
        except asyncio.TimeoutError:
            return None
        finally:
            self._list_waits.pop(rid, None)

    async def _upload(self, ulids) -> None:
        data = self._data()
        if data is None or self._lists_off:
            return
        friends = [friend for friend in data["friends"] if friend["ulid"] in set(ulids)]
        for start in range(0, len(friends), SYNC_ROWS):
            if self._me() != self._session_account:
                return
            rows = [{"u": friend["ulid"], "key": friend["pairKey"], "name": friend["name"], "pic": friend["userPic"],
                     "added": friend["added"]} for friend in friends[start:start + SYNC_ROWS]]
            replies = await self._list_call({"op": "friends_up", "rid": secrets.token_hex(8), "rows": rows})
            if replies is None or replies[-1].get("op") != "friends_up_ok":
                return
            self._drop_removed(replies[-1].get("removed"))
            await asyncio.sleep(OUTBOX_GAP_SECONDS)

    def _upload_soon(self, ulid: str) -> None:
        if self._up and not self._lists_off:
            self._spawn(self._upload([ulid]))

    def _merge_list(self, rows) -> None:
        if not rows:
            return
        me = self._me()
        added = []

        def keep(stored):
            changed = False
            removing = {entry["ulid"] for entry in stored["outbox"] if entry["op"] == "remove"}
            for row in rows:
                ulid, key = row["u"], row["key"]
                if ulid == me or ulid in removing:
                    continue
                friend = self._find(stored, ulid)
                if friend is not None:
                    if friend["pairKey"] != key and row["f"]:
                        friend["pairKey"] = key
                        changed = True
                    continue
                if any(request["ulid"] == ulid and request["pairKey"] != key for request in stored["requests"]) \
                        or any(entry["op"] == "answer" and entry["ulid"] == ulid and entry["key"] != key
                               for entry in stored["outbox"]) \
                        or len(stored["friends"]) >= MAX_FRIENDS:
                    continue
                self._drop_rows(stored, ulid, key)
                stored["friends"].append({"ulid": ulid, "name": row["name"], "pairKey": key, "userPic": row["pic"],
                                          "added": row["added"] or int(time.time()), "via": "server",
                                          "healedAt": 0, "healTriedAt": 0})
                added.append(ulid)
                changed = True
            return changed
        if self._mutate(keep, ulid=self._session_account):
            if added:
                decky.logger.info("friends: %d friends came from the account list", len(added))
                self._heal.friend_added()
            self._follow()
            self.report_changed()

    def _drop_removed(self, removed) -> None:
        me = self._me()
        if me != self._session_account:
            return
        for entry in removed if isinstance(removed, list) else []:
            if not isinstance(entry, dict) or not is_ulid(entry.get("u")):
                continue
            ulid, tag = entry["u"], entry.get("t")
            data = self._data()
            friend = self._find(data, ulid) if data is not None else None
            if friend is not None and (_signed(friend["pairKey"], "remove", {"to": ulid}, tag)
                                       or _signed(friend["pairKey"], "remove", {"to": me}, tag)):
                self._unfriend(ulid)

    def _drop_friend(self, ulid: str) -> None:
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        if friend is None or not self._unfriend(ulid):
            return

        def later(stored):
            stored["outbox"].append({"op": "remove", "ulid": ulid, "t": _sign(friend["pairKey"], "remove", {"to": ulid})})
            return True
        self._mutate(later)
        self._flush_soon()

    async def remove(self, ulid: str) -> dict:
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        if friend is None or not self._unfriend(ulid):
            return {"ok": False, "error": "not_friend"}
        tag = _sign(friend["pairKey"], "remove", {"to": ulid})
        entry = {"op": "remove", "ulid": ulid, "t": tag, "at": int(time.time())}
        self._list_event("removed", [{"u": ulid, "t": tag}])

        def later(stored):
            stored["outbox"].append(entry)
            return True
        self._mutate(later)
        if self._up and await self._confirmed({"op": "remove", "ulid": ulid, "t": tag, "age": 0}):
            def sent(stored):
                if entry not in stored["outbox"]:
                    return False
                stored["outbox"].remove(entry)
                return True
            self._mutate(sent)
        return {"ok": True}

    def dismiss(self, ulid: str) -> dict:
        if not is_ulid(ulid):
            return {"ok": False, "error": "unavailable"}

        def keep(stored):
            if ulid in stored["dismissed"]:
                return False
            stored["dismissed"] = (stored["dismissed"] + [ulid])[-MAX_DISMISSED:]
            return True
        self._mutate(keep, ulid=self._me())
        return {"ok": True}

    def messages(self, ulid: str) -> dict:
        account = self._me()
        before = {}

        def mark(stored):
            if self._find(stored, ulid) is None:
                return False
            before["at"] = stored["lastRead"].get(ulid, 0)
            newest = stored["newestAt"].get(ulid, 0)
            if newest <= before["at"] and not stored["unread"].get(ulid):
                return False
            stored["lastRead"][ulid] = max(newest, before["at"])
            stored["unread"].pop(ulid, None)
            return True
        self._mutate(mark, ulid=account)
        if "at" not in before:
            return {"ok": False, "error": "not_friend"}
        return {"ok": True, "messages": self._messages.load(ulid), "readBefore": before["at"]}

    async def send_message(self, ulid: str, text: str) -> dict:
        account = self._me()
        text = clean_text(text)
        if not text:
            return {"ok": False, "error": "empty"}
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        if friend is None:
            return {"ok": False, "error": "not_friend"}
        if not await self._until_up():
            return {"ok": False, "error": "offline"}
        mid = secrets.token_hex(8)
        body = {"from": self._me(), "id": mid, "at": int(time.time()), "text": text}
        reply = await self._ask({"op": "msg", "mid": mid, "to": ulid, "body": body,
                                 "t": _sign(friend["pairKey"], "msg", body)}, "msg:" + mid)
        if reply is None:
            return {"ok": False, "error": "offline"}
        if reply.get("op") != "msg_ok":
            error = reply.get("error")
            return {"ok": False, "error": {"not_friends": "not_friends", "full": "mailbox_full"}.get(error, "unavailable")}

        def keep(stored):
            if self._find(stored, ulid) is None:
                return False
            stored["lastRead"][ulid] = body["at"]
            stored["newestAt"][ulid] = body["at"]
            stored["unread"].pop(ulid, None)
            return True
        self._messages.add(ulid, {"id": mid, "mine": True, "text": text, "at": body["at"]}, ulid=account)
        self._mutate(keep, ulid=account)
        if self._milestone_event is not None:
            self._milestone_event("pt_message")
        return {"ok": True}

    def _take_message(self, sender, body, tag) -> None:
        data = self._data()
        friend = self._find(data, sender) if data is not None and is_ulid(sender) else None
        if friend is None or not _signed(friend["pairKey"], "msg", body, tag):
            return
        text = clean_text(body.get("text"))
        mid = body.get("id")
        at = body.get("at")
        if not text or not _hex16(mid) or body.get("from") != sender or type(at) is not int:
            return
        at = int(time.time())
        account = self._me()
        if not self._messages.add(sender, {"id": mid, "mine": False, "text": text, "at": at}, ulid=account):
            return

        def keep(stored):
            if self._find(stored, sender) is None:
                return False
            stored["unread"][sender] = min(stored["unread"].get(sender, 0) + 1, MAX_MESSAGES)
            stored["newestAt"][sender] = at
            return True
        if self._mutate(keep, ulid=account):
            self._notify("message", friend["name"], f"multiplayer:friend:{sender}",
                         {"friend": sender, "conversation": True, "message": mid}, text=text, pic=friend["userPic"])

    async def retire(self) -> None:
        if not self._up:
            return
        await self._send({"op": "retire"})
        self._refused = "retired"
        if self._link is not None:
            self._link.cancel()
            self._link = None
        self._set_up(False)

    async def invite(self, ulid: str) -> dict:
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        if friend is None:
            return {"ok": False, "error": "not_friend"}
        offer = await self._mp.invite_pass(ulid)
        if offer is None:
            return {"ok": False, "error": "no_room"}
        iid = secrets.token_hex(8)
        key = offer["key"]
        body = {"from": self._me(), "id": iid, "at": int(time.time()), "room": offer["room"], "name": offer["name"],
                "title": offer["title"][:64], "where": offer["where"], "exp": offer["exp"],
                "k": proto.wrap(bytes.fromhex(friend["pairKey"]), "invite", iid, key) if key else "",
                "addr": offer["address"] if proto.is_ipv4(offer["address"]) else ""}
        tag = _sign(friend["pairKey"], "invite", body)
        heard = asyncio.get_running_loop().create_future()
        self._invite_acks[iid] = (friend["pairKey"], heard)
        try:
            listener = self._listener
            if listener is not None and listener.transport is not None:
                packet = json.dumps({"k": FRIEND_KIND, "v": proto.VERSION, "op": "invite", "from": self._me(),
                                     "body": body, "t": tag}, separators=(",", ":"), sort_keys=True).encode("ascii")
                if len(packet) <= DATAGRAM_BYTES:
                    listener.transport.sendto(packet, (self._broadcast, self._peer_port))
                    subnet = self._hotspot_broadcast()
                    if subnet:
                        listener.transport.sendto(packet, (subnet, self._peer_port))
            if self._up and self._presence.get(ulid, {}).get("online"):
                reply = await self._ask({"op": "invite", "iid": iid, "to": ulid, "body": body, "t": tag},
                                        "invite:" + iid)
                if reply is not None and reply.get("op") == "invite_ok" and not heard.done():
                    heard.set_result(True)
            try:
                await asyncio.wait_for(asyncio.shield(heard), INVITE_WAIT_SECONDS)
            except asyncio.TimeoutError:
                return {"ok": False, "error": "not_online", "name": friend["name"]}
        finally:
            self._invite_acks.pop(iid, None)
        if self._milestone_event is not None:
            self._milestone_event("pt_invite")
        return {"ok": True}

    def _take_invite(self, sender, body, tag, addr=None) -> None:
        data = self._data()
        friend = self._find(data, sender) if data is not None and is_ulid(sender) else None
        if friend is None or not _signed(friend["pairKey"], "invite", body, tag):
            return
        iid = body.get("id")
        at = body.get("at")
        expires = body.get("exp")
        if (
            not _hex16(iid)
            or body.get("from") != sender
            or type(at) is not int
            or abs(at - time.time()) > CLOCK_SKEW_SECONDS
            or not proto.is_room_id(body.get("room"))
            or body.get("where") not in proto.WHERES
            or type(expires) is not int
        ):
            return
        if iid in self._seen_invites:
            return
        self._seen_invites = (self._seen_invites + [iid])[-SEEN_INVITES:]
        if addr is not None:
            self._ack_invite(friend, iid, addr)
        key = None
        if body.get("k"):
            key = proto.unwrap(bytes.fromhex(friend["pairKey"]), "invite", iid, body["k"])
            if key is None:
                return
        now = time.time()
        for stale in [name for name, invite in self._invites.items() if invite["until"] < now]:
            del self._invites[stale]
        self._invites[iid] = {
            "from": sender,
            "room": body["room"],
            "name": proto.clean_room_name(body.get("name")) or "Room",
            "where": body["where"],
            "exp": expires,
            "key": key,
            "address": body["addr"] if proto.is_ipv4(body.get("addr")) else "",
            "until": now + INVITE_SECONDS,
        }
        self._notify("invite", friend["name"], "multiplayer:leave", {"friend": sender, "invite": iid},
                     pic=friend["userPic"])

    def _ack_invite(self, friend: dict, iid: str, addr) -> None:
        listener = self._listener
        if listener is None or listener.transport is None:
            return
        packet = json.dumps({"k": FRIEND_KIND, "v": proto.VERSION, "op": "invite_ack", "from": self._me(), "id": iid,
                             "t": _sign(friend["pairKey"], "ack", {"id": iid})}, separators=(",", ":"),
                            sort_keys=True).encode("ascii")
        listener.transport.sendto(packet, addr)

    def invite_info(self, iid: str):
        invite = self._invites.get(iid) if isinstance(iid, str) else None
        if invite is None or invite["until"] < time.time():
            return None
        return invite

    async def accept_invite(self, iid: str, hardcore: bool) -> dict:
        invite = self.invite_info(iid)
        if invite is None or (invite["key"] is not None and invite["exp"] <= time.time()):
            return {"ok": False, "error": "invite_expired"}
        local = invite["where"] == "local"
        if not await self._find_room(invite["room"], invite["address"] if local else ""):
            return {"ok": False, "error": "room_local" if local else "room_gone"}
        offer = None
        if invite["key"] is not None:
            offer = {"ulid": self._me(), "exp": invite["exp"], "key": invite["key"]}
        joined = await self._mp.join(invite["room"], "", hardcore, offer)
        if joined.get("ok"):
            self._invites.pop(iid, None)
        return joined

    async def _find_room(self, room_id: str, address: str) -> bool:
        if address:
            await self._mp.lookup(address)
            if self._room_is_theirs(room_id, address):
                return True
        for _round in range(FIND_ROUNDS):
            await self._mp.discover(room_id)
            if self._room_is_theirs(room_id, address):
                return True
        return False

    def _room_is_theirs(self, room_id: str, address: str) -> bool:
        row = self._mp.room_row(room_id)
        return row is not None and (not address or row["door"] == "server" or row["address"] == address)

    async def join_friend(self, ulid: str, password: str, hardcore: bool) -> dict:
        room = self._seen(ulid).get("room")
        if room is None:
            return {"ok": False, "error": "room_gone"}
        if not await self._find_room(room["id"], ""):
            return {"ok": False, "error": "room_local" if room.get("where") == "local" else "room_gone"}
        return await self._mp.join(room["id"], password, hardcore)

    async def _open_listener(self) -> None:
        if self._listener is not None or self._loop is None:
            return
        listener = self._listener = _Listener(self)
        try:
            await self._loop.create_datagram_endpoint(lambda: listener, local_addr=("0.0.0.0", self._port),
                                                      allow_broadcast=True)
        except OSError as e:
            decky.logger.warning("friends: couldn't open the invite listener (%s)", type(e).__name__)
            if self._listener is listener:
                self._listener = None
            return
        if self._listener is not listener:
            listener.transport.close()
            return
        if self._lan_here is None:
            self._lan_here = self._spawn(self._say_here())

    async def _say_here(self) -> None:
        while True:
            try:
                self._say_here_once()
            except Exception as e:
                decky.logger.warning("friends: couldn't say here on the hotspot (%s)", type(e).__name__)
            await asyncio.sleep(LAN_HERE_SECONDS)

    def _say_here_once(self) -> None:
        now = time.monotonic()
        gone = [ulid for ulid, seen in self._lan_seen.items() if seen["until"] < now]
        for ulid in gone:
            del self._lan_seen[ulid]
        if gone:
            self._changed()
        subnet = self._hotspot_broadcast()
        listener = self._listener
        if not subnet or listener is None or listener.transport is None or not self._me() \
                or not self._cfg().get("mpShowOnline", True):
            return
        data = self._data()
        if data is not None:
            for packet in self._here_packets(data):
                listener.transport.sendto(packet, (subnet, self._peer_port))

    def _here_packets(self, data) -> list:
        body = {"from": self._me(), "at": int(time.time()), "game": self._game(), "room": self._mp.current_room()}
        tags = {_here_slot(friend["pairKey"], body): _sign(friend["pairKey"], "here", body) for friend in data["friends"]}
        packets = []
        batch = {}
        for ulid, tag in tags.items():
            batch[ulid] = tag
            packet = self._here_packet(body, batch)
            if len(packet) > DATAGRAM_BYTES:
                del batch[ulid]
                if batch:
                    packets.append(self._here_packet(body, batch))
                batch = {ulid: tag}
        if batch:
            packets.append(self._here_packet(body, batch))
        return packets

    def _here_packet(self, body: dict, tags: dict) -> bytes:
        return json.dumps({"k": FRIEND_KIND, "v": proto.VERSION, "op": "here", "from": self._me(), "body": body,
                           "t": tags}, separators=(",", ":"), sort_keys=True).encode("ascii")

    def _take_here(self, message: dict, addr) -> None:
        sender = message.get("from")
        body = message.get("body")
        tags = message.get("t")
        data = self._data()
        friend = self._find(data, sender) if data is not None and is_ulid(sender) else None
        if friend is None or not isinstance(tags, dict) or not isinstance(body, dict):
            return
        if not _signed(friend["pairKey"], "here", body, tags.get(_here_slot(friend["pairKey"], body))):
            return
        at = body.get("at")
        if body.get("from") != sender or type(at) is not int or abs(at - time.time()) > CLOCK_SKEW_SECONDS:
            return
        room = body.get("room")
        if not (isinstance(room, dict) and proto.is_room_id(room.get("id")) and room.get("where") in proto.WHERES):
            room = None
        else:
            room = {"id": room["id"], "name": proto.clean_room_name(room.get("name")) or "Room",
                    "where": room["where"], "playing": room.get("playing") is True}
        seen = {"game": proto.clean_chat(body.get("game"))[:64], "room": room,
                "address": addr[0] if isinstance(addr, tuple) and addr else ""}
        before = self._lan_seen.get(sender)
        self._lan_seen[sender] = {**seen, "until": time.monotonic() + LAN_SEEN_SECONDS}
        if before is None or {key: before[key] for key in seen} != seen:
            self._changed()

    def _seen(self, ulid: str) -> dict:
        seen = self._presence.get(ulid, {})
        if seen.get("online"):
            return seen
        here = self._lan_seen.get(ulid)
        if here is None or here["until"] < time.monotonic():
            return seen
        return {"online": True, "game": here["game"], "room": here["room"], "seen": 0, "rank": seen.get("rank")}

    def _close_listener(self) -> None:
        listener, self._listener = self._listener, None
        if listener is not None and listener.transport is not None:
            listener.transport.close()
        if self._lan_here is not None:
            self._lan_here.cancel()
            self._lan_here = None
        if self._lan_seen:
            self._lan_seen = {}
            self._changed()

    def _heard(self, data: bytes, addr) -> None:
        now = time.monotonic()
        self._heard_at = [at for at in self._heard_at if now - at < 1.0]
        if not self._heard_at:
            self._heard_from = {}
        sender = addr[0] if isinstance(addr, tuple) and addr else ""
        if (
            len(self._heard_at) >= DATAGRAMS_PER_SECOND_ALL
            or self._heard_from.get(sender, 0) >= DATAGRAMS_PER_SECOND
            or len(data) > DATAGRAM_BYTES
        ):
            return
        self._heard_at.append(now)
        self._heard_from[sender] = self._heard_from.get(sender, 0) + 1
        if not self._game_mode() or not self._on():
            return
        try:
            message = json.loads(data.decode("ascii"), parse_constant=_refuse)
        except (ValueError, UnicodeDecodeError, RecursionError):
            return
        if (
            not isinstance(message, dict)
            or message.get("k") != FRIEND_KIND
            or not proto.version_ok(message.get("v"))
            or message.get("from") == self._me()
        ):
            return
        op = message.get("op")
        if op == "invite":
            self._take_invite(message.get("from"), message.get("body"), message.get("t"), addr)
        elif op == "invite_ack":
            self._take_ack(message)
        elif op == "here":
            self._take_here(message, addr)

    def _take_ack(self, message: dict) -> None:
        waiting = self._invite_acks.get(message.get("id")) if isinstance(message.get("id"), str) else None
        if waiting is None:
            return
        key, heard = waiting
        if _signed(key, "ack", {"id": message["id"]}, message.get("t")) and not heard.done():
            heard.set_result(True)


def _refuse(_name):
    raise ValueError("constant")


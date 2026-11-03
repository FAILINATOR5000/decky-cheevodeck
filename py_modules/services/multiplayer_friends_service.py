import asyncio
import hashlib
import hmac
import json
import secrets
import time

import decky
import multiplayer_protocol as proto
from multiplayer_friends_store import MAX_DISMISSED, clean_name, clean_pic, clean_text, is_ulid
from multiplayer_messages_store import MAX_MESSAGES
from nearby_protocol import FrameError, canonical
from notifications import emit_notification, is_type_enabled
from services import lobby_client

FRIEND_PORT = 49734
FRIEND_KIND = "cheevodeck.friend"
FRIENDS_EVENT = "cheevodeck_multiplayer_friends"

PING_SECONDS = 20
REPORT_REFRESH_SECONDS = 300
SILENT_SECONDS = 75
REPLY_SECONDS = 5
RETRY_SECONDS = (2, 5, 10, 15, 30)
INVITE_SECONDS = 600
INVITE_WAIT_SECONDS = 2
SELF_PIC_SECONDS = 7 * 86400
DATAGRAM_BYTES = 2048
DATAGRAMS_PER_SECOND = 20
CLOCK_SKEW_SECONDS = 120
LIST_MAX = 500
SEEN_INVITES = 256
ACK_GATHER_SECONDS = 0.3
OUTBOX_GAP_SECONDS = 0.1
ACK_MAX = 500
FIND_ROUNDS = 3

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
                 ra_friends, resolved_avatars, heal, ra_call, ra, port: int = FRIEND_PORT,
                 peer_port: int = FRIEND_PORT, broadcast: str = "255.255.255.255"):
        self._store = store
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
        self._invites = {}
        self._seen_invites = []
        self._invite_acks = {}
        self._listener = None
        self._heard_at = []
        self._sent_report = None
        self._sent_room = None
        self._report_stale = True
        self._report_at = 0.0
        self._running_name = ""
        self._session_account = ""
        self._acks = []
        self._tasks = set()

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
        return bool(cfg.get("mpFriendsEnabled", True))

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
            _data, result = self._store.mutate(change, ulid=ulid)
        except Exception as e:
            decky.logger.warning("friends: couldn't save (%s)", type(e).__name__)
            return None
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
        if self._refused or not self._game_mode() or not self._on() or not self._me() \
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
        listen = self._game_mode() and self._on() and bool(self._me()) and bool(data and data["friends"])
        if listen and self._listener is None:
            self._spawn(self._open_listener())
        elif not listen:
            self._close_listener()

    def identity(self) -> tuple:
        if not self._on():
            return "", ""
        data = self._data()
        return self._me(), data["selfPic"] if data else ""

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
                        if await self._session(server):
                            attempt = 0
                    except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, FrameError) as e:
                        self._debug("link failed (%s)", type(e).__name__)
                    finally:
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
            self._sent_report = None
            self._report_stale = True
            self._sent_room = None
            if self._up:
                self._presence = {}
                self._suggestions = []
        if up != self._up:
            self._up = up
            self._changed()

    def _report(self, data) -> dict:
        cfg = self._cfg()
        suggest = bool(cfg.get("mpSuggestFriends", True))
        visible = bool(cfg.get("mpShowOnline", True))
        presence = {"game": "", "room": None}
        if visible:
            presence = {"game": self._game(), "room": self._mp.current_room()}
        return {
            "visible": visible,
            "suggest": suggest,
            "friends": [friend["ulid"] for friend in data["friends"]][:LIST_MAX],
            "ra": self._mutual_follows() if suggest else [],
            "presence": presence,
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
            nonce = challenge.get("n")
            if challenge.get("op") != "challenge" or not proto.is_nonce(nonce):
                return False
            verifier = hashlib.sha256(bytes.fromhex(data["deviceSecret"])).hexdigest()
            proof = hmac.new(bytes.fromhex(verifier), ("device|" + nonce).encode("ascii"), hashlib.sha256).hexdigest()
            report = self._report(data)
            hello = {"op": "hello", "ulid": self._me(), "name": name, "pic": data["selfPic"], "proof": proof,
                     **report}
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
            self._report_stale = False
            self._report_at = time.monotonic()
            self._session_account = self._me()
            self._acks = []
            self._writer = writer
            self._set_up(True)
            decky.logger.info("friends: online")
            await self._flush_outbox()
            keeper = asyncio.ensure_future(self._keep())
            try:
                while True:
                    message = await asyncio.wait_for(lobby_client.read_envelope(reader), SILENT_SECONDS)
                    self._take(message)
            finally:
                keeper.cancel()
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
                await asyncio.wait_for(writer.drain(), REPLY_SECONDS)
            except (OSError, asyncio.TimeoutError, FrameError):
                return False
        return True

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
        await self._send({"op": "update", **report})

    def room_changed(self) -> None:
        if not self._up:
            return
        room = self._mp.current_room()
        if room != self._sent_room:
            self._sent_room = room
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

    async def _flush_outbox(self) -> None:
        data = self._data()
        if data is None or not data["outbox"]:
            return
        sent = []
        for entry in data["outbox"]:
            if await self._send({"op": "remove", "ulid": entry["ulid"], "t": entry["t"]}):
                sent.append(entry["ulid"])
            await asyncio.sleep(OUTBOX_GAP_SECONDS)

        def drop(stored):
            before = len(stored["outbox"])
            stored["outbox"] = [entry for entry in stored["outbox"] if entry["ulid"] not in sent]
            return len(stored["outbox"]) != before
        self._mutate(drop)

    def _take(self, message: dict) -> None:
        op = message.get("op")
        if op in ("request_ok", "request_no", "msg_ok", "msg_no", "invite_ok", "invite_no"):
            key = message.get("rid") or message.get("mid") or message.get("iid")
            future = self._waiting.get(f"{op.split('_')[0]}:{key}") if isinstance(key, str) else None
            if future is not None and not future.done():
                future.set_result(message)
            return
        if op == "presence":
            self._take_presence(message)
        elif op == "suggest":
            self._take_suggestions(message.get("list"))
        elif op == "mail":
            self._take_mail(message)
        elif op == "invite":
            self._take_invite(message.get("from"), message.get("body"), message.get("t"))

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
            if is_ulid(ulid) and ulid != me and name and proto.is_key(key):
                self._incoming(ulid, name, pic, key, "server")
        elif kind == "accepted":
            if is_ulid(ulid) and name:
                self._accepted(ulid, name, pic, "server")
        elif kind == "friend_added":
            data = self._data()
            waiting = self._request_row(data, ulid) if data is not None and is_ulid(ulid) else None
            if waiting is not None and waiting["way"] == "in" and waiting["pairKey"] == key:
                self._befriend(ulid, waiting["name"], waiting["userPic"], waiting["pairKey"], "server")
        elif kind == "request_gone":
            if is_ulid(ulid):
                self._drop_request(ulid, "server")
        elif kind == "removed":
            data = self._data()
            friend = self._find(data, ulid) if data is not None and is_ulid(ulid) else None
            if friend is not None and _signed(friend["pairKey"], "remove", {"to": me}, message.get("t")):
                self._unfriend(ulid)
        elif kind == "msg":
            self._take_message(message.get("from"), message.get("body"), message.get("t"))
        elif kind == "new_device":
            device = message.get("device")
            if proto.is_device_key(device):
                self._new_device(device)

    def _find(self, data, ulid: str):
        return next((friend for friend in data["friends"] if friend["ulid"] == ulid), None)

    def _request_row(self, data, ulid: str):
        return next((request for request in data["requests"] if request["ulid"] == ulid), None)

    def _incoming(self, ulid: str, name: str, pic: str, key: str, via: str) -> bool:
        def keep(stored):
            friend = self._find(stored, ulid)
            if friend is not None and friend["pairKey"] == key:
                return False
            mine = self._request_row(stored, ulid)
            if mine is not None and mine["way"] == "in":
                return False
            if mine is not None:
                stored["requests"].remove(mine)
            stored["requests"].append({"ulid": ulid, "name": name, "userPic": pic, "at": int(time.time()),
                                       "way": "in", "pairKey": key, "via": via})
            return True
        if self._mutate(keep):
            self._notify(name, "Friend request", f"multiplayer:request:{ulid}", {"friend": ulid})
            self._follow()
            return True
        return False

    def _accepted(self, ulid: str, name: str, pic: str, via: str) -> bool:
        def keep(stored):
            mine = self._request_row(stored, ulid)
            if mine is None or mine["way"] != "out" or mine["via"] != via:
                return False
            stored["requests"].remove(mine)
            if via == "server":
                stored["friends"].append({"ulid": ulid, "name": mine["name"], "pairKey": mine["pairKey"],
                                          "userPic": mine["userPic"] or pic, "added": int(time.time()),
                                          "via": via, "healedAt": int(time.time()), "healTriedAt": 0})
            else:
                stored["friends"].append({"ulid": ulid, "name": name, "pairKey": mine["pairKey"],
                                          "userPic": pic or mine["userPic"], "added": int(time.time()),
                                          "via": via, "healedAt": 0, "healTriedAt": 0})
            return True
        if self._mutate(keep):
            self._heal.friend_added()
            self._notify(name, "Request accepted", f"multiplayer:friend:{ulid}", {"friend": ulid})
            self._follow()
            self.report_changed()
            return True
        return False

    def _befriend(self, ulid: str, name: str, pic: str, key: str, via: str) -> None:
        def keep(stored):
            mine = self._request_row(stored, ulid)
            if mine is not None:
                stored["requests"].remove(mine)
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
            self._heal.friend_added()
            self._follow()
            self.report_changed()

    def _drop_request(self, ulid: str, via=None) -> None:
        def drop(stored):
            mine = self._request_row(stored, ulid)
            if mine is None or (via is not None and mine["via"] != via):
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

    def _new_device(self, device: str) -> None:
        def keep(stored):
            if any(alert["device"] == device for alert in stored["alerts"]):
                return False
            stored["alerts"].append({"device": device, "at": int(time.time())})
            return True
        if self._mutate(keep):
            self._notify(self._my_name(), "New device online", "multiplayer:alert:" + device,
                         {"alert": device})

    def _claim_ok(self, ulid: str, name: str) -> bool:
        row = next((row for row in self._ra_rows() if row.get("ulid") == ulid), None)
        return row is None or str(row.get("username") or "").lower() == name.lower()

    def local_request(self, ulid: str, name: str, pic: str, key: bytes) -> bool:
        name = clean_name(name)
        if not self._on() or not is_ulid(ulid) or ulid == self._me() or not name or not self._claim_ok(ulid, name):
            return False
        return self._incoming(ulid, name, clean_pic(pic), key.hex(), "local")

    def local_answer(self, ulid: str, accepted: bool, name: str, pic: str) -> bool:
        name = clean_name(name)
        if not self._on() or not is_ulid(ulid) or not name or not self._claim_ok(ulid, name):
            return False
        if accepted:
            return self._accepted(ulid, name, clean_pic(pic), "local")
        self._drop_request(ulid, "local")
        return True

    def _notify(self, name: str, line: str, land: str, meta: dict) -> None:
        if self._notifications is not None and is_type_enabled("system", self._settings_store):
            try:
                self._notifications.append({
                    "type": "system",
                    "kind": "actionable",
                    "iconSource": "none",
                    "title": name,
                    "body": line,
                    "source": "notifications",
                    "target": {"view": "multiplayer", "tab": "friends", "land": land},
                    "meta": {"multiplayer": "friend", **meta},
                })
            except Exception as e:
                decky.logger.warning("friends: the notification could not be filed (%s)", type(e).__name__)
        emit_notification(
            ntype="system",
            settings_store=self._settings_store,
            event_loop=self._loop,
            toast_title=name,
            line_key=line,
        )

    def state(self) -> dict:
        cfg = self._cfg()
        data = self._data() if self._me() else None
        follows = self._follows()
        if data is not None:
            data = self._heal_follows(data, follows)
        friends = []
        requests = []
        alerts = []
        if data is not None:
            for friend in data["friends"]:
                seen = self._presence.get(friend["ulid"], {})
                friends.append({
                    "ulid": friend["ulid"],
                    "name": friend["name"],
                    "pic": friend["userPic"],
                    "raFriend": friend["ulid"] in follows,
                    "online": bool(seen.get("online")),
                    "game": seen.get("game", ""),
                    "room": seen.get("room"),
                    "seen": seen.get("seen", 0),
                    "unread": data["unread"].get(friend["ulid"], 0),
                    "newest": data["newestAt"].get(friend["ulid"], 0),
                    "added": friend["added"],
                })
            friends.sort(key=lambda row: (not row["online"], row["name"].lower()))
            requests = [{"ulid": request["ulid"], "name": request["name"], "pic": request["userPic"],
                         "way": request["way"], "at": request["at"]} for request in data["requests"]]
            alerts = list(data["alerts"])
        known = {row["ulid"] for row in friends} | {row["ulid"] for row in requests}
        if data is not None:
            known |= set(data["dismissed"])
        return {
            "ok": True,
            "on": self._on(cfg),
            "me": self._me(),
            "selfPic": data["selfPic"] if data is not None else "",
            "server": self._mp.lobby_server() is not None,
            "up": self._up,
            "refused": self._refused,
            "friends": friends,
            "requests": requests,
            "suggestions": [row for row in self._suggestions if row["ulid"] not in known]
            if cfg.get("mpSuggestFriends", True) else [],
            "alerts": alerts,
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
        waiting = self._request_row(data, ulid)
        if waiting is not None and waiting["way"] == "in":
            answered = await self.answer(ulid, True)
            return {**answered, "ulid": ulid, "friend": True} if answered["ok"] else answered
        if waiting is not None:
            return {"ok": False, "error": "pending"}
        if not await self._until_up():
            return {"ok": False, "error": "offline"}
        key = secrets.token_hex(32)
        rid = secrets.token_hex(8)
        reply = await self._ask({"op": "request", "rid": rid, "to": ulid, "name": self._my_name(),
                                 "pic": data["selfPic"], "key": key}, "request:" + rid)
        if reply is None:
            return {"ok": False, "error": "offline"}
        if reply.get("op") != "request_ok":
            error = reply.get("error")
            return {"ok": False, "error": error if error in ("pending", "limit", "self") else "unavailable"}

        def keep(stored):
            stored["requests"].append({"ulid": ulid, "name": cased, "userPic": pic, "at": int(time.time()),
                                       "way": "out", "pairKey": key, "via": "server"})
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
        waiting = self._request_row(data, ulid)
        if waiting is not None and waiting["way"] == "in":
            return await self.answer(ulid, True)
        if waiting is not None:
            return {"ok": False, "error": "pending"}
        key = secrets.token_bytes(32)
        if not await self._mp.send_friend(seat, "ask", key):
            return {"ok": False, "error": "unavailable"}

        def keep(stored):
            stored["requests"].append({"ulid": ulid, "name": person["name"], "userPic": person["pic"],
                                       "at": int(time.time()), "way": "out", "pairKey": key.hex(), "via": "local"})
            return True
        self._mutate(keep, ulid=account)
        self._follow()
        return {"ok": True}

    async def answer(self, ulid: str, accept: bool) -> dict:
        data = self._data()
        request = self._request_row(data, ulid) if data is not None and is_ulid(ulid) else None
        if request is None:
            return {"ok": False, "error": "no_request"}
        if request["way"] == "out":
            if accept:
                return {"ok": False, "error": "no_request"}
            if request["via"] == "server" and not (await self._until_up()
                                                   and await self._send({"op": "withdraw", "to": ulid})):
                return {"ok": False, "error": "offline"}
            self._drop_request(ulid)
            return {"ok": True}
        if request["via"] == "local":
            seat = self._mp.seat_of(ulid)
            delivered = seat is not None and await self._mp.send_friend(seat, "accept" if accept else "decline")
            if not delivered and accept:
                return {"ok": False, "error": "left_room"}
        elif not (await self._until_up() and await self._send({"op": "answer", "to": ulid, "accept": bool(accept)})):
            return {"ok": False, "error": "offline"}
        if accept:
            self._befriend(ulid, request["name"], request["userPic"], request["pairKey"], request["via"])
        else:
            self._drop_request(ulid)
        return {"ok": True}

    async def remove(self, ulid: str) -> dict:
        data = self._data()
        friend = self._find(data, ulid) if data is not None else None
        if friend is None or not self._unfriend(ulid):
            return {"ok": False, "error": "not_friend"}
        tag = _sign(friend["pairKey"], "remove", {"to": ulid})
        if not (self._up and await self._send({"op": "remove", "ulid": ulid, "t": tag})):
            def later(stored):
                stored["outbox"].append({"op": "remove", "ulid": ulid, "t": tag})
                return True
            self._mutate(later)
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
            self._notify(friend["name"], "New message", f"multiplayer:friend:{sender}",
                         {"friend": sender, "conversation": True})

    async def alert(self, device: str, revoke: bool) -> dict:
        if revoke:
            if not await self._until_up():
                return {"ok": False, "error": "offline"}
            await self._send({"op": "revoke", "device": device})

        def drop(stored):
            before = len(stored["alerts"])
            stored["alerts"] = [alert for alert in stored["alerts"] if alert["device"] != device]
            return len(stored["alerts"]) != before
        self._mutate(drop)
        return {"ok": True}

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
        self._notify(friend["name"], "Room invite", "multiplayer:leave",
                     {"friend": sender, "invite": iid})

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
        if not await self._find_room(invite["room"], invite["address"]):
            return {"ok": False, "error": "room_gone"}
        offer = None
        if invite["key"] is not None:
            offer = {"ulid": self._me(), "exp": invite["exp"], "key": invite["key"]}
        joined = await self._mp.join(invite["room"], "", hardcore, offer)
        if joined.get("ok"):
            self._invites.pop(iid, None)
        return joined

    async def _find_room(self, room_id: str, address: str) -> bool:
        for _round in range(FIND_ROUNDS):
            await self._mp.discover()
            if self._mp.has_room(room_id):
                return True
        if address:
            await self._mp.lookup(address)
        return self._mp.has_room(room_id)

    async def join_friend(self, ulid: str, password: str, hardcore: bool) -> dict:
        room = self._presence.get(ulid, {}).get("room")
        if room is None or not await self._find_room(room["id"], ""):
            return {"ok": False, "error": "room_gone"}
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

    def _close_listener(self) -> None:
        listener, self._listener = self._listener, None
        if listener is not None and listener.transport is not None:
            listener.transport.close()

    def _heard(self, data: bytes, addr) -> None:
        now = time.monotonic()
        self._heard_at = [at for at in self._heard_at if now - at < 1.0]
        if len(self._heard_at) >= DATAGRAMS_PER_SECOND or len(data) > DATAGRAM_BYTES:
            return
        self._heard_at.append(now)
        if not self._game_mode() or not self._on():
            return
        try:
            message = json.loads(data.decode("ascii"), parse_constant=_refuse)
        except (ValueError, UnicodeDecodeError, RecursionError):
            return
        if (
            not isinstance(message, dict)
            or message.get("k") != FRIEND_KIND
            or message.get("v") != proto.VERSION
            or message.get("from") == self._me()
        ):
            return
        op = message.get("op")
        if op == "invite":
            self._take_invite(message.get("from"), message.get("body"), message.get("t"), addr)
        elif op == "invite_ack":
            self._take_ack(message)

    def _take_ack(self, message: dict) -> None:
        waiting = self._invite_acks.get(message.get("id")) if isinstance(message.get("id"), str) else None
        if waiting is None:
            return
        key, heard = waiting
        if _signed(key, "ack", {"id": message["id"]}, message.get("t")) and not heard.done():
            heard.set_result(True)


def _refuse(_name):
    raise ValueError("constant")


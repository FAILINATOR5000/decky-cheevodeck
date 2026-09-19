"""What the player was doing when a picture was taken.

Pure computation: an achievement list and a capture time in, progress and a
bound burst out. No store, no network, no settings, which is what makes it
drivable from a harness with a hand-built payload and a fixed timestamp.

Nothing here infers an unlock time. RetroAchievements' own ``dateEarned`` is the
answer or there is no answer, because a memory carrying a fabricated moment is
worse than one carrying no moment at all.
"""

from datetime import datetime, timezone


BACK_SECONDS = 60

FORWARD_SKEW_SECONDS = 3

SETTLE_SLACK_SECONDS = 20


def parse_ra_timestamp(value):
    """Turn RA's "YYYY-MM-DD HH:MM:SS" into epoch seconds, or None.

    RA serves these as UTC with no offset, so the timezone is attached before
    converting. Parsing one naively resolves it against the local clock and
    lands the result hours out.
    """
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None
    return int(parsed.replace(tzinfo=timezone.utc).timestamp())


def unlock_time(achievement):
    """When this achievement was first earned, or None if it was not.

    Hardcore and softcore carry separate timestamps and either one counts as
    awarded, which is the same test the payload's own awarded count uses. The
    earlier of the two is the moment.
    """
    if not isinstance(achievement, dict):
        return None
    stamps = [
        parse_ra_timestamp(achievement.get("dateEarned")),
        parse_ra_timestamp(achievement.get("dateEarnedHardcore")),
    ]
    stamps = [s for s in stamps if s is not None]
    return min(stamps) if stamps else None


def _int_or_zero(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _card(achievement, stamp):
    return {
        "id": achievement.get("id"),
        "title": str(achievement.get("title") or ""),
        "description": str(achievement.get("description") or ""),
        "hardcore": parse_ra_timestamp(achievement.get("dateEarnedHardcore")) is not None,
        "trueRatio": _int_or_zero(achievement.get("trueRatio")),
        "badgeName": str(achievement.get("badgeName") or ""),
        "points": achievement.get("points") or 0,
        "numAwarded": achievement.get("numAwarded") or 0,
        "type": str(achievement.get("type") or ""),
        "unlockedAt": stamp,
    }


def progress_at(achievements, captured_at) -> dict:
    """How far through the set the player was at that moment.

    Reconstructed rather than remembered: every achievement carries its own
    unlock timestamp, so the answer is the same whether it is computed a minute
    later or a year later.
    """
    total = 0
    unlocked = 0
    points = 0
    for achievement in achievements or []:
        if not isinstance(achievement, dict):
            continue
        total += 1
        stamp = unlock_time(achievement)
        if stamp is not None and stamp <= captured_at:
            unlocked += 1
            try:
                points += int(achievement.get("points") or 0)
            except (TypeError, ValueError):
                pass
    return {"unlocked": unlocked, "total": total, "points": points}


def unlocks_near(achievements, captured_at, *, back=BACK_SECONDS, forward=FORWARD_SKEW_SECONDS) -> list:
    """Every unlock inside the window around the capture, earliest first.

    The window is the whole rule: an unlock in it is bound, one outside it is
    not. An earlier design clustered the unlocks by how far apart they were and
    bound only the cluster nearest the capture, which split an ordinary run of
    four into four events and bound one of them.

    Earliest first, so a viewer showing only the first few shows the ones that
    led to the capture. Unlocks landing in the same second are ordered rarest
    first, which is common: RetroAchievements stamps to the second and a pair
    can share one.
    """
    in_window = []
    for achievement in achievements or []:
        stamp = unlock_time(achievement)
        if stamp is None:
            continue
        if captured_at - back <= stamp <= captured_at + forward:
            in_window.append((stamp, achievement))

    in_window.sort(key=lambda row: (row[0], row[1].get("numAwarded") or 0))
    return [_card(achievement, stamp) for stamp, achievement in in_window]


def resolve(achievements, captured_at, *, now, back=BACK_SECONDS, forward=FORWARD_SKEW_SECONDS) -> dict:
    """Everything the resolver knows about one memory.

    ``contextState`` only reaches "resolved" once the forward window has closed
    and a little more; until then the memory may be filled in but stays pending,
    so a later unlock is still picked up. Running this twice over the same inputs
    produces the same answer.
    """
    cards = unlocks_near(achievements, captured_at, back=back, forward=forward)
    settled = now >= captured_at + forward + SETTLE_SLACK_SECONDS
    return {
        "progress": progress_at(achievements, captured_at),
        "achievements": cards,
        "achievementCount": len(cards),
        "contextState": "resolved" if settled else "pending",
    }

from datetime import date, datetime, timedelta
import re


_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")


def day_of(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def month_of(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m")


def today():
    return datetime.now().strftime("%Y-%m-%d")


def this_month():
    return datetime.now().strftime("%Y-%m")


def parse_day(text):
    if not isinstance(text, str) or not _DAY_RE.match(text):
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def is_month(text):
    if not isinstance(text, str) or not _MONTH_RE.match(text):
        return False
    try:
        datetime.strptime(text, "%Y-%m")
    except ValueError:
        return False
    return True


def is_week(text):
    if not isinstance(text, str) or not _WEEK_RE.match(text):
        return False
    return 1 <= int(text[6:]) <= 53


def week_of_day(day_text):
    day = parse_day(day_text)
    if day is None:
        return None
    year, week, _weekday = day.isocalendar()
    return "%04d-W%02d" % (year, week)


def this_week():
    return week_of_day(today())


def week_start_day(week_text):
    if not is_week(week_text):
        return None
    year = int(week_text[:4])
    week = int(week_text[6:])
    try:
        return date.fromisocalendar(year, week, 1).strftime("%Y-%m-%d")
    except ValueError:
        return None


def add_days(day_text, count):
    day = parse_day(day_text)
    if day is None:
        return None
    return (day + timedelta(days=count)).strftime("%Y-%m-%d")


def day_start_ts(day_text):
    day = parse_day(day_text)
    if day is None:
        return None
    return int(datetime(day.year, day.month, day.day).timestamp())


def month_bounds(month_text):
    if not is_month(month_text):
        return None
    year = int(month_text[:4])
    month = int(month_text[5:])
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return int(start.timestamp()), int(end.timestamp())


def month_days(month_text):
    bounds = month_bounds(month_text)
    if bounds is None:
        return []
    first = datetime.fromtimestamp(bounds[0]).date()
    out = []
    day = first
    while day.month == first.month:
        out.append(day.strftime("%Y-%m-%d"))
        day += timedelta(days=1)
    return out


def previous_month(month_text):
    if not is_month(month_text):
        return None
    year = int(month_text[:4])
    month = int(month_text[5:])
    if month == 1:
        return "%04d-12" % (year - 1)
    return "%04d-%02d" % (year, month - 1)


def next_month(month_text):
    if not is_month(month_text):
        return None
    year = int(month_text[:4])
    month = int(month_text[5:])
    if month == 12:
        return "%04d-01" % (year + 1)
    return "%04d-%02d" % (year, month + 1)


def months_between(first_month, last_month):
    out = []
    month = first_month
    while is_month(month) and month <= last_month:
        out.append(month)
        month = next_month(month)
    return out

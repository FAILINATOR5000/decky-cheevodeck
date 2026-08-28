import { type LanguageCode, DEFAULT_LANGUAGE, t } from "../locales";

export function formatInteger(value?: number | null) {
    return Number(value ?? 0).toLocaleString();
}

export function formatRatio(numerator?: number | null, denominator?: number | null) {
    const left = Math.max(0, Number(numerator ?? 0));
    const right = Math.max(0, Number(denominator ?? 0));
    if (!right) {
        return "0.00";
    }
    return (left / right).toFixed(2).replace(/\.00$/, "");
}

export function formatRelativeTime(
    value: string | null | undefined,
    language: LanguageCode = DEFAULT_LANGUAGE
) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }

    const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
    const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return t(language, "{{count}}m ago", { count: Math.max(1, minutes) });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const minutesIntoHour = minutes % 60;
        if (minutesIntoHour === 0) {
            return t(language, "{{count}}h ago", { count: hours });
        }
        return t(language, "{{hours}}h {{minutes}}m ago", {
            hours: hours,
            minutes: minutesIntoHour,
        });
    }
    const days = Math.floor(hours / 24);
    return t(language, "{{count}}d ago", { count: days });
}

const RELEASE_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatReleaseDate(
    value: string | null | undefined,
    granularity: string | null | undefined
) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }

    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        return "";
    }

    const year = match[1];
    const month = RELEASE_MONTHS[Number(match[2]) - 1] || "";
    const day = Number(match[3]);
    const grain = String(granularity || "").trim().toLowerCase();

    if (!month || grain === "year") {
        return year;
    }
    if (grain === "month") {
        return `${month} ${year}`;
    }
    if (grain === "day") {
        return `${month} ${day}, ${year}`;
    }
    return year;
}

const MEMBER_SINCE_MONTHS: Record<LanguageCode, readonly string[]> = {
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
    de: ["Jan", "Feb", "März", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    ru: ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."],
    ja: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    pl: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
};

export function formatMemberSince(
    value: string | null | undefined,
    language: LanguageCode
): string | null {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (monthIndex < 0 || monthIndex > 11) {
        return null;
    }

    const months = MEMBER_SINCE_MONTHS[language] || MEMBER_SINCE_MONTHS.en;
    const month = months[monthIndex];
    if (language === "es") {
        return `${day} ${month} ${year}`;
    }
    if (language === "pt") {
        return `${day} ${month} ${year}`;
    }
    if (language === "fr") {
        return `${day} ${month} ${year}`;
    }
    if (language === "de") {
        return `${day}. ${month} ${year}`;
    }
    if (language === "ru") {
        return `${day} ${month} ${year} г.`;
    }
    if (language === "pl") {
        return `${day} ${month} ${year}`;
    }
    if (language === "ja") {
        return `${year}年${month}${day}日`;
    }
    return `${month} ${day}, ${year}`;
}

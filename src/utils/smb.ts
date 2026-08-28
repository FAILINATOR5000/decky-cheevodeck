import { t, type LanguageCode } from "../locales";
import type { SmbShare, SmbShareStatus, SmbVersion } from "../types";
import { achievementGreen, errorRed } from "./style";

export function sortSharesByName(shares: SmbShare[], language: LanguageCode): SmbShare[] {
    return [...shares].sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: "base" }));
}

export function smbStatusColor(status: SmbShareStatus): string | undefined {
    if (status === "mounted" || status === "idle") {
        return achievementGreen;
    }
    if (status === "unreachable" || status === "error") {
        return errorRed;
    }
    return undefined;
}

export function smbStatusLabel(
    status: SmbShareStatus,
    language: LanguageCode,
    statusError?: string | null
): string {
    if (status === "error") {
        return smbErrorLabel(statusError ?? undefined, language);
    }
    if (status === "mounted") {
        return t(language, "Mounted");
    }
    if (status === "idle") {
        return t(language, "Ready — mounts on first use");
    }
    if (status === "unreachable") {
        return t(language, "Offline: Server Not Reachable");
    }
    if (status === "disabled") {
        return t(language, "Off");
    }
    return t(language, "Unknown: Couldn't Read This Mount");
}

const MOUNT_ERRNO_PREFIX = "mount_errno_";

export function smbErrorLabel(code: string | undefined, language: LanguageCode): string {
    if (code === "not_reachable") {
        return t(language, "Offline: Server Not Reachable");
    }
    if (code === "bad_credentials") {
        return t(language, "Offline: Wrong Username or Password");
    }
    if (code === "share_not_found") {
        return t(language, "Offline: Share Not Found on the Server");
    }
    if (code === "access_denied") {
        return t(language, "Offline: Access Denied for This Account");
    }
    if (code === "dialect_unsupported") {
        return t(language, "Offline: SMB Version Not Supported");
    }
    if (code === "no_response") {
        return t(language, "Offline: Server Didn't Respond");
    }
    if (code?.startsWith(MOUNT_ERRNO_PREFIX)) {
        return t(language, "Offline: Mount Refused (error {{code}})", {
            code: code.slice(MOUNT_ERRNO_PREFIX.length)
        });
    }
    if (code === "not_armed") {
        return t(language, "Won't Mount: Switch It Off and On");
    }
    if (code === "units_missing") {
        return t(language, "Broken: System Files Missing, Edit and Save");
    }
    if (code === "system_error") {
        return t(language, "Broken: A System Command Failed");
    }
    if (code === "timed_out") {
        return t(language, "Offline: The System Took Too Long");
    }
    if (code === "status_unreadable") {
        return t(language, "Unknown: Couldn't Read This Mount");
    }
    if (code === "not_found") {
        return t(language, "That mount is gone. Reopen the page to refresh the list.");
    }
    if (code === "create_failed" || code === "update_failed") {
        return t(language, "Broken: Couldn't Write the Mount Files");
    }
    if (code === "unit_removal_failed") {
        return t(language, "Broken: Couldn't Remove the Mount Files");
    }
    if (code === "duplicate_name") {
        return t(language, "There's already a mount with that name.");
    }
    if (code === "too_many_shares") {
        return t(language, "That's as many mounts as this can hold.");
    }
    if (code === "name_required") {
        return t(language, "Give the mount a name.");
    }
    if (code === "server_required") {
        return t(language, "Enter the server address.");
    }
    if (code === "share_required") {
        return t(language, "Enter the share name.");
    }
    if (code === "server_invalid" || code === "server_too_long") {
        return t(language, "That server address doesn't look right.");
    }
    if (code === "share_invalid" || code === "share_too_long") {
        return t(language, "That share name doesn't look right.");
    }
    if (code === "name_invalid" || code === "name_too_long") {
        return t(language, "That name doesn't look right.");
    }
    if (code === "username_invalid" || code === "username_too_long") {
        return t(language, "That username doesn't look right.");
    }
    if (code === "password_invalid" || code === "password_too_long") {
        return t(language, "That password doesn't look right.");
    }
    if (code === "domain_invalid" || code === "domain_too_long") {
        return t(language, "That domain doesn't look right.");
    }
    return t(language, "Something Went Wrong");
}

export function smbServerRejectionLabel(code: string | undefined, language: LanguageCode): string | null {
    if (code === "bad_credentials") {
        return t(language, "The server rejected this username and password.");
    }
    if (code === "access_denied") {
        return t(language, "The server says this account can't open that share.");
    }
    if (code === "share_not_found") {
        return t(language, "The server has no share with that name.");
    }
    return null;
}

export function smbBusyLabel(blockedBy: string[] | undefined, language: LanguageCode): string {
    const names = (blockedBy ?? []).filter(Boolean);
    if (names.length === 0) {
        return t(language, "Something's still using this share.");
    }
    return `${t(language, "Still in use by")} ${names.join(", ")}`;
}

const SMB_VERSION_ORDER: SmbVersion[] = ["auto", "3.1.1", "3.0", "2.1", "2.0", "1.0"];

export function smbVersionLabel(vers: SmbVersion, language: LanguageCode): string {
    if (vers === "auto") {
        return t(language, "Automatic");
    }
    if (vers === "2.0") {
        return t(language, "SMB 2.0 (legacy)");
    }
    if (vers === "1.0") {
        return t(language, "SMB 1.0 (legacy, insecure)");
    }
    return `SMB ${vers}`;
}

export function nextSmbVersion(current: SmbVersion): SmbVersion {
    const index = SMB_VERSION_ORDER.indexOf(current);
    return SMB_VERSION_ORDER[(index + 1) % SMB_VERSION_ORDER.length];
}

import { Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import React, { useRef, useState, type ReactNode } from "react";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InfoText } from "../components/ui/InfoText";
import { ABOUT_BANNER_IMAGE } from "../components/ui/aboutBanner";
import { t, type LanguageCode } from "../locales";
import { openExternalUrl } from "../utils/navigation";
import type { AboutUpdateNotice } from "../hooks/useAboutController";
import type { ButtonSpacing, ViewKey } from "../types";
import { achievementGreen, regularButtonSpacingStyle, bodyTextStyle } from "../utils/style";
import { getCurrentTextScale, scaleMultiplier, textSize } from "../utils/scale";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

function updateNoticeSlot(notice: AboutUpdateNotice): "copy" | "download" | "check" | "" {
    if (notice === "copied" || notice === "copyFailed") {
        return "copy";
    }
    if (notice === "downloaded"
        || notice === "downloadBadFolder"
        || notice === "downloadTooBig"
        || notice === "downloadFailed") {
        return "download";
    }
    if (notice === "upToDate"
        || notice === "unreachable"
        || notice === "updateFound"
        || notice === "stillNewest") {
        return "check";
    }
    return "";
}

function updateNoticeKey(notice: AboutUpdateNotice): string {
    if (notice === "upToDate") {
        return "You're up to date.";
    }
    if (notice === "unreachable") {
        return "Couldn't reach GitHub.";
    }
    if (notice === "copied") {
        return "Install link copied.";
    }
    if (notice === "copyFailed") {
        return "Couldn't copy the link. Try the Download ZIP button instead.";
    }
    if (notice === "downloaded") {
        return "Saved as {{name}}.";
    }
    if (notice === "downloadBadFolder") {
        return "Couldn't save there. Pick another folder.";
    }
    if (notice === "downloadTooBig") {
        return "That download is bigger than expected, so it was left alone.";
    }
    if (notice === "downloadFailed") {
        return "Couldn't download the update.";
    }
    if (notice === "updateFound") {
        return "Version {{version}} found.";
    }
    if (notice === "stillNewest") {
        return "Still the newest.";
    }
    return "";
}

const CC_BY_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";
const APACHE_LICENSE_URL = "https://github.com/spdx/license-list-data/blob/main/text/Apache-2.0.txt";
const CC_BY_SA_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const LGPL_LICENSE_URL = "https://github.com/spdx/license-list-data/blob/main/text/LGPL-2.1-only.txt";
const GPL_2_LICENSE_URL = "https://github.com/spdx/license-list-data/blob/main/text/GPL-2.0-only.txt";
const GPL_3_LICENSE_URL = "https://github.com/spdx/license-list-data/blob/main/text/GPL-3.0-only.txt";

type AboutPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    version: string;
    backTarget: "main" | "options";
    updateAvailable: boolean;
    latestVersion: string;
    installUrl: string;
    patchNotesUrl: string;
    checkingForUpdate: boolean;
    downloadingZip: boolean;
    downloadedName: string;
    updateNotice: AboutUpdateNotice;
    attributionsUrl: string;
};

type AboutPageActions = {
    onBack: () => void | Promise<void>;
    onOpenGithub: () => void;
    onOpenKofi: () => void;
    onOpenRaPatreon: () => void;
    onHome: () => void | Promise<void>;
    onCheckNow: () => void;
    onCopyInstallLink: (from: Element | null) => void;
    onDownloadZip: () => void;
    onViewPatchNotes: () => void;
};

function AttributionLink(props: { url: string; children: ReactNode }) {
    const [reactFocused, setReactFocused] = useState(false);
    const [gpFocused, setGpFocused] = useState(false);
    const focused = reactFocused || gpFocused;

    function open() {
        void openExternalUrl(props.url);
    }

    return (
        <div
            onFocusCapture={() => setReactFocused(true)}
            onBlurCapture={() => setReactFocused(false)}
            style={{ display: "block", width: "100%" }}
        >
            <Focusable
                onActivate={open}
                onGamepadFocus={() => setGpFocused(true)}
                onGamepadBlur={() => setGpFocused(false)}
                style={{
                    fontSize: "inherit",
                    lineHeight: "inherit",
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "4px 0",
                    borderRadius: "3px",
                    color: focused ? "#8fc4ff" : "#4ea1ff",
                    textDecoration: "underline",
                    cursor: "pointer",
                    backgroundColor: focused ? "rgba(255, 255, 255, 0.14)" : "transparent",
                    outline: focused ? "2px solid rgba(255, 255, 255, 0.9)" : "2px solid transparent"
                }}
            >
                {props.children}
            </Focusable>
        </div>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type BrandIconProps = { size: number };

function GithubIcon({ size }: BrandIconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512" width={size} height={size} fill="currentColor">
            <path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z" />
        </svg>
    );
}

function KofiIcon({ size }: BrandIconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
            <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z" />
        </svg>
    );
}

function PatreonIcon({ size }: BrandIconProps) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
            <path d="M22.957 7.21c-.004-3.064-2.391-5.576-5.191-6.482-3.478-1.125-8.064-.962-11.384.604C2.357 3.231 1.093 7.391 1.046 11.54c-.039 3.411.302 12.396 5.369 12.46 3.765.047 4.326-4.804 6.068-7.141 1.24-1.662 2.836-2.132 4.801-2.618 3.376-.836 5.678-3.501 5.673-7.031Z" />
        </svg>
    );
}

const LINK_ICON_BASE_PX = 44;

function LinkCard(props: {
    focusKey: string;
    renderIcon: (size: number) => ReactNode;
    title: string;
    blurb: string;
    onClick: () => void;
    outerStyle?: React.CSSProperties;
}) {
    const iconSize = textSize(LINK_ICON_BASE_PX);

    return (
        <FocusableItem outerStyle={props.outerStyle} focusKey={props.focusKey} onClick={props.onClick}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", textAlign: "left" }}>
                <div
                    style={{
                        width: `${iconSize}px`,
                        height: `${iconSize}px`,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    {props.renderIcon(iconSize)}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: `${scaleMultiplier(getCurrentTextScale())}em`, fontWeight: 800 }}>
                        {props.title}
                    </span>
                    <span style={bodyTextStyle()}>{props.blurb}</span>
                </div>
            </div>
        </FocusableItem>
    );
}

type AboutPageProps = {
    state: AboutPageState;
    actions: AboutPageActions;
};

function AboutPage(props: AboutPageProps) {
    const { state, actions } = props;

    if (state.view !== "about") {
        return null;
    }

    const versionLabel = state.version
        ? `CheevoDeck · ${t(state.language, "Version")} ${state.version}`
        : "";

    const backLabel = state.backTarget === "main"
        ? t(state.language, "← Back to Main")
        : t(state.language, "← Back to Options");

    const updateBlockRef = useRef<HTMLDivElement>(null);

    const noticeKey = updateNoticeKey(state.updateNotice);
    const noticeText = noticeKey
        ? t(state.language, noticeKey, { name: state.downloadedName, version: state.latestVersion })
        : "";

    const noticeSlot = updateNoticeSlot(state.updateNotice);
    const noticeRow = noticeText
        ? (
            <PanelSectionRow>
                <InfoText>{noticeText}</InfoText>
            </PanelSectionRow>
        )
        : null;

    return (
        <PanelSection key={`about:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(state.language, "About CheevoDeck")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={backLabel}
                focusKey="about:back"
                navAutoFocus
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            {versionLabel && (
                <PanelSectionRow>
                    <div style={{ textAlign: "center", fontSize: `${textSize(15)}px`, fontWeight: 600, paddingBottom: "4px" }}>
                        {versionLabel}
                    </div>
                </PanelSectionRow>
            )}

            {
}
            <FocusableItem
                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                focusKey="about:banner"
                onClick={actions.onOpenGithub}
            >
                <img
                    src={ABOUT_BANNER_IMAGE}
                    alt="CheevoDeck"
                    style={{
                        display: "block",
                        width: "100%",
                        height: "auto",
                        borderRadius: "4px"
                    }}
                />
            </FocusableItem>

            {state.updateAvailable && (
                <PanelSectionRow>
                    <div ref={updateBlockRef} style={{ paddingBottom: "4px" }}>
                        <div style={{
                            textAlign: "center",
                            color: achievementGreen,
                            fontSize: `${textSize(15)}px`,
                            fontWeight: 700
                        }}>
                            {t(state.language, "Version {{version}} available.", { version: state.latestVersion })}
                        </div>
                    </div>
                </PanelSectionRow>
            )}

            {state.updateAvailable && (
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="about:copy-install-link"
                        onClick={() => actions.onCopyInstallLink(updateBlockRef.current)}
                        help={t(state.language, "Paste this link into Decky → Settings → Developer → Install from URL.")}
                    >
                        {t(state.language, "Copy Install Link")}
                    </FocusableItem>
                </PanelSectionRow>
            )}

            {noticeSlot === "copy" && noticeRow}

            {state.updateAvailable && (
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="about:download-zip"
                        onClick={actions.onDownloadZip}
                        help={t(state.language, "Saves the file to your Deck first, then install it from Decky → Settings → Developer → Install plugin from ZIP.")}
                    >
                        {state.downloadingZip
                            ? t(state.language, "Downloading...")
                            : t(state.language, "Download ZIP")}
                    </FocusableItem>
                </PanelSectionRow>
            )}

            {noticeSlot === "download" && noticeRow}

            {state.updateAvailable && state.patchNotesUrl && (
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="about:patch-notes"
                        onClick={actions.onViewPatchNotes}
                    >
                        {t(state.language, "View Patch Notes")}
                    </FocusableItem>
                </PanelSectionRow>
            )}

            <PanelSectionRow>
                <FocusableItem
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    focusKey="about:check-updates"
                    onClick={actions.onCheckNow}
                >
                    {state.checkingForUpdate
                        ? t(state.language, "Checking...")
                        : t(state.language, "Check for Updates")}
                </FocusableItem>
            </PanelSectionRow>

            {noticeSlot === "check" && noticeRow}

            <SectionTitle label={t(state.language, "Links")} />

            <LinkCard
                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                focusKey="about:github"
                renderIcon={(size) => <GithubIcon size={size} />}
                title={t(state.language, "GitHub")}
                blurb={t(state.language, "Support the project")}
                onClick={actions.onOpenGithub}
            />

            <LinkCard
                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                focusKey="about:kofi"
                renderIcon={(size) => <KofiIcon size={size} />}
                title={t(state.language, "Ko-fi")}
                blurb={t(state.language, "Support my work")}
                onClick={actions.onOpenKofi}
            />

            <LinkCard
                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                focusKey="about:ra-patreon"
                renderIcon={(size) => <PatreonIcon size={size} />}
                title={t(state.language, "RA Patreon")}
                blurb={t(state.language, "Support RetroAchievements")}
                onClick={actions.onOpenRaPatreon}
            />

            <SectionTitle label={t(state.language, "Attributions")} />

            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Icons from Font Awesome Free, redrawn as inline SVG, under the CC BY 4.0 license.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={CC_BY_LICENSE_URL}>
                                {t(state.language, "View the CC BY 4.0 license")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Two Welcome screen glyphs are from Material Design Icons by Google, redrawn as inline SVG, under the Apache License 2.0.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={APACHE_LICENSE_URL}>
                                {t(state.language, "View the Apache 2.0 license")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "The Ko-fi and Patreon marks are from Simple Icons, redrawn as inline SVG, released under CC0 1.0.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={CC0_LICENSE_URL}>
                                {t(state.language, "View the CC0 1.0 dedication")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Also uses react-icons (MIT), plus @decky/ui and @decky/api (both LGPL-2.1) via Decky Loader.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={LGPL_LICENSE_URL}>
                                {t(state.language, "View the LGPL-2.1 license")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Bundles RAHasher (GPL-3.0) and chdman from MAME (GPL-2.0), both run as separate programs. Their license texts ship with the plugin.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={GPL_3_LICENSE_URL}>
                                {t(state.language, "View the GPL-3.0 license")}
                            </AttributionLink>
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={GPL_2_LICENSE_URL}>
                                {t(state.language, "View the GPL-2.0 license")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Reference hashes from libretro-database, compacted and re-saved as gzipped JSON, under the CC BY-SA 4.0 license. Originally compiled by No-Intro, Redump and TOSEC.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={CC_BY_SA_LICENSE_URL}>
                                {t(state.language, "View the CC BY-SA 4.0 license")}
                            </AttributionLink>
                        </div>
                    </div>

                    <div>
                        <div style={{ ...bodyTextStyle() }}>
                            {t(state.language, "Game data from RetroAchievements.")}
                        </div>
                        <div style={{ ...bodyTextStyle(), marginTop: "2px" }}>
                            <AttributionLink url={state.attributionsUrl}>
                                {t(state.language, "Full credits on GitHub")}
                            </AttributionLink>
                        </div>
                    </div>
                </div>
            </PanelSectionRow>
        </PanelSection>
    );
}

export default AboutPage;

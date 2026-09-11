import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { ToggleRow } from "../components/ui/ToggleRow";
import { SmbShareEditModal } from "../components/smb/SmbShareEditModal";
import { useSmbShares } from "../components/smb/SmbSharesContext";
import { ErrorText } from "../components/ui/ErrorText";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { linkSmbMountsToDesktop, logFocusDebug, markNextValidationSkipped, testSmbShare } from "../api";
import { logError } from "../utils/errors";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { showManagedModal } from "../utils/modalRegistry";
import { armSmbFocusReturn } from "../utils/smbFocusReturn";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, SmbShare, ViewKey } from "../types";
import { smbBusyLabel, smbErrorLabel, smbStatusColor, smbStatusLabel, sortSharesByName } from "../utils/smb";
import { regularButtonSpacingStyle, bodyTextStyle } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const SHARE_EDIT_FOCUS_PREFIX = "smbShares:edit:";

const ADD_CLAIM_SLOT = -2;

const ROW_RULE = "1px solid rgba(255, 255, 255, 0.12)";
const ROW_STYLE = {
    borderTop: ROW_RULE,
    paddingTop: "10px",
    marginTop: "10px"
};
const ROW_ACTIONS_STYLE: React.CSSProperties = {
    width: "100%",
    display: "flex",
    gap: "6px",
    margin: "2px 0 8px 0"
};

const ROW_ACTION_HALF: React.CSSProperties = { display: "flex", flex: 1 };

const ROW_ACTION_BUTTON: React.CSSProperties = {
    minWidth: 0,
    width: "100%",
    padding: "10px 12px",
    fontWeight: 800,
    justifyContent: "center"
};

const LAST_ROW_STYLE = {
    ...ROW_STYLE,
    borderBottom: ROW_RULE,
    paddingBottom: "10px",
    marginBottom: "10px"
};

type SmbSharesPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    panelOverlayVisible: boolean;
    restoreFocusKey: string | null;
    restorePending: boolean;
};

type SmbSharesPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onRequestFocus: (focusKey: string) => void;
};

type SmbSharesPageProps = {
    state: SmbSharesPageState;
    actions: SmbSharesPageActions;
};

function SmbSharesPage(props: SmbSharesPageProps) {
    const { state, actions } = props;
    const { language } = state;

    const {
        shares: allShares,
        loaded,
        pendingId,
        rowError,
        toggleEnabled,
        removeShare,
        createShare,
        editShare
    } = useSmbShares();

    const createShareAndAim = async (payload: Parameters<typeof createShare>[0]) => {
        const result = await createShare(payload);
        if (result?.ok && result.share) {
            armSmbFocusReturn(`${SHARE_EDIT_FOCUS_PREFIX}${result.share.id}`);
        }
        return result;
    };

    const openShareModal = (existing: SmbShare | null) => {
        armSmbFocusReturn(existing ? `${SHARE_EDIT_FOCUS_PREFIX}${existing.id}` : "smbShares:add");
        markNextValidationSkipped();
        showManagedModal((close) => (
            <SmbShareEditModal
                existing={existing}
                language={language}
                onCreate={createShareAndAim}
                onUpdate={editShare}
                onTest={(payload, id) => testSmbShare(payload, id)}
                close={close}
            />
        ));
    };

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [forceDeleteId, setForceDeleteId] = useState<string | null>(null);
    const [showLoading, setShowLoading] = useState(false);
    const [linking, setLinking] = useState(false);
    const [linkResult, setLinkResult] = useState<"done" | "failed" | null>(null);
    const rowClaim = useFocusClaim();
    const claimTargetRef = useRef<"edit" | "delete">("delete");

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    const shares = sortSharesByName(allShares, language);

    const restoreFiredRef = useRef(false);
    const restoreSettledRef = useRef(false);
    const [restoreAbandoned, setRestoreAbandoned] = useState(false);

    useEffect(function landRestoredCursor() {
        if (state.view !== "smbShares" || !state.restorePending || restoreFiredRef.current) {
            return;
        }
        if (state.restoreFocusKey === null) {
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug("smb-restore", "(none)", "nothing armed");
            actions.onRequestFocus("smbShares:back");
            return;
        }
        if (state.restoreFocusKey === "smbShares:add") {
            restoreFiredRef.current = true;
            logFocusDebug("smb-restore", state.restoreFocusKey, "claiming Add Mount");
            rowClaim.claimSlot(ADD_CLAIM_SLOT);
            actions.onRequestFocus("smbShares:add");
            return;
        }
        if (!loaded) {
            return;
        }
        restoreFiredRef.current = true;
        const shareId = state.restoreFocusKey.slice(SHARE_EDIT_FOCUS_PREFIX.length);
        const slotIndex = shares.findIndex((share) => share.id === shareId);
        if (slotIndex < 0) {
            setRestoreAbandoned(true);
            logFocusDebug("smb-restore", state.restoreFocusKey, `gone from the list of ${shares.length}`);
            actions.onRequestFocus("smbShares:back");
            return;
        }
        logFocusDebug("smb-restore", state.restoreFocusKey, `slot=${slotIndex} of ${shares.length}`);
        claimTargetRef.current = "edit";
        rowClaim.claimSlot(slotIndex);
        actions.onRequestFocus(state.restoreFocusKey);
    }, [
        state.view,
        state.restorePending,
        state.restoreFocusKey,
        loaded,
        shares,
        rowClaim.claimSlot,
        actions.onRequestFocus
    ]);

    if (state.view !== "smbShares") {
        return null;
    }

    function deleteFocusPlan(share: SmbShare): { kind: "none" } | { kind: "claim"; slotIndex: number } | { kind: "add" } {
        const removedIndex = shares.findIndex((item) => item.id === share.id);
        const remaining = shares.length - 1;
        if (remaining <= 0) {
            return { kind: "add" };
        }
        if (removedIndex < remaining) {
            return { kind: "none" };
        }
        return { kind: "claim", slotIndex: remaining - 1 };
    }

    function handleDelete(share: SmbShare) {
        if (pendingDeleteId !== share.id) {
            setPendingDeleteId(share.id);
            return;
        }
        setPendingDeleteId(null);
        const force = forceDeleteId === share.id;
        setForceDeleteId(null);
        const plan = deleteFocusPlan(share);
        void Promise.resolve(removeShare(share, force)).then((ok) => {
            if (ok === false) {
                setForceDeleteId(share.id);
                return;
            }
            if (plan.kind === "add") {
                rowClaim.claimSlot(ADD_CLAIM_SLOT);
                return;
            }
            if (plan.kind === "none") {
                return;
            }
            claimTargetRef.current = "delete";
            rowClaim.claimSlot(plan.slotIndex);
        });
    }

    function renderRow(share: SmbShare, index: number, isLast: boolean) {
        const pending = pendingId === share.id;
        const error = rowError?.id === share.id ? rowError : null;
        const armed = pendingDeleteId === share.id;
        const forced = forceDeleteId === share.id;
        const claim = rowClaim.claim;
        const claimed = claim?.slotIndex === index;
        const deleteClaimed = claimed && claimTargetRef.current === "delete";
        const editClaimed = claimed && claimTargetRef.current === "edit";

        const editButton = (
            <div data-focus-key={`${SHARE_EDIT_FOCUS_PREFIX}${share.id}`} style={ROW_ACTION_HALF}>
                <DialogButton
                    disabled={pending}
                    style={ROW_ACTION_BUTTON}
                    onClick={() => {
                        setPendingDeleteId(null);
                        openShareModal(share);
                    }}
                >
                    {t(language, "Edit")}
                </DialogButton>
            </div>
        );

        const editAction = editClaimed && claim
            ? (
                <FocusClaim
                    token={claim.token}
                    armed={claim.armed}
                    onSpent={rowClaim.spend}
                    style={ROW_ACTION_HALF}
                >
                    {editButton}
                </FocusClaim>
            )
            : editButton;

        const deleteButton = (
            <div
                data-focus-key={`smbShares:delete:${share.id}`}
                style={ROW_ACTION_HALF}
                onBlurCapture={() => {
                    setPendingDeleteId((current) => (current === share.id ? null : current));
                }}
            >
                <DialogButton
                    disabled={pending}
                    style={ROW_ACTION_BUTTON}
                    onClick={() => handleDelete(share)}
                >
                    {t(language, "Delete")}
                </DialogButton>
            </div>
        );

        const deleteAction = deleteClaimed && claim
            ? (
                <FocusClaim
                    token={claim.token}
                    armed={claim.armed}
                    onSpent={rowClaim.spend}
                    style={ROW_ACTION_HALF}
                >
                    {deleteButton}
                </FocusClaim>
            )
            : deleteButton;

        return (
            <div key={`smbslot:${index}`} style={isLast ? LAST_ROW_STYLE : ROW_STYLE}>
                <ToggleRow
                    label={share.name}
                    value={share.status !== "disabled"}
                    disabled={pending}
                    onChange={(next) => {
                        setPendingDeleteId(null);
                        void toggleEnabled(share, next);
                    }}
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    bottomSeparator="none"
                />

                <PanelSectionRow>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                        <div style={{ ...bodyTextStyle(), opacity: 0.75, wordBreak: "break-word" }}>
                            {`//${share.server}/${share.share}`}
                        </div>
                        <div style={{ ...bodyTextStyle(), opacity: 0.75, wordBreak: "break-all" }}>
                            {share.mountPath}
                        </div>
                        {pending
                            ? <InlineSpinner label={t(language, "Working...")} />
                            : (
                                <div style={{ ...bodyTextStyle(), opacity: 1, color: smbStatusColor(share.status) }}>
                                    {smbStatusLabel(share.status, language, share.statusError)}
                                </div>
                            )}
                        {error && (
                            <ErrorText>
                                {error.code === "busy"
                                    ? smbBusyLabel(error.blockedBy, language)
                                    : smbErrorLabel(error.code, language)}
                            </ErrorText>
                        )}
                        {armed && (
                            <div style={{ ...bodyTextStyle(), opacity: 1, color: "#ff6a6a" }}>
                                {forced
                                    ? t(language, "Press again to force this off and delete it")
                                    : t(language, "Press again to delete")}
                            </div>
                        )}
                    </div>
                </PanelSectionRow>

                <PanelSectionRow>
                    <Focusable flow-children="row" style={ROW_ACTIONS_STYLE}>
                        {editAction}
                        {deleteAction}
                    </Focusable>
                </PanelSectionRow>
            </div>
        );
    }

    if (restoreFiredRef.current && (rowClaim.claim?.token ?? 0) > 0 && !rowClaim.claim?.armed) {
        restoreSettledRef.current = true;
    }
    const restoreSettled = restoreAbandoned || restoreSettledRef.current;

    const page = (
        <PanelSection key={`smbShares:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(language, "SMB Shares")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(language, "Back")}
                focusKey="smbShares:back"
                navAutoFocus={!state.restorePending}
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <PanelSectionRow>
                <FocusableItem
                    focusKey="smbShares:desktopLinks"
                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                    disabled={linking}
                    onClick={async () => {
                        setLinking(true);
                        setLinkResult(null);
                        try {
                            const result = await linkSmbMountsToDesktop();
                            setLinkResult(result?.ok ? "done" : "failed");
                        }
                        catch (e) {
                            logError("linkSmbMountsToDesktop", e);
                            setLinkResult("failed");
                        }
                        finally {
                            setLinking(false);
                        }
                    }}
                    help={t(language, "help_smb_desktop_links")}
                >
                    {t(language, "Links to Desktop")}
                </FocusableItem>
            </PanelSectionRow>
            {linkResult === "done" && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "Your desktop folder is up to date.")}
                    </div>
                </PanelSectionRow>
            )}
            {linkResult === "failed" && (
                <PanelSectionRow>
                    <ErrorText>
                        {t(language, "Couldn't put the folder on your desktop.")}
                    </ErrorText>
                </PanelSectionRow>
            )}

            <FocusClaim
                token={rowClaim.claim?.slotIndex === ADD_CLAIM_SLOT ? rowClaim.claim.token : 0}
                armed={rowClaim.claim?.slotIndex === ADD_CLAIM_SLOT && rowClaim.claim.armed}
                onSpent={rowClaim.spend}
            >
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="smbShares:add"
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        onClick={() => {
                            setPendingDeleteId(null);
                            openShareModal(null);
                        }}
                        help={t(language, "help_smb_persistence")}
                    >
                        {t(language, "Add Mount")}
                    </FocusableItem>
                </PanelSectionRow>
            </FocusClaim>
            {!loaded && showLoading && (
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Checking your mounts...")} />
                </PanelSectionRow>
            )}

            {loaded && shares.length === 0 && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), marginTop: "12px" }}>
                        {t(language, "No mounts yet. Add one to get started.")}
                    </div>
                </PanelSectionRow>
            )}

            {shares.length > 0 && (
                <>
                    <SectionTitle label={t(language, "Mounts")} />
                    {shares.map((share, index) => renderRow(share, index, index === shares.length - 1))}
                </>
            )}
        </PanelSection>
    );

    return (
        <RestoreCurtain
            armed={state.restorePending}
            settled={restoreSettled}
            covered={state.panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default SmbSharesPage;

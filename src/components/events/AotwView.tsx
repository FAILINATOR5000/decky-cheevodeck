import { useMemo } from "react";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../ui/PanelSection";
import { BackButton } from "../ui/BackButton";
import { ErrorText } from "../ui/ErrorText";
import { FocusClaim } from "../ui/FocusClaim";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { PageNavStrip } from "../ui/PageNavStrip";
import { RestoreCurtain } from "../ui/RestoreCurtain";
import { SubTabButton } from "../ui/SubTabButton";
import { AotwHeader } from "../social/AotwHeader";
import { AotwUnlockRow } from "../social/AotwUnlockRow";
import { CommentActionStrip } from "../comments/CommentActionStrip";
import { CommentsList } from "../comments/CommentsList";
import type { RestoredCommentsWindow } from "../../hooks/useCommentsWindow";
import { useThreadSubscription } from "../../hooks/useThreadSubscription";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    AchievementOfTheWeekResponse,
    AotwComment,
    AotwSubView,
    AotwUnlock,
    ButtonSpacing,
    GameComment,
    UiSize
} from "../../types";
import { achievementUiMetrics, bodyTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";

const AOTW_SUB_TABS: { value: AotwSubView; labelKey: string; focusKey: string }[] = [
    { value: "unlocks", labelKey: "Unlocks", focusKey: "aotw:subtab:unlocks" },
    { value: "comments", labelKey: "Comments", focusKey: "aotw:subtab:comments" }
];

export type AotwViewProps = {
    aotwResponse: AchievementOfTheWeekResponse | null;
    aotwSubView: AotwSubView;
    aotwLoading: boolean;
    aotwError: string | null;
    onChangeAotwSubView: (subView: AotwSubView) => void;
    onOpenUserProfile: (username: string, ulid?: string | null) => void | Promise<void>;
    onOpenAotwComment: (comment: AotwComment, achievementId: number | null) => void | Promise<void>;
    aotwComments: GameComment[];
    aotwCommentsLoading: boolean;
    aotwCommentsLoadingMore: boolean;
    aotwCommentsError: string | null;
    aotwCommentsHasMore: boolean;
    aotwCommentsSort: "newest" | "oldest";
    aotwCommentsLoaded: boolean;
    aotwCommentsCardClaim?: {
        slotIndex: number;
        token: number;
        armed: boolean;
    };
    onSpendAotwCommentsCardClaim: () => void;
    aotwCommentsPostClaim?: {
        token: number;
        armed: boolean;
    };
    onSpendAotwCommentsPostClaim: () => void;
    aotwRestorePending: boolean;
    aotwHoldCommentsBody: boolean;
    aotwCommentsWindow: RestoredCommentsWindow | null;
    onChangeAotwCommentsSort: (sort: "newest" | "oldest") => void;
    onLoadMoreAotwComments: () => void | Promise<void>;
    onPostAotwComment: () => void | Promise<void>;
    onOpenGameOverview?: (gameId: number) => void | Promise<void>;
};

type AotwViewPageProps = {
    language: LanguageCode;
    aotw: AotwViewProps;
    uiSize: UiSize;
    showIcons: boolean;
    buttonSpacing: ButtonSpacing;
    dynamicComments: boolean;
    dynamicCommentsSentinelRootMargin: number;
    panelOverlayVisible: boolean;
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

export function AotwView(props: AotwViewPageProps) {
    const { language, aotw, uiSize, showIcons, dynamicComments, dynamicCommentsSentinelRootMargin } = props;
    const rowMetrics = useMemo(() => achievementUiMetrics(uiSize), [uiSize]);

    const aotwPayload = aotw.aotwResponse?.payload ?? null;
    const aotwSubscription = useThreadSubscription({
        language,
        kind: "achievement",
        id: aotwPayload?.achievement?.id ?? null,
        buildEntry: () => {
            const achievementId = aotwPayload?.achievement?.id ?? null;
            if (!aotwPayload || achievementId == null) {
                return null;
            }
            return {
                kind: "achievement",
                id: achievementId,
                gameId: aotwPayload.game?.id ?? achievementId,
                title: aotwPayload.achievement.title ?? "",
                gameTitle: aotwPayload.game?.title ?? "",
                console: aotwPayload.console?.title ?? "",
                iconUrl: aotwPayload.achievement.badgeUrl ?? "",
                badgeName: aotwPayload.achievement.badgeName ?? "",
                seedComments: aotw.aotwComments,
                seedSort: aotw.aotwCommentsSort,
                seedLoaded: aotw.aotwCommentsLoaded
            };
        }
    });

    function handleAotwSortCycle() {
        if (!aotw.aotwCommentsLoaded) {
            return;
        }
        aotw.onChangeAotwCommentsSort(aotw.aotwCommentsSort === "newest" ? "oldest" : "newest");
    }

    const aotwCardClaim = aotw.aotwCommentsCardClaim ?? aotw.aotwCommentsPostClaim;
    const restoreSettled = !aotw.aotwHoldCommentsBody
        && (aotwCardClaim?.token ?? 0) > 0
        && !aotwCardClaim?.armed;

    const page = (
        <PanelSection>
            <PageNavStrip
                title={t(language, "Achievement of the Week")}
                buttonSpacing={props.buttonSpacing}
                onHome={props.onHome}
            />
            <BackButton
                label={t(language, "← Back")}
                focusKey="eventviewer:back"
                navAutoFocus={!aotw.aotwRestorePending}
                buttonSpacing={props.buttonSpacing}
                onClick={props.onBack}
            />
            <>
                {aotw.aotwError && aotw.aotwResponse && (
                    <PanelSectionRow>
                        <ErrorText>
                            {localizeRuntimeText(language, aotw.aotwError)}
                        </ErrorText>
                    </PanelSectionRow>
                )}
                {aotw.aotwError && !aotw.aotwResponse ? (
                    <PanelSectionRow>
                        <ErrorText>
                            {t(language, "Couldn't load the Achievement of the Week.")}
                        </ErrorText>
                    </PanelSectionRow>
                ) : aotw.aotwLoading && !aotw.aotwResponse ? (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading...")} />
                    </PanelSectionRow>
                ) : aotw.aotwResponse ? (
                    <>
                        {aotw.aotwResponse.payload && (
                            <AotwHeader
                                payload={aotw.aotwResponse.payload}
                                currentUserHasUnlocked={
                                    aotw.aotwResponse.currentUserHasUnlocked
                                }
                                language={language}
                                uiSize={uiSize}
                                showIcons={showIcons}
                                onClickGameTitle={(() => {
                                    const gameId = aotw.aotwResponse.payload?.game?.id ?? null;
                                    const handler = aotw.onOpenGameOverview;
                                    if (gameId == null || !handler) {
                                        return undefined;
                                    }
                                    return () => handler(gameId);
                                })()}
                            />
                        )}
                        <Focusable
                            flow-children="row"
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: "6px",
                                margin: "6px 0 4px 0"
                            }}
                        >
                            {AOTW_SUB_TABS.map((tab) => (
                                <SubTabButton
                                    key={tab.value}
                                    label={t(language, tab.labelKey)}
                                    active={aotw.aotwSubView === tab.value}
                                    onClick={() => aotw.onChangeAotwSubView(tab.value)}
                                    focusKey={tab.focusKey}
                                />
                            ))}
                        </Focusable>
                        <Focusable key={`aotw:tab:${aotw.aotwSubView}`}>
                            {aotw.aotwSubView === "unlocks" ? (
                                (aotw.aotwResponse.payload?.unlocks?.length ?? 0) === 0 ? (
                                    <PanelSectionRow>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "6px",
                                                alignItems: "center",
                                                textAlign: "center"
                                            }}
                                        >
                                            <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                                {t(language, "No unlocks yet.")}
                                            </div>
                                        </div>
                                    </PanelSectionRow>
                                ) : (
                                    <>
                                        {aotw.aotwResponse.payload?.unlocks.map((unlock, index) => (
                                            <AotwUnlockRow
                                                key={`${unlock.user}:${unlock.dateAwarded}:${index}`}
                                                unlock={unlock}
                                                language={language}
                                                metrics={rowMetrics}
                                                showIcons={showIcons}
                                                focusKey={`aotw:unlock:${index}`}
                                                onClick={(u: AotwUnlock) =>
                                                    aotw.onOpenUserProfile(u.user, u.ulid)
                                                }
                                            />
                                        ))}
                                    </>
                                )
                            ) : (
                                aotw.aotwHoldCommentsBody
                                    && !aotw.aotwCommentsLoaded ? (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(language, "Loading comments...")} />
                                    </PanelSectionRow>
                                ) : (aotw.aotwCommentsLoaded
                                    && aotw.aotwComments.length === 0
                                    && !aotw.aotwCommentsLoading
                                    && !aotw.aotwCommentsError) ? (
                                    <>
                                        <PanelSectionRow>
                                            <div style={bodyTextStyle()}>
                                                {t(language, "No comments yet.")}
                                            </div>
                                        </PanelSectionRow>
                                        {aotwSubscription.subscribeError ? (
                                            <PanelSectionRow>
                                                <ErrorText>{localizeRuntimeText(language, aotwSubscription.subscribeError)}</ErrorText>
                                            </PanelSectionRow>
                                        ) : null}
                                        <FocusClaim
                                            token={aotw.aotwCommentsPostClaim?.token ?? 0}
                                            armed={aotw.aotwCommentsPostClaim?.armed ?? false}
                                            onSpent={aotw.onSpendAotwCommentsPostClaim}
                                        >
                                            <CommentActionStrip
                                                language={language}
                                                isSubscribed={aotwSubscription.isSubscribed}
                                                onPost={aotw.onPostAotwComment}
                                                onToggleSubscribe={aotwSubscription.onToggleSubscribe}
                                                postFocusKey="aotw:comments:post"
                                                subscribeFocusKey="aotw:comments:subscribe"
                                            />
                                        </FocusClaim>
                                    </>
                                ) : (
                                    <>
                                        {aotwSubscription.subscribeError ? (
                                            <PanelSectionRow>
                                                <ErrorText>{localizeRuntimeText(language, aotwSubscription.subscribeError)}</ErrorText>
                                            </PanelSectionRow>
                                        ) : null}
                                        <FocusClaim
                                            token={aotw.aotwCommentsPostClaim?.token ?? 0}
                                            armed={aotw.aotwCommentsPostClaim?.armed ?? false}
                                            onSpent={aotw.onSpendAotwCommentsPostClaim}
                                        >
                                            <CommentActionStrip
                                                language={language}
                                                isSubscribed={aotwSubscription.isSubscribed}
                                                onPost={aotw.onPostAotwComment}
                                                onToggleSubscribe={aotwSubscription.onToggleSubscribe}
                                                postFocusKey="aotw:comments:post"
                                                subscribeFocusKey="aotw:comments:subscribe"
                                            />
                                        </FocusClaim>
                                        <LabeledRow
                                            focusKey="aotw:comments:sort"
                                            onClick={handleAotwSortCycle}
                                            label={t(language, "Sort")}
                                            value={aotw.aotwCommentsSort === "newest"
                                                ? t(language, "Newest")
                                                : t(language, "Oldest")}
                                        />
                                        <CommentsList
                                            comments={aotw.aotwComments}
                                            language={language}
                                            uiSize={uiSize}
                                            showIcons={showIcons}
                                            focusKeyPrefix="aotw:comment"
                                            surfaceKey="comments:aotw"
                                            onCommentClick={(c) =>
                                                aotw.onOpenAotwComment(
                                                    c,
                                                    aotw.aotwResponse?.payload?.achievement?.id ?? null
                                                )
                                            }
                                            dynamicLoading={dynamicComments}
                                            dynamicSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                            loading={aotw.aotwCommentsLoading}
                                            loadingMore={aotw.aotwCommentsLoadingMore}
                                            hasMore={aotw.aotwCommentsHasMore}
                                            error={aotw.aotwCommentsError}
                                            onLoadMore={aotw.onLoadMoreAotwComments}
                                            emptyMessage={t(language, "No comments yet.")}
                                            claimedCard={aotw.aotwCommentsCardClaim && {
                                                ...aotw.aotwCommentsCardClaim,
                                                onSpent: aotw.onSpendAotwCommentsCardClaim
                                            }}
                                            restoredWindow={aotw.aotwCommentsWindow}
                                        />
                                    </>
                                )
                            )}
                        </Focusable>
                    </>
                ) : null}
            </>
        </PanelSection>
    );

    return (
        <RestoreCurtain armed={aotw.aotwRestorePending} settled={restoreSettled} covered={props.panelOverlayVisible}>
            {page}
        </RestoreCurtain>
    );
}

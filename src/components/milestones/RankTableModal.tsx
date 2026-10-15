import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { RankEmblem, rankNumeral } from "./RankEmblem";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { MilestoneRank } from "../../types";
import { modalSize } from "../../utils/scale";
import { skyBlue } from "../../utils/style";

export function rankName(language: LanguageCode, rank: MilestoneRank): string {
    return t(language, `rank_tier_${rank.tier}`, { numeral: rankNumeral(rank.step) });
}

export function RankTableModal(props: { language: LanguageCode; ranks: MilestoneRank[]; current: number; close: () => void }) {
    const { language, ranks, current, close } = props;
    const emblem = Math.round(modalSize(32));
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 700 }}>{t(language, "Ranks")}</div>
                <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {ranks.map((rank, index) => {
                        const reached = index <= current;
                        return (
                            <DialogButton
                                key={`${rank.tier}:${rank.step}`}
                                onClick={() => { }}
                                autoFocus={index === current}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    padding: "6px 10px",
                                    minWidth: 0,
                                    opacity: reached ? 1 : 0.45,
                                    outline: index === current ? `2px solid ${skyBlue}` : undefined
                                }}
                            >
                                <RankEmblem tier={rank.tier} step={rank.step} size={emblem} />
                                <span style={{ flex: 1, textAlign: "left", fontSize: `${modalSize(15)}px`, fontWeight: 800 }}>
                                    {rankName(language, rank)}
                                </span>
                                {index === current && (
                                    <span style={{ fontSize: `${modalSize(12)}px`, fontWeight: 700, color: skyBlue }}>
                                        {t(language, "Your Rank")}
                                    </span>
                                )}
                                <span style={{ fontSize: `${modalSize(13)}px`, opacity: 0.85 }}>
                                    {t(language, "{{xp}} XP", { xp: rank.xp.toLocaleString() })}
                                </span>
                            </DialogButton>
                        );
                    })}
                </Focusable>
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </div>
        </ModalRoot>
    );
}

import type { ReactNode } from "react";
import { bodyTextStyle, helpTextBlue, modalBodyStyle } from "../../utils/style";
import { modalSize, textSize } from "../../utils/scale";

export function helpDescription(help: ReactNode, modal = false): ReactNode {
    if (!help) {
        return undefined;
    }
    const size = modal ? modalSize(12) : textSize(12);
    return <span style={{ fontSize: `${size}px` }}>{help}</span>;
}

export type InfoTextProps = {
    children: ReactNode;
    separator?: boolean;
    centered?: boolean;
    modal?: boolean;
};

export function InfoText(props: InfoTextProps) {
    const { children, separator = false, centered = false, modal = false } = props;
    return (
        <div
            style={{
                ...(modal ? modalBodyStyle() : bodyTextStyle()),
                color: helpTextBlue,
                textAlign: centered ? "center" : undefined,
                borderBottom: separator ? "1px solid rgba(255, 255, 255, 0.12)" : undefined,
                paddingBottom: separator ? "10px" : undefined,
                marginBottom: separator ? "2px" : undefined
            }}
        >
            {children}
        </div>
    );
}

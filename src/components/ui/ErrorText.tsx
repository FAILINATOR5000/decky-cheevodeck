import type { ReactNode } from "react";
import { bodyTextStyle, modalBodyStyle } from "../../utils/style";

export type ErrorTextProps = {
    children: ReactNode;
    modal?: boolean;
};

export function ErrorText(props: ErrorTextProps) {
    return (
        <div style={{ ...(props.modal ? modalBodyStyle() : bodyTextStyle()), color: "#ff8080" }}>
            {props.children}
        </div>
    );
}

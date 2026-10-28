import { memo, type FunctionComponent } from "react";

export function skipWhileHidden<P extends object>(page: FunctionComponent<P>, shows: (props: Readonly<P>) => boolean) {
    return memo(page, (prev, next) => !shows(prev) && !shows(next));
}

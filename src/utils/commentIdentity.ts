import type { AotwComment, GameComment } from "../types";

export function commentIdentity(comment: Pick<AotwComment | GameComment, "user" | "submitted" | "commentText">): string {
    return `${comment.user ?? ""}|${comment.submitted ?? ""}|${comment.commentText ?? ""}`;
}

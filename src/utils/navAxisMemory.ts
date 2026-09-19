export type NavAxisRef = {
    current: {
        m_node?: {
            m_Tree?: {
                m_lastFocusNodeXMovement?: { Reset?: () => void };
                m_lastFocusNodeYMovement?: { Reset?: () => void };
            };
        };
    } | null;
};

export function forgetNavAxisMemory(navRef: NavAxisRef) {
    const tree = navRef.current?.m_node?.m_Tree;
    tree?.m_lastFocusNodeXMovement?.Reset?.();
    tree?.m_lastFocusNodeYMovement?.Reset?.();
}

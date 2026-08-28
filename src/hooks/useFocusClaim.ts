import { useCallback, useState } from "react";

export type FocusClaimController = {
    claim: { slotIndex: number; token: number; armed: boolean } | null;
    claimSlot: (slotIndex: number) => void;
    spend: () => void;
};

export function useFocusClaim(): FocusClaimController {
    const [claim, setClaim] = useState<{ slotIndex: number; token: number; armed: boolean } | null>(null);

    const claimSlot = useCallback((slotIndex: number) => {
        window.setTimeout(() => {
            setClaim((current) => ({ slotIndex, token: (current?.token ?? 0) + 1, armed: true }));
        }, 0);
    }, []);

    const spend = useCallback(() => {
        setClaim((current) => (current?.armed ? { ...current, armed: false } : current));
    }, []);

    return { claim, claimSlot, spend };
}

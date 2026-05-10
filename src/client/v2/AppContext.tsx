import type { ReactNode } from 'react';
import { useConsoleSubscription, useRuntimeSubscription } from '@/client/v2/api/index.js';

export const AppContext = ({children}: { children: ReactNode }) => {
    // All subscriptions.
    useRuntimeSubscription();
    useConsoleSubscription();

    // Any context providers will also go here.
    return (
        <>
            {children}
        </>
    );
};
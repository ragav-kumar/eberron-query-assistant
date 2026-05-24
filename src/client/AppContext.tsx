import { ReactNode } from 'react';
import { useConsoleSubscription, useRuntimeSubscription } from '@/client/api/index.js';
import { SessionProvider } from './components/SessionContext/index.js';

export const AppContext = ({children}: { children: ReactNode }) => {
    // All subscriptions.
    useRuntimeSubscription();
    useConsoleSubscription();

    // Any context providers will also go here.
    return (
        <SessionProvider>
            {children}
        </SessionProvider>
    );
};
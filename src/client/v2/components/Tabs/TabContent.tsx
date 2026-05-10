import type { ReactNode } from 'react';

export interface TabContentProps {
    children: ReactNode;
    tabKey: string;
    className?: string | undefined;
}

export const TabContent = (_: TabContentProps) => null;
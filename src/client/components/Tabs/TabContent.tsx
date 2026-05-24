import { ReactNode } from 'react';

export interface TabContentProps<T extends string> {
    children: ReactNode;
    tabKey: T;
    className?: string | undefined;
}

export const TabContent = <T extends string>(_: TabContentProps<T>) => null;
export interface TabButtonProps<T extends string> {
    children: string;
    tabKey: T;
}

export const TabButton = <T extends string>(_: TabButtonProps<T>) => null;
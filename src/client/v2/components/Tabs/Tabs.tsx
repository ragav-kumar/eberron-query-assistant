import { ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import { TabButtonProps, TabButton } from './TabButton.js';
import { TabContentProps, TabContent } from './TabContent.js';
import styles from './Tabs.module.css';
import { joinClassNames, unwrapFragment } from '@/client/v2/utils.js';

interface TabsProps<T> {
    children: ReactNode;
    className?: string | undefined;
    contentClassName?: string | undefined;
    currentTabKey: T;
    onTabChanged: (tabKey: T) => void;
}

export const Tabs = <T extends string>({children, className, contentClassName, currentTabKey, onTabChanged}: TabsProps<T>) => {
    const tabButtons: TabButtonProps<T>[] = [];
    const tabContents: TabContentProps<T>[] = [];
    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            const unwrapped = unwrapFragment(child);
            for (const unwrappedElement of unwrapped) {
                if (unwrappedElement.type === TabButton) {
                    tabButtons.push(unwrappedElement.props as TabButtonProps<T>);
                } else if (unwrappedElement.type === TabContent) {
                    tabContents.push(unwrappedElement.props as TabContentProps<T>);
                }
            }
        }
    });

    return (
        <div className={joinClassNames(styles.wrap, className)}>
            <div className={styles.buttonWrap}>
                {tabButtons.map((tabButton) => (
                    <div
                        className={joinClassNames(styles.button, currentTabKey === tabButton.tabKey ? styles.active : null)}
                        key={tabButton.tabKey}
                        onClick={() => onTabChanged(tabButton.tabKey)}
                    >
                        {tabButton.children}
                    </div>
                ))}
            </div>
            <div className={joinClassNames(styles.contentWrap, contentClassName)}>
            {tabContents.map(tabContent => (
                <div
                    key={tabContent.tabKey}
                    className={joinClassNames(
                        styles.content,
                        currentTabKey === tabContent.tabKey ? styles.active : null,
                        tabContent.className
                    )}
                >
                    <div className={styles.contentBody}>
                        {tabContent.children}
                    </div>
                </div>
            ))}
            </div>
        </div>
    );
};

import type { ReactNode} from 'react';
import { useState, Children, isValidElement } from 'react';
import type { TabButtonProps } from './TabButton.js';
import { TabButton } from './TabButton.js';
import type { TabContentProps } from './TabContent.js';
import { TabContent } from './TabContent.js';
import styles from './Tabs.module.css';
import { joinClassNames } from '@/client/v2/utils.js';

interface TabsProps {
    defaultKey: string;
    children: ReactNode;
    className?: string | undefined;
}

export const Tabs = ({children, className, defaultKey}: TabsProps) => {
    const [currentTabKey, setCurrentTabKey] = useState<string>(defaultKey);

    const tabButtons: TabButtonProps[] = [];
    const tabContents: TabContentProps[] = [];
    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            if (child.type === TabButton) {
                tabButtons.push(child.props as TabButtonProps);
            } else if (child.type === TabContent) {
                tabContents.push(child.props as TabContentProps);
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
                        onClick={() => setCurrentTabKey(tabButton.tabKey)}
                    >
                        {tabButton.children}
                    </div>
                ))}
            </div>
            {tabContents.map(tabContent => (
                <div
                    key={tabContent.tabKey}
                    className={joinClassNames(
                        styles.content,
                        currentTabKey === tabContent.tabKey ? styles.active : null,
                        tabContent.className
                    )}
                >
                    {tabContent.children}
                </div>
            ))}
        </div>
    );
};

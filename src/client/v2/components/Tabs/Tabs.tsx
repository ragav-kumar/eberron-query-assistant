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
}

export const Tabs = ({children, defaultKey}: TabsProps) => {
    const [currentTabKey, setCurrentTabKey] = useState<string>(defaultKey);

    const tabButtons: { key: string, label: string }[] = [];
    const tabContents: { key: string, content: ReactNode }[] = [];
    Children.forEach(children, (child) => {
        if (isValidElement(child)) {
            if (child.type === TabButton) {
                const childProps = child.props as TabButtonProps;
                tabButtons.push({ key: childProps.tabKey, label: childProps.children });
            } else if (child.type === TabContent) {
                const childProps = child.props as TabContentProps;
                tabContents.push({ key: childProps.tabKey, content: childProps.children });
            }
        }
    });

    const currentContent = tabContents.find((content) => content.key === currentTabKey)?.content;

    return (
        <div className={styles.wrap}>
            <div className={styles.buttonWrap}>
                {tabButtons.map((tabKey) => (
                    <div
                        className={joinClassNames(styles.button, currentTabKey === tabKey.key ? styles.active : null)}
                        key={tabKey.key}
                        onClick={() => setCurrentTabKey(tabKey.key)}
                    >
                        {tabKey.label}
                    </div>
                ))}
            </div>
            {tabContents.map(tabContent => (
                <div
                    key={tabContent.key}
                    className={joinClassNames(styles.content, currentTabKey === tabContent.key ? styles.active : null)}
                >
                    {tabContent.content}
                </div>
            ))}
        </div>
    );
};

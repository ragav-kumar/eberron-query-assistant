import { ReactNode } from 'react';
import { defaultTabKey, tabDefinitionList, tabDefinitions } from './SessionContext/tabDefinitions.js';
import { Tabs } from './Tabs/index.js';
import { SessionSelector } from './SessionSelector.js';
import { useSessionContext } from './SessionContext/index.js';

interface RightColumnTabsProps {
    className?: string | undefined;
}

export const RightColumnTabs = ({className}: RightColumnTabsProps) => {
    const { changeActiveTab, activeTabState } = useSessionContext();

    const components: ReactNode[] = [];
    for (const tabDefinition of tabDefinitionList) {
        components.push(
            <Tabs.Button tabKey={tabDefinition.key}>
                {tabDefinition.label}
            </Tabs.Button>
        );

        const ContentComponent = tabDefinitions[tabDefinition.key].component;
        components.push(
            <Tabs.Content tabKey={tabDefinition.key}>
                <SessionSelector />
                <ContentComponent/>
            </Tabs.Content>,
        );
    }

    return (
        <Tabs
            currentTabKey={activeTabState.key || defaultTabKey}
            className={className}
            onTabChanged={changeActiveTab}
        >
            {components}
        </Tabs>
    );
};
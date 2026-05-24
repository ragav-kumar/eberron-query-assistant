import { Fragment } from 'react';
import { defaultTabKey, tabDefinitionList } from './SessionContext/tabDefinitions.js';
import { Tabs } from './Tabs/index.js';
import { SessionSelector } from './SessionSelector.js';
import { useSessionContext } from './SessionContext/index.js';
import { Assistant } from './Assistant/index.js';
import { NpcCards } from './NpcCards/index.js';

interface RightColumnTabsProps {
    className?: string | undefined;
}

export const RightColumnTabs = ({className}: RightColumnTabsProps) => {
    const {changeActiveTab, activeTabState} = useSessionContext();

    return (
        <Tabs
            currentTabKey={activeTabState.key || defaultTabKey}
            className={className}
            onTabChanged={changeActiveTab}
        >
            {tabDefinitionList.map(tabDefinition => (
                <Fragment key={tabDefinition.key}>
                    <Tabs.Button tabKey={tabDefinition.key}>
                        {tabDefinition.label}
                    </Tabs.Button>
                    <Tabs.Content tabKey={tabDefinition.key}>
                        <SessionSelector mode={tabDefinition.key}/>
                        <RightColumnTabContent tabKey={tabDefinition.key}/>
                    </Tabs.Content>
                </Fragment>
            ))}
        </Tabs>
    );
};

interface RightColumnTabContentProps {
    tabKey: string;
}

const RightColumnTabContent = ({tabKey}: RightColumnTabContentProps) => {
    switch (tabKey) {
        case 'assistant':
            return <Assistant/>;
        case 'npc':
            return <NpcCards/>;
        default:
            // Not reachable.
            return null;
    }
};
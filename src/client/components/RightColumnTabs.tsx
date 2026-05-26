import { Fragment } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { defaultTabKey, tabDefinitionList } from './SessionContext/tabDefinitions.js';
import { Tabs } from './Tabs/index.js';
import { SessionSelector } from './SessionSelector.js';
import { useSessionContext } from './SessionContext/index.js';
import { Assistant } from './Assistant/index.js';
import { NpcCards, NpcExchangeFeed } from './NpcCards/index.js';
import styles from './RightColumnTabs.module.css';

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
            return (
                <div className={styles.npcTabContainer}>
                    <Group orientation='vertical'>
                        <Panel defaultSize='75%' minSize='5rem'>
                            <NpcCards />
                        </Panel>
                        <Separator className={styles.feedResizeHandle} aria-label='Resize NPC exchange feed' />
                        <Panel defaultSize='25%' minSize='4rem'>
                            <NpcExchangeFeed />
                        </Panel>
                    </Group>
                </div>
            );
        default:
            // Not reachable.
            return null;
    }
};
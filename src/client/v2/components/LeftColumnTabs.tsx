import styles from '../App.module.css';
import { Tabs } from './Tabs/index.js';
import { Input } from './Input/index.js';
import { AdditionalContextInput } from './AdditionalContextInput.js';
import { useState } from 'react';

export const LeftColumnTabs = () => {
    const [currentTabKey, setCurrentTabKey] = useState<'input' | 'additional-context'>('input');

    return (
        <Tabs
            currentTabKey={currentTabKey}
            className={styles.leftTabs}
            onTabChanged={setCurrentTabKey}
        >
            <Tabs.Button tabKey='input'>Input</Tabs.Button>
            <Tabs.Button tabKey='additional-context'>Additional Context</Tabs.Button>
            <Tabs.Content tabKey='input'>
                <Input />
            </Tabs.Content>
            <Tabs.Content tabKey='additional-context'>
                <AdditionalContextInput />
            </Tabs.Content>
        </Tabs>
    );
};
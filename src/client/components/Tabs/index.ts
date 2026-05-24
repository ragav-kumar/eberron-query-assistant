import { Tabs as TabsRoot } from './Tabs.js';
import { TabButton } from './TabButton.js';
import { TabContent } from './TabContent.js';

type TabsCompoundComponent = typeof TabsRoot & {
    Button: typeof TabButton;
    Content: typeof TabContent;
};

export const Tabs: TabsCompoundComponent = Object.assign(TabsRoot, {
    Button: TabButton,
    Content: TabContent,
});
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import styles from './App.module.css';
import { Tabs } from './components/Tabs/index.js';
import { LeftColumnHeader } from './components/LeftColumnHeader.js';
import { Console } from './components/Console.js';
import { AppContext } from '@/client/v2/AppContext.js';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
            staleTime: 30000,
        }
    }
});

/**
 * V2 UI entry stub.
 * Future UI work should start by reading `src/client/api.ts`, which documents
 * the browser-to-runtime contract this tree is expected to use.
 */
export const App = () => (
    <QueryClientProvider client={queryClient}>
        <AppContext>
            <main className={styles.wrap}>
                <title>Eberron Query Assistant V2</title>
                <section className={styles.column}>
                    <LeftColumnHeader />
                    <Tabs defaultKey='input' className={styles.leftTabs}>
                        <Tabs.Button tabKey='input'>Input</Tabs.Button>
                        <Tabs.Button tabKey='Additional Context'>Additional Context</Tabs.Button>
                        <Tabs.Content tabKey='input'>
                            <p>TODO - Input</p>
                        </Tabs.Content>
                        <Tabs.Content tabKey='Additional Context'>
                            <p>TODO - Additional Context</p>
                        </Tabs.Content>
                    </Tabs>
                </section>
                <section className={styles.column}>
                    <Tabs defaultKey='assistant' className={styles.rightTabs}>
                        <Tabs.Button tabKey='assistant'>Assistant</Tabs.Button>
                        <Tabs.Button tabKey='npc'>NPC Cards</Tabs.Button>
                        <Tabs.Content tabKey='assistant'>
                            <p>TODO - Assistant</p>
                        </Tabs.Content>
                        <Tabs.Content tabKey='npc'>
                            <p>TODO - NPC Cards</p>
                        </Tabs.Content>
                    </Tabs>
                    <Console />
                </section>
            </main>
        </AppContext>
    </QueryClientProvider>
);

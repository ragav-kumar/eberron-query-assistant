import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Group, Panel, Separator } from 'react-resizable-panels';
import './themes.css';
import './global.css';
import styles from './App.module.css';
import { LeftColumnHeader } from './components/LeftColumnHeader.js';
import { Console } from './components/Console.js';
import { AppContext } from './AppContext.js';
import { RightColumnTabs } from './components/RightColumnTabs.js';
import { LeftColumnTabs } from './components/LeftColumnTabs.js';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
            staleTime: 30000,
        }
    }
});

export const App = () => (
    <QueryClientProvider client={queryClient}>
        <AppContext>
            <main className={styles.wrap}>
                <title>Eberron Query Assistant</title>
                <Group orientation='horizontal'>
                    <Panel defaultSize='50%' minSize='200px'>
                        <section className={styles.column}>
                            <LeftColumnHeader />
                            <div className={styles.leftPanelContainer}>
                                <Group orientation='vertical'>
                                    <Panel defaultSize='78%' minSize='6rem'>
                                        <div className={styles.panelFill}>
                                            <LeftColumnTabs />
                                        </div>
                                    </Panel>
                                    <Separator
                                        className={styles.consoleResizeHandle}
                                        aria-label='Resize console'
                                    />
                                    <Panel defaultSize='22%' minSize='4rem'>
                                        <Console />
                                    </Panel>
                                </Group>
                            </div>
                        </section>
                    </Panel>
                    <Separator
                        className={styles.columnResizeHandle}
                        aria-label='Resize columns'
                    />
                    <Panel defaultSize='50%' minSize='200px'>
                        <section className={styles.column}>
                            <RightColumnTabs className={styles.rightTabs} />
                        </section>
                    </Panel>
                </Group>
            </main>
        </AppContext>
    </QueryClientProvider>
);

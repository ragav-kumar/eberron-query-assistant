import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
                <section className={styles.column}>
                    <LeftColumnHeader />
                    <LeftColumnTabs />
                    <Console />
                </section>
                <section className={styles.column}>
                    <RightColumnTabs className={styles.rightTabs} />
                </section>
            </main>
        </AppContext>
    </QueryClientProvider>
);
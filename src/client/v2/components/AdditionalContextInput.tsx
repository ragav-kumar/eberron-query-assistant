import {
    BoldItalicUnderlineToggles,
    headingsPlugin,
    listsPlugin,
    markdownShortcutPlugin,
    MDXEditor,
    quotePlugin,
    toolbarPlugin,
    UndoRedo,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useAdditionalContextMutation, useAdditionalContextQuery } from '@/client/v2/api/index.js';
import { joinClassNames } from '@/client/v2/utils.js';
import styles from './AdditionalContextInput.module.css';

export const AdditionalContextInput = () => {
    const query = useAdditionalContextQuery();
    const { mutate, isPending } = useAdditionalContextMutation();
    const isEditorDisabled = query.isLoading;
    const markdown = query.data ?? '';

    return (
        <section className={styles.wrap} aria-labelledby='additional-context-heading'>
            <header className={styles.header}>
                <h2 id='additional-context-heading'>Additional Context</h2>
                <span className={styles.status}>
                    {renderStatus(query.isLoading, query.isError, isPending)}
                </span>
            </header>
            {query.isError ? (
                <div className={styles.error} role='status'>
                    Unable to load additional context.
                </div>
            ) : query.isLoading && query.data == null ? (
                <div className={styles.loading} role='status'>
                    Loading context
                </div>
            ) : (
                <MDXEditor
                    key={query.data == null ? 'empty' : 'loaded'}
                    className={joinClassNames(styles.editor, 'dark-theme')}
                    markdown={markdown}
                    onChange={md => mutate(md)}
                    contentEditableClassName={styles.contentEditable ?? ''}
                    placeholder='Add local campaign notes, tone guidance, or assistant-only reminders here.'
                    readOnly={isEditorDisabled}
                    plugins={[
                        headingsPlugin(),
                        listsPlugin(),
                        quotePlugin(),
                        markdownShortcutPlugin(),
                        toolbarPlugin({
                            toolbarContents: () => (
                                <>
                                    <UndoRedo />
                                    <BoldItalicUnderlineToggles />
                                </>
                            ),
                        }),
                    ]}
                />
            )}
        </section>
    );
};

const renderStatus = (isLoading: boolean, isError: boolean, isPending: boolean): string => {
    if (isLoading) {
        return 'Loading context...';
    }

    if (isError) {
        return 'Context unavailable';
    }

    return isPending ? 'Saving...' : 'Saved';
};

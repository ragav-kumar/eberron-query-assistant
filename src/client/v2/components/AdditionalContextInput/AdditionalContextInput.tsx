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
import { useAdditionalContextMutation, useAdditionalContextQuery } from '../../api/index.js';

export const AdditionalContextInput = () => {
    const { data } = useAdditionalContextQuery();
    const { mutate } = useAdditionalContextMutation();

    return (
        <div>
            <div>Title and status</div>
            <MDXEditor
                markdown={data ?? ''}
                onChange={md => mutate(md)}
                contentEditableClassName='context-editor'
                plugins={[
                    headingsPlugin(),
                    listsPlugin(),
                    quotePlugin(),
                    markdownShortcutPlugin(),
                    toolbarPlugin({
                        toolbarContents: () => (
                            <>
                                <UndoRedo/>
                                <BoldItalicUnderlineToggles/>
                            </>
                        ),
                    }),
                ]}
            />
        </div>
    );
};
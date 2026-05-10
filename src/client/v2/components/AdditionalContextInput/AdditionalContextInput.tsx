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

export const AdditionalContextInput = () => {

    return (
        <div>
            <div>Title and status</div>
            <MDXEditor
                markdown={/*TODO*/}
                onChange={/*TODO*/}
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
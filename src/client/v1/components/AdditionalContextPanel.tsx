import {
  BoldItalicUnderlineToggles,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

interface AdditionalContextPanelProps {
  isLoaded: boolean;
  markdown: string;
  onChange: (markdown: string) => void;
  saveState: string;
}

/** Renders the autosaved local Markdown editor used as additional assistant context. */
export const AdditionalContextPanel = ({ isLoaded, markdown, onChange, saveState }: AdditionalContextPanelProps) => (
  <section className='panel context-panel' aria-labelledby='context-heading'>
    <div className='panel-heading'>
      <h2 id='context-heading'>Additional Context</h2>
      <span title='Autosave status for assistant/additional-context.md.'>{saveState}</span>
    </div>
    {isLoaded ? (
      <MDXEditor
          markdown={markdown}
          onChange={onChange}
          contentEditableClassName='context-editor'
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
            )
          })
        ]}
      />
    ) : (
      <div className='context-loading'>Loading context</div>
    )}
  </section>
);

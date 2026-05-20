import type { RefreshDiscoveryResult, RuntimePaths } from '../types.js';
import type { ImportStateStore } from '../import-state.js';
import { discoverArticleRefresh } from './article.js';
import { discoverFoundryRefresh } from './foundry.js';
import { discoverPdfRefresh } from './pdf.js';

/**
 * Dependencies shared by the source discovery stage.
 */
export interface RefreshDiscoveryDependencies {
    importStateStore: ImportStateStore;
    now?: () => Date;
}

/**
 * Performs the read-only discovery phase for one refresh run.
 *
 * Discovery answers "what should be processed?" by comparing the current source
 * surfaces against the import state recorded by the last successful run.
 */
export const discoverRefreshWork = async (
    paths: RuntimePaths,
    forceReingest: boolean,
    dependencies: RefreshDiscoveryDependencies,
): Promise<RefreshDiscoveryResult> => {
    const now = dependencies.now ?? (() => new Date());
    const [foundryState, pdfFilenames, currentArticles, lastSuccessfulIndexScrapeAt] = await Promise.all([
        dependencies.importStateStore.readFoundry(),
        dependencies.importStateStore.listFiles('pdf'),
        dependencies.importStateStore.listArticles(),
        dependencies.importStateStore.readArticleLastSuccessfulIndexScrapeAt(),
    ]);

    const [foundry, pdf] = await Promise.all([
        discoverFoundryRefresh(paths.foundryExportDir, foundryState, forceReingest),
        discoverPdfRefresh(paths.pdfDir, pdfFilenames, forceReingest),
    ]);

    return {
        article: discoverArticleRefresh(currentArticles, lastSuccessfulIndexScrapeAt, forceReingest, now()),
        foundry,
        pdf,
    };
};

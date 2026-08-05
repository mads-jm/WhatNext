import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';
import type {
    PurchaseResolvePayload,
    PurchaseLinkResult,
} from '../../shared/core/ipc-protocol';

type Mod = typeof import('../../../../service/downloader/index');
let _modPromise: Promise<Mod> | null = null;

function getDownloaderModules(): Promise<Mod> {
    if (!_modPromise) {
        _modPromise = import('../../../../service/downloader/index');
    }
    return _modPromise;
}

// Promise-based singleton — concurrent callers await the same init, no double-init race.
let resolverPromise: Promise<
    import('../../../../service/downloader/purchase-resolver').PurchaseResolver
> | null = null;

function getResolver() {
    if (!resolverPromise) {
        resolverPromise = getDownloaderModules().then(async (mod) => {
            const r = new mod.PurchaseResolver();
            await r.init();
            return r;
        });
    }
    return resolverPromise;
}

export async function registerPurchaseHandlers(): Promise<void> {
    // Kick off resolver init eagerly so the cache is warm before the first IPC call.
    void getResolver();

    // -----------------------------------------------------------------------
    // purchase:resolve
    // Resolves purchase links for a single track.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.PURCHASE_RESOLVE,
        async (
            _e,
            req: PurchaseResolvePayload,
        ): Promise<PurchaseLinkResult[]> => {
            const r = await getResolver();
            return r.resolve(req);
        },
    );

    // -----------------------------------------------------------------------
    // purchase:resolve-batch
    // Resolves purchase links for multiple tracks.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.PURCHASE_RESOLVE_BATCH,
        async (
            _e,
            reqs: PurchaseResolvePayload[],
        ): Promise<PurchaseLinkResult[][]> => {
            const r = await getResolver();
            return r.resolveBatch(reqs);
        },
    );
}

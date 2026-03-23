import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/core/ipc-protocol';
import type { PurchaseResolvePayload, PurchaseLinkResult } from '../../shared/core/ipc-protocol';

type Mod = typeof import('../../../../service/downloader/index');
let _mod: Mod | null = null;

async function getDownloaderModules(): Promise<Mod> {
    if (!_mod) {
        _mod = await import('../../../../service/downloader/index');
    }
    return _mod;
}

let resolver: import('../../../../service/downloader/purchase-resolver').PurchaseResolver | null = null;

async function getResolver() {
    if (!resolver) {
        const mod = await getDownloaderModules();
        resolver = new mod.PurchaseResolver();
        await resolver.init();
    }
    return resolver;
}

export async function registerPurchaseHandlers(): Promise<void> {
    // Pre-init the resolver (loads disk cache)
    await getResolver();

    // -----------------------------------------------------------------------
    // purchase:resolve
    // Resolves purchase links for a single track.
    // -----------------------------------------------------------------------
    ipcMain.handle(
        IPC_CHANNELS.PURCHASE_RESOLVE,
        async (_e, req: PurchaseResolvePayload): Promise<PurchaseLinkResult[]> => {
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
        async (_e, reqs: PurchaseResolvePayload[]): Promise<PurchaseLinkResult[][]> => {
            const r = await getResolver();
            return r.resolveBatch(reqs);
        },
    );
}

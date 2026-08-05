// @vitest-environment jsdom
/**
 * DownloadSettings — the renderer half of the hybrid `set-backend-path` model.
 *
 * Main decides whether a path is acceptable (see `downloader-guards.test.ts`); what is
 * tested here is that the UI honours the three answers it can get back — and that
 * "the user cancelled the confirmation dialog" is not rendered as a failure.
 *
 * Written as `.ts` with `createElement` rather than `.tsx`: the vitest `include` globs
 * only pick up `*.test.ts`, and this is the first component test in the tree — adding
 * a JSX test lane is infrastructure work, not this lane's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import type { SetBackendPathResult } from '../../../../shared/core/ipc-protocol';
import { DownloadSettings } from '../DownloadSettings';

const setBackendPath =
    vi.fn<(payload: unknown) => Promise<SetBackendPathResult>>();
const openFile = vi.fn();
const getBackendPaths = vi.fn(async () => ({}) as Record<string, string>);

beforeEach(() => {
    vi.clearAllMocks();
    getBackendPaths.mockResolvedValue({});
    // This jsdom build exposes no localStorage; the component reads two UI preferences
    // from it on mount, neither of which is under test here.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        },
    });
    (window as unknown as { electron: unknown }).electron = {
        download: {
            checkBackends: vi.fn(async () => [
                {
                    id: 'ytdlp',
                    name: 'yt-dlp',
                    installed: true,
                    version: '2026.07.04',
                },
                {
                    id: 'spotdl',
                    name: 'spotDL',
                    installed: true,
                    version: '4.5.2',
                },
                {
                    id: 'spytify',
                    name: 'Spytify',
                    installed: false,
                    error: 'Windows only',
                },
            ]),
            getBackendPaths,
            setBackendPath,
        },
        dialog: { openFile },
        app: { getPath: vi.fn(async () => '/home/u/Documents') },
        shell: { openPath: vi.fn(), openExternal: vi.fn() },
    };
});

afterEach(cleanup);

function renderSettings() {
    return render(createElement(DownloadSettings));
}

/** The path input for a backend, identified by its placeholder. */
function pathInput(name: string): HTMLInputElement {
    return screen.getByPlaceholderText(
        `Custom ${name} path (leave blank to use PATH)`,
    ) as HTMLInputElement;
}

describe('DownloadSettings — backend path', () => {
    it('sends a Browse… selection straight to main, which accepts it without a prompt', async () => {
        openFile.mockResolvedValue({
            canceled: false,
            filePaths: ['/opt/bin/yt-dlp'],
        });
        setBackendPath.mockResolvedValue({
            status: 'saved',
            paths: { ytdlp: '/opt/bin/yt-dlp' },
        });

        renderSettings();
        fireEvent.click((await screen.findAllByText('Browse…'))[0]);

        // The renderer sends no claim about where the path came from — main's own
        // record of what its dialog returned is what makes this promptless.
        await waitFor(() =>
            expect(setBackendPath).toHaveBeenCalledWith({
                id: 'ytdlp',
                path: '/opt/bin/yt-dlp',
            }),
        );
    });

    it('does nothing when the file dialog is cancelled', async () => {
        openFile.mockResolvedValue({ canceled: true, filePaths: [] });

        renderSettings();
        fireEvent.click((await screen.findAllByText('Browse…'))[0]);

        await waitFor(() => expect(openFile).toHaveBeenCalled());
        expect(setBackendPath).not.toHaveBeenCalled();
    });

    it("shows main's reason when a typed path is rejected", async () => {
        setBackendPath.mockResolvedValue({
            status: 'rejected',
            paths: {},
            error: 'No such file: /nope/yt-dlp',
        });

        renderSettings();
        const input = await waitFor(() => pathInput('yt-dlp'));
        fireEvent.change(input, { target: { value: '/nope/yt-dlp' } });
        fireEvent.click(screen.getAllByText('Save')[0]);

        expect(
            await screen.findByText('No such file: /nope/yt-dlp'),
        ).toBeTruthy();
        // The draft survives so the user can correct it.
        expect(pathInput('yt-dlp').value).toBe('/nope/yt-dlp');
    });

    it("stays quiet when the user declines main's confirmation", async () => {
        setBackendPath.mockResolvedValue({ status: 'declined', paths: {} });

        renderSettings();
        const input = await waitFor(() => pathInput('yt-dlp'));
        fireEvent.change(input, { target: { value: '/usr/local/bin/yt-dlp' } });
        fireEvent.click(screen.getAllByText('Save')[0]);

        await waitFor(() => expect(setBackendPath).toHaveBeenCalled());
        // Declining is an answer, not a fault: no message, draft kept, nothing saved.
        expect(screen.queryByText(/No such file|not accepted/)).toBeNull();
        expect(pathInput('yt-dlp').value).toBe('/usr/local/bin/yt-dlp');
    });

    it('clears a configured path without any confirmation round-trip', async () => {
        getBackendPaths.mockResolvedValue({ ytdlp: '/opt/bin/yt-dlp' });
        setBackendPath.mockResolvedValue({ status: 'saved', paths: {} });

        renderSettings();
        fireEvent.click(await screen.findByText('Clear'));

        await waitFor(() =>
            expect(setBackendPath).toHaveBeenCalledWith({
                id: 'ytdlp',
                path: null,
            }),
        );
    });
});

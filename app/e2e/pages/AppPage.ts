import type { Page } from '@playwright/test';
import { SidebarPage } from './Layout/SidebarPage';
import { ToolbarPage } from './Layout/ToolbarPage';
import { LibraryPage } from './Library/LibraryPage';
import { PlaylistPage } from './Playlist/PlaylistPage';
import { CreatePlaylistDialog } from './Playlist/CreatePlaylistDialog';
import { TrackPickerModal } from './Playlist/TrackPickerModal';
import { SessionSetupPage } from './Session/SessionSetupPage';
import { SessionPage } from './Session/SessionPage';
import { PlaybackBarPage } from './Session/PlaybackBarPage';
import { CommentsPage } from './Social/CommentsPage';
import { ReactionBarPage } from './Social/ReactionBarPage';
import { SpotifyImportPage } from './Spotify/SpotifyImportPage';
import { SettingsPage } from './Settings/SettingsPage';
import { WelcomePage } from './Onboarding/WelcomePage';

/**
 * AppPage — root entry point for all e2e tests.
 *
 * Composes all Page Object Models, mirroring the component hierarchy:
 *
 *   app/src/renderer/components/
 *     Layout/    → sidebar, toolbar
 *     Library/   → library
 *     Playlist/  → playlist, createPlaylistDialog, trackPickerModal
 *     Session/   → sessionSetup, session, playbackBar
 *     Social/    → comments, reactionBar
 *     Spotify/   → spotifyImport
 *     Settings/  → settings
 *     Onboarding/→ onboarding
 *
 * Usage:
 *   const app = new AppPage(page);
 *   await expect(app.sidebar.navPlaylists).toBeVisible();
 */
export class AppPage {
    readonly sidebar: SidebarPage;
    readonly toolbar: ToolbarPage;
    readonly library: LibraryPage;
    readonly playlist: PlaylistPage;
    readonly createPlaylistDialog: CreatePlaylistDialog;
    readonly trackPickerModal: TrackPickerModal;
    readonly sessionSetup: SessionSetupPage;
    readonly session: SessionPage;
    readonly playbackBar: PlaybackBarPage;
    readonly comments: CommentsPage;
    readonly reactionBar: ReactionBarPage;
    readonly spotifyImport: SpotifyImportPage;
    readonly settings: SettingsPage;
    readonly onboarding: WelcomePage;

    constructor(private readonly page: Page) {
        this.sidebar = new SidebarPage(page);
        this.toolbar = new ToolbarPage(page);
        this.library = new LibraryPage(page);
        this.playlist = new PlaylistPage(page);
        this.createPlaylistDialog = new CreatePlaylistDialog(page);
        this.trackPickerModal = new TrackPickerModal(page);
        this.sessionSetup = new SessionSetupPage(page);
        this.session = new SessionPage(page);
        this.playbackBar = new PlaybackBarPage(page);
        this.comments = new CommentsPage(page);
        this.reactionBar = new ReactionBarPage(page);
        this.spotifyImport = new SpotifyImportPage(page);
        this.settings = new SettingsPage(page);
        this.onboarding = new WelcomePage(page);
    }
}

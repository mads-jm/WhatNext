/**
 * SpotifyErrorState — error display with retry button.
 */

interface SpotifyErrorStateProps {
    error: string | null;
    onRetry: () => void;
}

export function SpotifyErrorState({ error, onRetry }: SpotifyErrorStateProps) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-md">
                <div className="w-16 h-16 bg-error rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-solid fa-exclamation-triangle text-surface text-2xl" />
                </div>
                <h2 className="text-xl font-bold text-on-surface mb-3">
                    Something went wrong
                </h2>
                <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-error text-sm mb-6">
                    {error}
                </div>
                <button
                    onClick={onRetry}
                    className="px-4 py-2 bg-surface-high hover:bg-outline-variant text-on-surface rounded-lg transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}

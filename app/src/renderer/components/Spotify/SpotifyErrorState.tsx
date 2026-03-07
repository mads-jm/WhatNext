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
                <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <i className="fa-solid fa-exclamation-triangle text-white text-2xl" />
                </div>
                <h2 className="text-xl font-bold text-gray-100 mb-3">Something went wrong</h2>
                <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm mb-6">
                    {error}
                </div>
                <button
                    onClick={onRetry}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}

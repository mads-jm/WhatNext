/**
 * P2PInfoRow — key-value row with optional copy button.
 */

interface P2PInfoRowProps {
    label: string;
    value: string;
    mono?: boolean;
    copyable?: boolean;
    onCopy?: () => void;
}

export function P2PInfoRow({ label, value, mono, copyable, onCopy }: P2PInfoRowProps) {
    return (
        <div className="flex items-start justify-between gap-2">
            <span className="text-on-surface-variant font-semibold text-xs whitespace-nowrap">{label}:</span>
            <div className="flex-1 flex items-center justify-end gap-2">
                <span className={`text-on-surface text-xs break-all text-right ${mono ? 'font-mono' : ''}`}>
                    {value}
                </span>
                {copyable && (
                    <button
                        onClick={onCopy}
                        className="px-2 py-1 bg-surface-high hover:bg-outline-variant rounded text-xs"
                    >
                        Copy
                    </button>
                )}
            </div>
        </div>
    );
}

import { WindowControls } from './WindowControls';

interface ToolbarProps {
    title: string;
    actions?: React.ReactNode;
}

export function Toolbar({ title, actions }: ToolbarProps) {
    return (
        <div
            className="toolbar bg-surface border-b border-outline-variant/10"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            <h2 className="text-lg font-semibold text-on-surface font-headline select-none">{title}</h2>
            <div className="flex-1" />
            {actions && (
                <div
                    className="flex items-center gap-2 text-on-surface-variant"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    {actions}
                </div>
            )}
            <WindowControls />
        </div>
    );
}

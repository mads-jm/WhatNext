import { WindowControls } from './WindowControls';

interface ToolbarProps {
    title: string;
    actions?: React.ReactNode;
}

export function Toolbar({ title, actions }: ToolbarProps) {
    return (
        <div
            className="toolbar"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            <h2 className="text-lg font-semibold text-gray-200 select-none">{title}</h2>
            <div className="flex-1" />
            {actions && (
                <div
                    className="flex items-center gap-2"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    {actions}
                </div>
            )}
            <WindowControls />
        </div>
    );
}

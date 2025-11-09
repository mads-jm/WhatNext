interface ToolbarProps {
    title: string;
    actions?: React.ReactNode;
}

export function Toolbar({ title, actions }: ToolbarProps) {
    return (
        <div className="toolbar">
            <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
            <div className="flex-1" />
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}

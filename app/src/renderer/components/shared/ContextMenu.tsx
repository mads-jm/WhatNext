/**
 * Generic portal-based context menu.
 *
 * Renders into document.body via createPortal so z-index and overflow never
 * interfere with the caller's layout.  Items support:
 *   - Font Awesome icon classes (e.g. 'fa-solid fa-trash')
 *   - Emoji strings (any value that doesn't start with 'fa-')
 *   - Nested fly-out sub-menus (one level)
 *   - A two-step confirmation prompt (requiresConfirm)
 *   - Horizontal separator dividers
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Horizontal separator divider — no id, label, or action needed. */
export type ContextMenuDivider = { separator: true };

/** A clickable menu item, optionally with a hover fly-out sub-menu. */
export interface ContextMenuAction {
    /** Never set to true — used to discriminate from ContextMenuDivider. */
    separator?: never;
    id: string;
    label: string;
    /** FA class like 'fa-solid fa-download', or an emoji/text character */
    icon?: string;
    action?: () => void;
    variant?: 'default' | 'danger';
    /** Hover fly-out sub-menu — one level deep */
    subItems?: ContextMenuAction[];
    /** If true, clicking shows a two-step confirmation prompt before the action fires */
    requiresConfirm?: boolean;
    /** Header text shown in the confirmation prompt */
    confirmLabel?: string;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuDivider;

export interface ContextMenuProps {
    items: ContextMenuItem[];
    position: { x: number; y: number };
    onClose: () => void;
}

// ─── Shared style helpers ────────────────────────────────────────────────────

const ITEM_BASE =
    'w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 rounded-lg select-none';
const ITEM_DEFAULT =
    'text-on-surface hover:bg-surface-high hover:text-on-surface';
const ITEM_DANGER = 'text-error hover:bg-error/10 hover:text-error';
const MENU_SHELL =
    'fixed z-50 bg-surface-high rounded-xl ring-1 ring-white/10 shadow-2xl p-1 min-w-[180px]';

function itemCls(variant?: 'default' | 'danger') {
    return `${ITEM_BASE} ${variant === 'danger' ? ITEM_DANGER : ITEM_DEFAULT}`;
}

function MenuIcon({
    icon,
    variant,
}: {
    icon: string;
    variant?: 'default' | 'danger';
}) {
    if (icon.startsWith('fa-')) {
        return (
            <i
                className={`${icon} w-4 text-center text-xs ${
                    variant === 'danger'
                        ? 'text-error'
                        : 'text-on-surface-variant'
                }`}
            />
        );
    }
    return (
        <span className="w-4 text-center text-base leading-none">{icon}</span>
    );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [confirmItem, setConfirmItem] = useState<ContextMenuAction | null>(
        null,
    );
    const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
    const [pos, setPos] = useState({ x: 0, y: 0 });

    // Nudge the menu inside the viewport after it renders
    useLayoutEffect(() => {
        if (!menuRef.current) return;
        const { width, height } = menuRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setPos({
            x: Math.max(8, Math.min(position.x, vw - width - 8)),
            y: Math.max(8, Math.min(position.y, vh - height - 8)),
        });
    }, [position.x, position.y]);

    // Global close triggers
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const onDown = (e: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
        };
    }, [onClose]);

    // Show fly-outs to the left if the menu is near the right edge
    const flyLeft = position.x + 380 > window.innerWidth;

    const handleItemClick = (item: ContextMenuAction) => {
        if (item.subItems?.length) return; // hover-only
        if (item.requiresConfirm) {
            setConfirmItem(item);
            return;
        }
        item.action?.();
        onClose();
    };

    // ── Confirmation state ──────────────────────────────────────────────────
    if (confirmItem) {
        return createPortal(
            <div
                ref={menuRef}
                style={{ top: pos.y, left: pos.x }}
                className={MENU_SHELL}
            >
                <p className="px-3 py-1.5 text-xs text-on-surface-variant border-b border-outline-variant mb-1 truncate">
                    {confirmItem.confirmLabel ?? `${confirmItem.label}?`}
                </p>
                <button
                    onClick={() => {
                        confirmItem.action?.();
                        onClose();
                    }}
                    className={itemCls('danger')}
                >
                    <i className="fa-solid fa-triangle-exclamation w-4 text-center text-xs text-error" />
                    Confirm
                </button>
                <button
                    onClick={() => setConfirmItem(null)}
                    className={itemCls()}
                >
                    <i className="fa-solid fa-xmark w-4 text-center text-xs text-on-surface-variant" />
                    Cancel
                </button>
            </div>,
            document.body,
        );
    }

    // ── Normal item list ────────────────────────────────────────────────────
    return createPortal(
        <div
            ref={menuRef}
            style={{ top: pos.y, left: pos.x }}
            className={MENU_SHELL}
        >
            {items.map((item, index) => {
                if (item.separator) {
                    // Separators have no stable id; position among separators is stable for a given menu
                    const sepIndex = items
                        .slice(0, index)
                        .filter((i) => 'separator' in i && i.separator).length;
                    return (
                        <div
                            key={`sep-${sepIndex}`}
                            className="border-t border-outline-variant my-1"
                        />
                    );
                }
                // TypeScript now narrows item to ContextMenuAction below this point
                if (item.subItems?.length) {
                    const open = activeSubMenu === item.id;
                    return (
                        <div
                            key={item.id}
                            className="relative"
                            onMouseEnter={() => setActiveSubMenu(item.id)}
                            onMouseLeave={() => setActiveSubMenu(null)}
                        >
                            <button className={itemCls(item.variant)}>
                                {item.icon && (
                                    <MenuIcon
                                        icon={item.icon}
                                        variant={item.variant}
                                    />
                                )}
                                <span className="flex-1">{item.label}</span>
                                <i
                                    className={`fa-solid fa-chevron-${flyLeft ? 'left' : 'right'} text-[10px] text-on-surface-variant`}
                                />
                            </button>
                            {open && (
                                <div
                                    className={`absolute top-0 ${flyLeft ? 'right-full mr-1' : 'left-full ml-1'} bg-surface-high rounded-xl ring-1 ring-white/10 shadow-2xl p-1 min-w-[152px]`}
                                >
                                    {item.subItems.map((sub) => (
                                        <button
                                            key={sub.id}
                                            onClick={() => {
                                                sub.action?.();
                                                onClose();
                                            }}
                                            className={itemCls(sub.variant)}
                                        >
                                            {sub.icon && (
                                                <MenuIcon
                                                    icon={sub.icon}
                                                    variant={sub.variant}
                                                />
                                            )}
                                            {sub.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                }

                return (
                    <button
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        className={itemCls(item.variant)}
                    >
                        {item.icon && (
                            <MenuIcon icon={item.icon} variant={item.variant} />
                        )}
                        {item.label}
                    </button>
                );
            })}
        </div>,
        document.body,
    );
}

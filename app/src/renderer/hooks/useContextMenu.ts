import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ContextMenuItem } from '../components/shared/ContextMenu';

interface ContextMenuState {
    visible: boolean;
    position: { x: number; y: number };
    items: ContextMenuItem[];
}

const CLOSED: ContextMenuState = {
    visible: false,
    position: { x: 0, y: 0 },
    items: [],
};

/**
 * Manages context menu open/close state.
 *
 * Usage:
 *   const { menuState, openMenu, closeMenu } = useContextMenu();
 *   ...
 *   <div onContextMenu={(e) => openMenu(e, items)} />
 *   {menuState.visible && (
 *     <ContextMenu {...menuState} onClose={closeMenu} />
 *   )}
 */
export function useContextMenu() {
    const [menuState, setMenuState] = useState<ContextMenuState>(CLOSED);

    const openMenu = useCallback((e: MouseEvent, items: ContextMenuItem[]) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuState({
            visible: true,
            position: { x: e.clientX, y: e.clientY },
            items,
        });
    }, []);

    const closeMenu = useCallback(() => setMenuState(CLOSED), []);

    return { menuState, openMenu, closeMenu };
}

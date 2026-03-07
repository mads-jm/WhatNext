/**
 * ModalPortal — Reusable portal-based modal container
 * with automatic z-index priority management.
 *
 * Uses ReactDOM.createPortal to render outside the component tree,
 * preventing z-index conflicts with parent stacking contexts.
 *
 * Priority tiers:
 *   'low'      → z-index 100 (tooltips, dropdowns)
 *   'normal'   → z-index 200 (standard modals, dialogs)
 *   'high'     → z-index 300 (confirmation dialogs over modals)
 *   'critical' → z-index 400 (system alerts, error modals)
 */

import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalPriority = 'low' | 'normal' | 'high' | 'critical';

const PRIORITY_Z_INDEX: Record<ModalPriority, number> = {
    low: 100,
    normal: 200,
    high: 300,
    critical: 400,
};

interface ModalPortalProps {
    open: boolean;
    onClose: () => void;
    priority?: ModalPriority;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    children: ReactNode;
}

/**
 * Get or create the modal root element in the DOM.
 */
function getModalRoot(): HTMLElement {
    let root = document.getElementById('modal-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'modal-root';
        document.body.appendChild(root);
    }
    return root;
}

export function ModalPortal({
    open,
    onClose,
    priority = 'normal',
    closeOnBackdrop = true,
    closeOnEscape = true,
    children,
}: ModalPortalProps) {
    const zIndex = PRIORITY_Z_INDEX[priority];

    // Escape key handler
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (closeOnEscape && e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        },
        [closeOnEscape, onClose]
    );

    // Register/unregister escape listener and body scroll lock
    useEffect(() => {
        if (!open) return;

        document.addEventListener('keydown', handleKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, handleKeyDown]);

    if (!open) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
            onClose();
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex }}
            onClick={handleBackdropClick}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70" />

            {/* Content (above backdrop) */}
            <div className="relative">{children}</div>
        </div>,
        getModalRoot()
    );
}

/**
 * PurchaseLinkBadge — shows purchase/support links for a track.
 *
 * Variants:
 *   - inline: small pill(s) inline with track metadata
 *   - menu: flat list suitable for a context menu or popover
 */

import { useState } from 'react';
import type { PurchaseLink } from '../../db/types';

const PROVIDER_CONFIG: Record<
    string,
    { label: string; icon: string; color: string }
> = {
    bandcamp: {
        label: 'Bandcamp',
        icon: 'fa-brands fa-bandcamp',
        color: 'bg-[#1da0c3]/15 text-[#1da0c3] border-[#1da0c3]/30',
    },
    beatport: {
        label: 'Beatport',
        icon: 'fa-solid fa-music',
        color: 'bg-[#00ab50]/15 text-[#00ab50] border-[#00ab50]/30',
    },
    itunes: {
        label: 'iTunes',
        icon: 'fa-brands fa-apple',
        color: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    },
    amazon: {
        label: 'Amazon',
        icon: 'fa-brands fa-amazon',
        color: 'bg-[#ff9900]/15 text-[#ff9900] border-[#ff9900]/30',
    },
};

const DEFAULT_CONFIG = {
    label: 'Buy',
    icon: 'fa-solid fa-cart-shopping',
    color: 'bg-surface-high text-on-surface-variant border-outline-variant/30',
};

// ---------------------------------------------------------------------------
// Single pill
// ---------------------------------------------------------------------------

interface PurchaseLinkPillProps {
    link: PurchaseLink;
    onClick?: () => void;
}

export function PurchaseLinkPill({ link, onClick }: PurchaseLinkPillProps) {
    const cfg = PROVIDER_CONFIG[link.provider] ?? DEFAULT_CONFIG;

    const handleClick = () => {
        if (onClick) {
            onClick();
        } else {
            window.electron?.shell.openExternal(link.url);
        }
    };

    return (
        <button
            onClick={handleClick}
            title={link.label ?? cfg.label}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity hover:opacity-80 ${cfg.color}`}
        >
            <i className={`${cfg.icon} text-[10px]`} />
            <span>{link.label ?? cfg.label}</span>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Inline badge group — shows best link + overflow count
// ---------------------------------------------------------------------------

interface PurchaseLinkBadgeProps {
    links: PurchaseLink[];
    /** Max pills to show before collapsing to "+N more" */
    maxVisible?: number;
    className?: string;
}

export function PurchaseLinkBadge({
    links,
    maxVisible = 1,
    className = '',
}: PurchaseLinkBadgeProps) {
    const [expanded, setExpanded] = useState(false);

    if (!links || links.length === 0) return null;

    const visible = expanded ? links : links.slice(0, maxVisible);
    const overflow = links.length - maxVisible;

    return (
        <div className={`flex flex-wrap items-center gap-1 ${className}`}>
            {visible.map((link) => (
                <PurchaseLinkPill key={link.url} link={link} />
            ))}
            {!expanded && overflow > 0 && (
                <button
                    onClick={() => setExpanded(true)}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-surface-high text-on-surface-variant border-outline-variant/30 hover:bg-surface-highest transition-colors"
                >
                    +{overflow} more
                </button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// "Support Artist" section for context menus / track detail panels
// ---------------------------------------------------------------------------

interface SupportArtistSectionProps {
    links: PurchaseLink[];
    trackId: string;
    userPurchased?: boolean;
    onMarkPurchased?: (trackId: string, purchased: boolean) => void;
}

export function SupportArtistSection({
    links,
    trackId,
    userPurchased = false,
    onMarkPurchased,
}: SupportArtistSectionProps) {
    if (!links || links.length === 0) return null;

    return (
        <div className="flex flex-col gap-2 pt-2 border-t border-outline-variant/10">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">
                Support Artist
            </p>

            <div className="flex flex-col gap-1">
                {links.map((link) => {
                    const cfg =
                        PROVIDER_CONFIG[link.provider] ?? DEFAULT_CONFIG;
                    return (
                        <button
                            key={link.url}
                            onClick={() =>
                                window.electron?.shell.openExternal(link.url)
                            }
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-on-surface hover:bg-surface-high transition-colors text-left"
                        >
                            <i className={`${cfg.icon} w-4 text-center`} />
                            <span>{link.label ?? cfg.label}</span>
                        </button>
                    );
                })}
            </div>

            {onMarkPurchased && (
                <button
                    onClick={() => onMarkPurchased(trackId, !userPurchased)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        userPurchased
                            ? 'text-primary bg-primary/10'
                            : 'text-on-surface-variant hover:bg-surface-high'
                    }`}
                >
                    <i
                        className={`fa-solid ${userPurchased ? 'fa-check-circle' : 'fa-circle'} w-4 text-center`}
                    />
                    <span>
                        {userPurchased
                            ? 'Marked as purchased'
                            : 'I bought this'}
                    </span>
                </button>
            )}
        </div>
    );
}

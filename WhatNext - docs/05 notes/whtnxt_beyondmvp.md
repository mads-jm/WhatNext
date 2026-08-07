---
tags:
  - ux/theming
  - ux/ui/design-system
  - mvp
---

# WhatNext: Beyond MVP — Design Language & UX Drivers

> Compiled from 11 high-fidelity view prototypes. These are the design decisions and interaction patterns that should guide post-MVP UX iteration.

---

## Design System Foundation

### Color Palette (Material Design 3, Dark-First)

| Token | Hex | Role |
|-------|-----|------|
| `primary` | `#ba9eff` | Brand anchor, active states, CTAs |
| `primary-dim` | `#8455ef` | Gradients, depth |
| `secondary` | `#53ddfc` | P2P/sync status, connectivity indicators |
| `tertiary` | `#ff97b8` | Social features, reactions, warmth accents |
| `surface` | `#0e0e10` | Base canvas |
| `surface-container-lowest` | `#000000` | Sidebar, deepest layer |
| `surface-container-high` | `#1f1f22` | Elevated cards, table headers |
| `on-surface` | `#f6f3f5` | Primary text |
| `on-surface-variant` | `#acaaad` | Secondary text, inactive nav |
| `outline-variant` | `#48474a` | Borders, dividers (always low opacity) |
| `error` | `#ff6e84` | Error states, downvotes |

Full M3 token set is defined in the [[Tailwind-v4|Tailwind]] config across prototypes — extract and formalize into a shared `tailwind.preset.ts`.

### Typography

| Role | Family | Usage |
|------|--------|-------|
| `headline` | **Manrope** | All headings, nav labels, buttons, bold UI text |
| `body` | **Inter** | Body copy, descriptions, input text |
| `label` | **Inter** | Metadata, timestamps, status badges, tracking-widest micro text |

**Weight scale**: 400 (body), 500-600 (labels/medium), 700 (bold UI), 800 (extrabold headings/hero text).

**Tracking patterns**:
- Hero titles: `tracking-tighter` (tight, impactful)
- Nav items: `tracking-tight`
- Micro labels/badges: `tracking-widest` or `tracking-[0.15em]` (uppercase)

### Border Radius Philosophy

Intentionally restrained — not bubbly:
- Default: `0.125rem` (barely rounded)
- `lg`: `0.25rem`, `xl`: `0.5rem`, `full`: `0.75rem`
- Cards/panels: `rounded-xl` to `rounded-2xl`
- Buttons/pills: `rounded-xl` to `rounded-full`
- Album art: `rounded-md` to `rounded-lg`

### Elevation & Depth

No box shadows for surface hierarchy. Instead:
- **Tonal shift**: lighter `surface-container-*` tokens for elevation
- **Glass panels**: `backdrop-filter: blur(20px)` with rgba backgrounds (player bar, mobile nav)
- **Gradient glow**: `shadow-lg shadow-primary/20` only on primary CTAs
- **Borders**: `border border-outline-variant/10` (near-invisible structural borders)

---

## Core Layout Architecture

### Three-Shell Layout

```
┌──────────────────────────────────────────────────┐
│ TopAppBar (fixed, full-width, h-16)              │
├─────────┬────────────────────────┬───────────────┤
│ SideNav  │ Content Canvas         │ Session Feed  │
│ w-64     │ (scrollable)           │ w-80 (opt.)   │
│ (fixed)  │                        │ (fixed right) │
│          │                        │               │
├─────────┴────────────────────────┴───────────────┤
│ BottomNavBar / Player (fixed, h-20–24, glass)    │
└──────────────────────────────────────────────────┘
```

- **SideNavBar**: Always `bg-[#000000]`, docked left, 264px. Active item uses left border accent + gradient fade.
- **TopAppBar**: `bg-[#0e0e10]`, flat (no shadow). Search + nav links left, status indicators + avatar right.
- **BottomNavBar**: Glass panel (`backdrop-blur-xl`), player controls center, track info left, volume/tools right. Mobile: icon grid with labels.
- **Session Feed sidebar**: Optional right panel for live sessions. Contains comments, reactions, system events.

### Responsive Strategy

- Desktop: full three-column layout
- Tablet: collapse session feed sidebar
- Mobile: hide SideNavBar entirely, BottomNavBar becomes primary navigation with icon+label grid (Playing, Controls, Queue, Peers/Import)

---

## View Catalog & Interaction Patterns

### 1. Library View

**Layout**: Hero header + bento filter cards + data table.

**Key patterns**:
- **Bento filter cards**: 4-column grid (All Tracks, Liked, Recent, Sort). Each card has icon + count + hover border accent.
- **Track table**: No visible borders between rows. Hover = tonal shift (`surface-container-high`). Album art 48x48 with play overlay on hover.
- **Source badges**: Spotify (green circle + logo), Local (primary circle + upload icon). Pill-shaped with border.
- **Sync status icons**: Per-track indicators for local storage + peer sync state.
- **Storage health widget**: Horizontal stat bar (Storage Health, Local Documents, Database Nodes, Auto-Sync Range).
- **Connected peers section**: Horizontal card list below table. Avatar + ring color (secondary/tertiary) + activity status.

### 2. Collaborative Playlist / Session Track List

**Layout**: Playlist header (art + metadata) + track table + session feed sidebar.

**Key patterns**:
- **Playlist header**: Large art (192x192), title 5xl extrabold, owner avatar + stats row, peer avatar stack with count badge.
- **Active track indicator**: Left border accent (`border-l-4 border-primary`) + animated equalizer icon replacing track number.
- **Vote controls**: Inline up/down arrows with count between them.
- **"Added By" column**: Avatar-only (no name), centered.
- **Replication status badge**: Animated pulse icon + "Replicating..." label.

### 3. Spotify Import Flow

**Layout**: Auth banner + playlist selection table + progress/action footer.

**Key patterns**:
- **Auth banner**: Spotify green circle + connected user info + "Switch Account" button.
- **Playlist selection**: Checkbox table with cover art, track count, last updated, status badges.
- **Progress bar state**: The main CTA button *transforms* into a full-width progress bar during import. Gradient fill left-to-right, percentage right-aligned, cancel link below.
- **Spotify gradient background**: Subtle radial gradient from Spotify green (top-right) + primary (bottom-left).

### 4. Session Setup

Two distinct design directions explored:

**Direction A — "Presence over Permissions" (Bento Grid)**:
- Session context cards (Deep Work, Late Night, Vinyl Digging) as selectable tiles
- Track source visualization (orbital node diagram)
- Social dynamics cards (Free Flowing, Turn Taking, Memory First)
- Connected peers with "sonic signatures" (genre tags, status quotes)

**Direction B — "Configure Collaborative Workspace" (Form-Based)**:
- Track Source + Playback Provider as radio button groups in side-by-side cards
- Queue Governance as 3-option icon buttons (Free-for-all, Turn-taking, Vote-based)
- Participant roster with ready/waiting status
- Connection protocol URL with copy button
- "Open Session" button with gradient border animation on hover

**Shared patterns**:
- Invite peer = dashed border button
- Peer status = colored dot (green=ready, amber=waiting)
- Host distinguished by star icon badge on avatar

### 5. Live Session Views

**Direction A — "Memory Lane" (Track-Centric)**:
- Track list with dedicated "Memory" column — user-submitted notes per track
- Reaction badges inline (emoji + count pills)
- Session feed sidebar with comments, system events ("Mark J. joined"), reactions

**Direction B — "Digital Campfire" (Orbital)**:
- Central orb with cover art + session status
- Participant avatars positioned on orbital ring around center
- Active speaker has primary border + mic icon; others are grayscale/dimmed
- Ambient background glow (primary/secondary blur circles)
- "Now Transmitting" label above track info

**Direction C — "Campfire Async Mode"**:
- Session metadata overlay on bottom-left (session name, description, mode badge)
- Memory feed sidebar replaces chat — longer-form comments tied to tracks
- Reaction system with emoji + "tied to Track 04" context links
- Glowing arc rings (SVG) as "memory density indicators"

### 6. Network / P2P Dashboard

**Layout**: Hero status card + peer table + protocol traffic graph + replication log.

**Key patterns**:
- **Node status hero**: PeerID (truncated mono), libp2p version, uptime. Orbital node visualization.
- **Relay configuration card**: Circuit-relay status, multiaddress display.
- **Peer table**: Node name + avatar, connection type badge (Direct/Relay), latency (mono), protocol tags.
- **Protocol traffic**: Bar chart visualization (push/pull differentiated by color).
- **Replication log**: Timeline of sync events with material icons + timestamps.

---

## Recurring UX Patterns

### Status Communication

| Pattern | Usage |
|---------|-------|
| Colored dot + pulse animation | Live/active state (P2P connected, syncing) |
| `tracking-widest` uppercase micro labels | Status badges, section headers |
| Gradient pill badges | Feature states (READY, STABLE, ACTIVE) |
| Avatar ring color | Peer role/status differentiation |
| Border-left accent | Active nav item, active track, important callouts |

### Interaction Affordances

- **Hover on album art**: Scale 110% + dark overlay + play icon
- **Hover on table rows**: Tonal background shift (never outline/border change)
- **Active buttons**: `active:scale-95` press feedback
- **CTAs**: Gradient backgrounds (`from-primary to-primary-dim`), glow shadow
- **Secondary actions**: `surface-container-high` background + border, no gradient

### Social Layer Patterns

- **Comment bubbles**: Rounded corners with `rounded-tl-none` for directional tail
- **System events**: Centered text between horizontal lines ("Mark J. joined")
- **Reaction pills**: Emoji + count in `surface-container-highest` rounded-full badges
- **User identity**: Avatar (32-40px) + bold name + role/status subtitle
- **Peer presence**: Avatar stack (overlapping, `-space-x-2`) + count badge

### Data Display

- **Tables**: No visible row borders. Column headers are `text-[10px] uppercase tracking-widest text-outline`. Divide via `divide-y divide-outline-variant/5` (near-invisible).
- **Metadata labels**: Always uppercase, tracking-widest, 10px, `text-on-surface-variant`
- **Numbers/stats**: `font-headline font-black text-xl` for hero stats
- **Timestamps**: `font-mono text-xs text-on-surface-variant` or `text-outline`
- **Track durations**: Right-aligned, mono font

---

## Key Design Drivers for Post-MVP

### 1. Session is the Hero Product
Every view ultimately serves the session experience. The session view should feel like stepping into a shared space — not managing a playlist. The "Digital Campfire" and "Memory Lane" directions should converge: orbital presence visualization for the live state, track-memory annotations for the async/retrospective state.

### 2. Presence > Permissions
Social dynamics should feel organic, not administrative. Turn-taking is system-enforced but presented as a natural rhythm, not a restriction. Peer status communicates through ambient cues (ring colors, dots, grayscale) rather than permission dialogs.

### 3. Local-First is a Feature, Not a Limitation
Storage health, sync status, and local document counts should be visible and celebrated — not hidden. Users should feel the sovereignty of their data. The "Encrypted" + "Synced" icons per track reinforce this.

### 4. The Player Bar is the Persistent Context
The bottom transport bar anchors every view. It's the one constant across all navigation. On mobile, it becomes the primary navigation surface. It should never feel like a separate widget — it's the floor of every room.

### 5. Progressive Density
- **Session Setup**: Spacious, card-based, fewer elements per screen
- **Library**: Medium density, data tables with breathing room
- **Live Session**: Dense, information-rich, multiple simultaneous data streams (tracks, feed, peers)
- **Network Dashboard**: Technical density, developer-facing

### 6. Glassmorphism with Restraint
Glass panels only for the player bar and mobile navigation — the two elements that float above content. Everything else uses tonal surface shifts. No gratuitous blur.

### 7. Brand Voice in UI Copy
- "Start Session" (not "Create Room")
- "Connected Peers" / "Connected Souls" (not "Online Users")
- "Session Feed" (not "Chat")
- "Memory" / "Memory Lane" (not "Comments")
- [[05 notes/resilient_nocturne/DESIGN|"The Sonic Vault"]] / "Resilient Audio" (tagline exploration)
- "Digital Campfire" (session visualization metaphor)
- "Queue Governance" (not "Queue Settings")

---

## Implementation Notes

### Tailwind Config Extraction
All 11 prototypes share an identical M3 color token set and font configuration. This should be extracted into a single `tailwind.preset.ts` and imported by the app's `tailwind.config.ts`. The token names map directly to M3 roles.

### Material Symbols
Prototypes use Google Material Symbols (Outlined, variable weight/fill). Current app uses inline SVGs or other icon approach — evaluate migration cost vs. benefit. The variable `FILL` setting (0 for inactive, 1 for active nav items) is a nice pattern.

### Component Extraction Priority (Post-MVP)
1. **SideNavBar** — consistent across all views, active state pattern established
2. **TopAppBar** — search + nav + status indicators + avatar
3. **BottomNavBar / PlayerBar** — glass panel, responsive mobile/desktop modes
4. **TrackRow** — album art hover, vote controls, source badges, sync status
5. **PeerAvatar** — ring color, status dot, grayscale states
6. **SessionFeedItem** — comment bubble, system event, reaction notification
7. **BentoFilterCard** — icon + label + count + hover accent

---

**Last Updated**: 2026-03-21
**Source**: 11 HTML prototypes generated via design exploration session

---

## Related Concepts

- [[Theme-System]]
- [[UI-Development]]
- [[Tailwind-v4]]

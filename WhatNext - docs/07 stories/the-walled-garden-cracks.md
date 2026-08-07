---
tags:
  - core/vision
  - stories/origin
  - integrations/spotify/api
  - architecture/decisions
date created: Saturday, February 14th 2026, 4:27:24 pm
relates to: "[[whtnxt-nextspec]]"
date modified: Monday, March 9th 2026, 12:20:47 am
---

# The Walled Garden Cracks

## The Moment

On February 6th, 2026, Spotify announced sweeping changes to their Developer Platform. Premium requirements. One Client ID per developer. Five authorized users, down from twenty-five. Sixteen endpoints gutted. Response fields stripped bare. The search endpoint throttled to a trickle.

Their stated reason: "advances in automation and AI have fundamentally altered the usage patterns and risk profile of developer access."

The translation: the door is closing. Not slamming shut — that would be too honest. It's being narrowed, incrementally, until only the bodies large enough to fill Spotify's 250,000 MAU Extended Quota requirement can squeeze through. Individual developers, hobbyist builders, small communities of music lovers who wanted to build something personal — they're on the wrong side of the threshold now.

This is not surprising. This is the trajectory every walled garden follows. What's surprising is how precisely it validates the thesis WhatNext was built on.

## The Frustration

Here's what actually happened: a group of friends wanted to be more intentional about how they listen to music together.

Spotify's collaborative playlists exist. They're fine. You can add tracks. You can see who added what. But the experience is shallow — a shared list with no conversation around it, no ritual, no sense of presence. There's no way to say "it's your turn to pick" or "I added this one because of what you said last week." The collaboration is mechanical. Add track. Remove track. The social layer is absent.

So naturally, you think: I'll build something on top. Spotify has an API. I'll read the playlist, wrap it in a richer experience, add the social dimension that's missing. The music stays on Spotify. I'm just adding context.

But to do that, every participant needs a Client ID. Every participant needs to authorize. Every participant needs to navigate an OAuth flow that was designed for developers, not for someone who just wants to join their friend's listening session. The onboarding friction was already the single biggest barrier to adoption. And now it's worse: every participant needs Spotify Premium, and you can only have five of them.

The irony is sharp. The collaborative playlist feature that inspired this project is the same feature that can't be meaningfully extended because of the platform's own restrictions. Spotify created the desire for deeper collaboration and then made it nearly impossible to build.

## The Deeper Truth

This frustration isn't really about Spotify. It's about what happens when your creative and social life is hosted on infrastructure you don't control.

The streaming era sold us a bargain: access to everything, ownership of nothing. For a while, that felt like a good trade. But "access to everything" was always conditional. Songs disappear from catalogs. Playlists break when licenses expire. Recommendation algorithms optimize for engagement, not taste. And now, the APIs that let you build around these platforms are being pulled back too.

The local-first movement understood this years ago. The insight wasn't nostalgia for MP3s and folder hierarchies. It was a recognition that __data you control is data that lasts__. A playlist stored as a plaintext file on your machine doesn't evaporate when a company pivots its business model. A P2P connection between friends doesn't require a corporation's permission to exist.

Cloud and streaming got in the way of this truth for a while. The convenience was real. But convenience built on someone else's terms has an expiration date, and we're watching it tick down.

## The Lasting User Story

Strip away the technology, the architecture diagrams, the sync strategies. There is one story at the center of all of this:

> __"I want to be more connected with my friends, through deeper collaboration on our collaborative playlists."__

This story wouldn't exist without Spotify's collaborative playlist feature — it planted the seed. But it also wouldn't exist without everything that feature lacks: presence, ritual, conversation, turn-taking, the feeling that you're building something together rather than appending to a list.

And critically, this story __does not belong to Spotify__. It's a human desire that predates any platform. People have been making mixtapes for each other since cassettes. The medium changes; the impulse doesn't.

## Accessory Mode, Reimagined

The original vision of Accessory Mode was modest: WhatNext as a social companion that reads a Spotify playlist and wraps it in a richer collaborative experience. Read-only. Polling. Spotify does the heavy lifting; WhatNext adds the vibes.

The February 2026 changes demand we think bigger.

Accessory Mode shouldn't just accessorize Spotify. It should be a __translation layer__ — a bridge between the walled gardens. The playlist creator acts as the __coordinator__: they set up the session, they connect to the source (Spotify today, Apple Music or YouTube Music or Tidal tomorrow), and the collaborative experience lives in WhatNext, independent of any single service.

Not everyone needs to download the app. Not everyone needs a Client ID. The coordinator imports the playlist. The [[Sessions|P2P session]] is where the collaboration happens. The source platform is just that — a source. One of many.

This reframing turns Spotify's API restrictions from a blocker into a catalyst. If only the coordinator needs API access, the five-user cap doesn't matter. If the collaborative experience lives in WhatNext's P2P layer, the platform underneath becomes interchangeable.

### The Coordinator Model

1. __One person connects to the source__ (Spotify, Apple Music, a folder of [[local-file-import-adapter|local files]], a URL to a public playlist)
2. __They import the playlist into WhatNext__, which normalizes it into the local-first format
3. __They open a P2P session__ and [[p2p-session-pairing-spec|share the link]]
4. __Friends join the session__ — no accounts, no API keys, no OAuth flows
5. __The collaboration happens in WhatNext__ — turn-taking, queue management, reactions, conversation
6. __Changes flow back to the source__ only if the coordinator has write access, and only if they choose to sync

The coordinator is a bridge, not a bottleneck. The session is sovereign. The source is optional.

## Service Abstraction: The Translation Layer

The path forward is clear: __abstract away the streaming service entirely__.

Instead of building around Spotify's data model, WhatNext defines its own. A track is a track — it has a title, artists, an album, a duration. Whether it came from Spotify, Apple Music, a MusicBrainz lookup, or a local FLAC file is metadata, not identity.

This means:

- __[[adr-260307-session-architecture-provider-abstraction|Import adapters]]__ for each source ([[Spotify-Integration|Spotify adapter]] exists; others follow)
- __A canonical internal format__ that owns no allegiance to any platform (already designed: the plaintext model)
- __Optional sync-back__ to the source, handled by the coordinator's adapter
- __Metadata enrichment__ from open sources (MusicBrainz, ListenBrainz, Discogs) that don't require API keys or premium accounts

The February 2026 Spotify changes removed artist popularity, album labels, track popularity, external IDs. They throttled search results. They stripped the API of the very data that made it useful for discovery. But MusicBrainz has all of this. Discogs has all of this. The open music metadata ecosystem has been quietly building in parallel, waiting for exactly this moment.

## P2P Is Both the Past and the Future

Before streaming, sharing music was inherently peer-to-peer. You dubbed a cassette. You burned a CD. You handed someone a USB drive. The connection was direct, personal, intentional.

Streaming centralized this. It replaced "here, listen to this" with "here's a link to a corporate catalog entry that may or may not exist next month." The convenience was real, but something was lost: the intimacy of the exchange.

[[libp2p|P2P networking]] brings that back, with modern capabilities. A WhatNext session between friends is a direct connection — no server in the middle, no corporation mediating the interaction, no API rate limit on how many times you can share a song with someone you care about.

The data flows directly between the people who care about it. The playlists live on their machines, in plaintext, readable and portable. The social layer — the turn-taking, the reactions, the shared listening experience — exists in the space between peers, not in a cloud database.

This is not a step backward. This is the original promise of the internet, finally applied to music: __people connecting directly with each other, sharing what matters to them, on their own terms__.

## What Changes in the Roadmap

### Phase 1 MVP: Revised Priorities

The core MVP story remains the same — collaborative playlist sessions between friends — but the emphasis shifts:

1. __P2P session experience is the product__, not Spotify integration
2. __Coordinator model__ replaces "everyone needs API access"
3. __Import adapter architecture__ from day one, even if Spotify is the only adapter at launch
4. __Zero-friction join flow__: the person joining a session should never see an OAuth screen
5. __Open metadata enrichment__ (MusicBrainz) as a complement or fallback to Spotify metadata

### What This Unlocks

- __Lower barrier to entry__: only the coordinator needs platform credentials
- __Platform resilience__: if Spotify further restricts, swap the adapter, keep the experience
- __Broader audience__: users of any streaming service (or none) can participate
- __True sovereignty__: the collaborative experience is fully owned by the participants

## The Specific API Damage (February 2026)

For the record, here's what Spotify pulled:

### Removed Endpoints (16)

- Artist top tracks, browse categories, new releases
- Multi-get for albums, artists, tracks, shows, episodes, audiobooks, chapters
- User profile and user playlist access for other users
- Create playlist for another user

### Removed Response Fields

- __Album__: album_group, available_markets, external_ids, label, popularity
- __Artist__: followers, popularity
- __Track__: available_markets, external_ids, linked_from, popularity
- __User__: country, email, explicit_content, followers, product

### Modified Endpoints

- Search: max results reduced from 50 to 10, default from 20 to 5

### Renamed Endpoints

- `/playlists/{id}/tracks` -> `/playlists/{id}/items` (and related fields)

### New Restrictions

- Premium account required for Development Mode
- 1 Client ID per developer (was unlimited)
- 5 authorized users per app (was 25)
- Extended Quota requires 250K MAU and organizational status

### WhatNext-Specific Impact

- `GET /playlists/{id}/tracks` must migrate to `/playlists/{id}/items`
- Response field `tracks` must be read as `items`
- Track `external_ids` removal affects cross-platform matching (shifts this to MusicBrainz/ISRC lookups)
- `popularity` removal is irrelevant — we never used vanity metrics
- Core import flow (playlist read + track metadata) remains functional

---

*This document is a living record. The walled garden will continue to crack. WhatNext was built for exactly this eventuality.*

## Related

- [[whtnxt-nextspec]] — Original project specification
- [[libp2p]] — P2P networking implementation
- [[RxDB-Replication]] — Data sync between peers
- [[Handshake-Protocol]] — P2P connection establishment
- [[Sessions]] — The collaborative session concept at the heart of the coordinator model
- [[adr-260307-session-architecture-provider-abstraction]] — ADR formalizing the coordinator/provider-abstraction architecture
- [[Spotify-Integration]] — The Spotify import adapter
- [[epic-spotify-resilience]] — Hardening work against further API restrictions


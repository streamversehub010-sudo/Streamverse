/* =========================================================================
   movies-data.js
   -------------------------------------------------------------------------
   Single source of truth for every title on the site.
   - index.html reads this to render the movie grid.
   - viewer.js reads this to populate the player page.

   Each entry supports both single movies AND series/anime with seasons
   (via the `seasons` array). A title is treated as a series in the
   viewer/admin whenever `seasons` has at least one season with at least
   one episode. See docs below for the shape of `seasons`.

   Legacy note: older bundled titles may still carry a flat top-level
   `episodes: [...]` array with no seasons. Both admin.js and viewer.js
   auto-wrap that into a single "Season 1" so nothing breaks — but any
   NEW series/anime titles should use `seasons` going forward.

   Swap the `poster`, `video`, and `subtitles` paths below for your own
   files in /posters, /movies, and /subtitles once you have real assets.
   Sample (royalty-free) video URLs are used here so the demo plays
   out of the box.

   Movie Settings (set from the Admin Panel):
   - featured    : reserved for future homepage "featured" placement.
   - trending    : if true, the title appears in the homepage Trending
                   Movies carousel. Order within the carousel is driven
                   by `order` (lower = earlier), set via drag-and-drop
                   in the admin's "Trending Slideshow Order" panel.
   - newRelease  : shows a "NEW" ribbon on the title's card.
   - order       : sort index among trending titles (see above).
   - backdrop    : wide image used as the carousel/hero backdrop; falls
                   back to `poster` if not set.
   ========================================================================= */

const movieDatabase = {

  "avatar": {
    id: "avatar",
    title: "Edge of Tomorrow: Sky",
    genre: "Sci-Fi",
    category: "movie",
    year: "2026",
    rating: "8.7",
    featured: false,
    trending: true,
    newRelease: false,
    order: 0,
    poster: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1446776877081-d282a0f896e2?q=80&w=1600&auto=format&fit=crop",
    description: "A downed pilot relives the same catastrophic battle until she finds the one choice that breaks the loop.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/avatar-en.vtt", default: true },
      { label: "Spanish", lang: "es", src: "subtitles/avatar-es.vtt" }
    ],
    episodes: []
  },

  "vermillion-heist": {
    id: "vermillion-heist",
    title: "Vermillion Heist",
    genre: "Action",
    category: "movie",
    year: "2025",
    rating: "8.2",
    featured: false,
    trending: true,
    newRelease: false,
    order: 1,
    poster: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=1600&auto=format&fit=crop",
    description: "Five strangers, one vault, and eleven minutes before the whole city goes on lockdown.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/vermillion-heist-en.vtt", default: true }
    ],
    episodes: []
  },

  "last-signal": {
    id: "last-signal",
    title: "The Last Signal",
    genre: "Drama",
    category: "movie",
    year: "2026",
    rating: "9.0",
    featured: true,
    trending: false,
    newRelease: true,
    order: 0,
    poster: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?q=80&w=1600&auto=format&fit=crop",
    description: "A radio operator on an abandoned outpost picks up a transmission that shouldn't exist.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/last-signal-en.vtt", default: true },
      { label: "French", lang: "fr", src: "subtitles/last-signal-fr.vtt" }
    ],
    episodes: []
  },

  "kingdom-of-ash": {
    id: "kingdom-of-ash",
    title: "Kingdom of Ash",
    genre: "Fantasy",
    category: "movie",
    year: "2025",
    rating: "8.9",
    featured: true,
    trending: true,
    newRelease: false,
    order: 2,
    poster: "https://images.unsplash.com/photo-1517602302552-471fe67acf66?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1520271348391-049dd132bd8b?q=80&w=1600&auto=format&fit=crop",
    description: "The last heir of a burnt kingdom must reclaim a throne that no longer wants a ruler.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/kingdom-of-ash-en.vtt", default: true }
    ],
    episodes: []
  },

  /* ---------------- Series example: uses the episodes array ---------------- */
  "silent-fracture": {
    id: "silent-fracture",
    title: "Silent Fracture",
    genre: "Crime",
    category: "series",
    year: "S2",
    rating: "9.1",
    featured: false,
    trending: true,
    newRelease: false,
    order: 3,
    poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?q=80&w=1600&auto=format&fit=crop",
    description: "A detective reopens her partner's cold case and finds the trail leads back to her own precinct.",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/silent-fracture-en.vtt", default: true },
      { label: "Spanish", lang: "es", src: "subtitles/silent-fracture-es.vtt" }
    ],
    episodes: [],
    seasons: [
      {
        number: 1,
        title: "Season 1",
        year: "2025",
        episodes: [
          {
            id: "s1e1",
            number: 1,
            title: "Cold Open",
            description: "Detective Mara Voss reopens her late partner's cold case.",
            thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=400&auto=format&fit=crop",
            video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
            downloadUrl: "",
            duration: "42m",
            uploadDate: "2025-01-10"
          },
          {
            id: "s1e2",
            number: 2,
            title: "Static Line",
            description: "A wiretap transcript points the investigation back to Voss's own precinct.",
            thumbnail: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?q=80&w=400&auto=format&fit=crop",
            video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
            downloadUrl: "",
            duration: "39m",
            uploadDate: "2025-01-17"
          },
          {
            id: "s1e3",
            number: 3,
            title: "Blackout",
            description: "A city-wide blackout gives the real culprit room to move.",
            thumbnail: "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?q=80&w=400&auto=format&fit=crop",
            video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
            downloadUrl: "",
            duration: "45m",
            uploadDate: "2025-01-24"
          }
        ]
      }
    ]
  },


  "aurora-division": {
    id: "aurora-division",
    title: "Aurora Division",
    genre: "Sci-Fi",
    category: "series",
    year: "S1",
    rating: "8.3",
    featured: false,
    trending: false,
    newRelease: true,
    order: 0,
    poster: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1600&auto=format&fit=crop",
    description: "A deep-space rescue crew discovers the ship they were sent to save has been quietly rewriting them.",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/aurora-division-en.vtt", default: true }
    ],
    episodes: [],
    seasons: [
      {
        number: 1,
        title: "Season 1",
        year: "2026",
        episodes: [
          {
            id: "s1e1",
            number: 1,
            title: "Drift",
            description: "The rescue crew reaches the derelict Aurora and finds its logs still running.",
            thumbnail: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?q=80&w=400&auto=format&fit=crop",
            video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
            downloadUrl: "",
            duration: "38m",
            uploadDate: "2026-02-02"
          },
          {
            id: "s1e2",
            number: 2,
            title: "Signal Bleed",
            description: "Crew comms start repeating phrases none of them said.",
            thumbnail: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=400&auto=format&fit=crop",
            video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
            downloadUrl: "",
            duration: "41m",
            uploadDate: "2026-02-09"
          }
        ]
      }
    ]
  },

  "crimson-katana": {
    id: "crimson-katana",
    title: "Crimson Katana",
    genre: "Shonen",
    category: "anime",
    year: "S2",
    rating: "9.2",
    featured: false,
    trending: true,
    newRelease: false,
    order: 4,
    poster: "https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1600&auto=format&fit=crop",
    description: "An exiled swordsman trains a reluctant apprentice while a war he started catches up with them both.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/crimson-katana-en.vtt", default: true },
      { label: "Japanese", lang: "ja", src: "subtitles/crimson-katana-ja.vtt" }
    ],
    episodes: []
  },

  /* ---------------- K-Drama ---------------- */
  "moonlight-heirs": {
    id: "moonlight-heirs",
    title: "Moonlight Heirs",
    genre: "Romance",
    category: "kdrama",
    year: "S1",
    rating: "8.8",
    featured: false,
    trending: false,
    newRelease: false,
    order: 0,
    poster: "https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?q=80&w=1600&auto=format&fit=crop",
    description: "Two rival heirs pretend to be engaged to save their families' companies — and slowly stop pretending.",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/last-signal-en.vtt", default: true }
    ],
    episodes: [
      {
        id: "s1e1",
        title: "S1 · E1 — The Arrangement",
        video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        downloadUrl: ""
      },
      {
        id: "s1e2",
        title: "S1 · E2 — Rooftop Rain",
        video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
        downloadUrl: ""
      }
    ]
  },

  /* ---------------- Cartoon ---------------- */
  "sprocket-and-pals": {
    id: "sprocket-and-pals",
    title: "Sprocket & Pals",
    genre: "Family",
    category: "cartoon",
    year: "S3",
    rating: "8.4",
    featured: false,
    trending: false,
    newRelease: false,
    order: 0,
    poster: "https://images.unsplash.com/photo-1594736797933-d0e501ba2fe6?q=80&w=600&auto=format&fit=crop",
    backdrop: "https://images.unsplash.com/photo-1560972550-aba3456b5564?q=80&w=1600&auto=format&fit=crop",
    description: "A tiny robot and his junkyard friends turn every Saturday chore into an accidental adventure.",
    video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
    downloadUrl: "",
    subtitles: [
      { label: "English", lang: "en", src: "subtitles/avatar-en.vtt", default: true }
    ],
    episodes: []
  }

};

/* Helper: safely fetch a movie by id (used by viewer.js) */
function getMovieById(id) {
  return movieDatabase[id] || null;
}

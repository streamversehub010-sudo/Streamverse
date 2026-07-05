/* =========================================================================
   seasons.js
   -------------------------------------------------------------------------
   Small shared helper (no build step, plain global) for working with the
   Series -> Season -> Episode structure on a movie/title object.

   A title is a "series" if it has at least one season with at least one
   episode. Legacy titles that only have a flat `episodes` array (no
   `seasons`) are transparently wrapped into a single Season 1 so both the
   admin panel and the viewer keep working without a data migration.

   Exposes window.svSeasons:
     - getSeasons(movie)          -> normalized seasons array (never mutates movie)
     - isSeries(movie)            -> boolean
     - firstEpisode(movie)        -> the very first episode (season 1, ep 1) or null
     - nextEpisodeNumber(season)  -> next auto-increment episode number for a season
     - nextSeasonNumber(movie)    -> next auto-increment season number
   ========================================================================= */

function getSeasons(movie){
  if (!movie) return [];
  if (Array.isArray(movie.seasons) && movie.seasons.length){
    return movie.seasons
      .map(s => ({
        number: s.number || 1,
        title: s.title || `Season ${s.number || 1}`,
        year: s.year || '',
        episodes: Array.isArray(s.episodes) ? s.episodes : []
      }))
      .sort((a, b) => a.number - b.number);
  }
  // Legacy fallback: flat top-level `episodes` array, no seasons at all.
  if (Array.isArray(movie.episodes) && movie.episodes.length){
    return [{
      number: 1,
      title: 'Season 1',
      year: movie.year || '',
      episodes: movie.episodes
    }];
  }
  return [];
}

function isSeries(movie){
  return getSeasons(movie).some(s => s.episodes.length > 0);
}

function firstEpisode(movie){
  const seasons = getSeasons(movie);
  for (const s of seasons){
    if (s.episodes.length) return s.episodes[0];
  }
  return null;
}

function nextEpisodeNumber(season){
  if (!season || !season.episodes.length) return 1;
  return Math.max(...season.episodes.map(e => e.number || 0)) + 1;
}

function nextSeasonNumber(movie){
  const seasons = getSeasons(movie);
  if (!seasons.length) return 1;
  return Math.max(...seasons.map(s => s.number || 0)) + 1;
}

window.svSeasons = { getSeasons, isSeries, firstEpisode, nextEpisodeNumber, nextSeasonNumber };

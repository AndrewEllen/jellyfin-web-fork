// src/components/clientrecs/recommender.js
// Client-side recommender (no server URL/API keys). Uses the logged-in apiClient.
// Caches results per user in localStorage for 24h.

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 180; // recency half-life
const LAMBDA = Math.log(2) / HALF_LIFE_DAYS;

function cacheKey(userId) {
    return `jfw:recs:v1:${userId}`;
}

function nowUtcIso() {
    return new Date().toISOString();
}

function fromIso(d) {
    try { return new Date(d); } catch { return null; }
}

function readCache(userId) {
    try {
        const raw = localStorage.getItem(cacheKey(userId));
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (!j.generated_at_utc) return null;
        if (Date.now() - Date.parse(j.generated_at_utc) > DAY_MS) return null;
        return j;
    } catch {
        return null;
    }
}

function writeCache(userId, data) {
    try {
        localStorage.setItem(cacheKey(userId), JSON.stringify({
            generated_at_utc: nowUtcIso(),
            ...data
        }));
    } catch {}
}

function expDecayWeight(lastPlayedIso, playCount, isFavorite) {
    const base = Math.max(1, Number(playCount || 1));
    const last = fromIso(lastPlayedIso);
    const days = last ? Math.max(0, (Date.now() - last.getTime()) / DAY_MS) : 0;
    let w = base * Math.exp(-LAMBDA * days);
    if (isFavorite) w *= 1.2;
    return w;
}

// --- Jellyfin queries --------------------------------------------------

async function getPlayed(apiClient, userId) {
    const res = await apiClient.getItems(userId, {
        IsPlayed: true,
        IncludeItemTypes: 'Movie,Series',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        Recursive: true,
        Limit: 2000,
        Fields: 'Genres,People,Studios,ProviderIds,UserData,ProductionYear,OfficialRating'
    });
    return res?.Items || [];
}

async function getCandidates(apiClient, userId) {
    // Unplayed + allow resurfacing if last played long ago (handled in scoring)
    const res = await apiClient.getItems(userId, {
        IsPlayed: false,
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        // Large limit; Jellyfin will cap. This is a once-a-day computation.
        Limit: 100000,
        Fields: 'Genres,People,Studios,ProviderIds,UserData,Type,Name,ProductionYear'
    });
    return res?.Items || [];
}

// --- Profile + scoring -------------------------------------------------

function buildProfile(playedItems) {
    const prof = { genres: Object.create(null), people: Object.create(null), studios: Object.create(null) };

    const add = (bucket, k, v) => {
        if (!k) return;
        prof[bucket][k] = (prof[bucket][k] || 0) + v;
    };

    for (const it of playedItems) {
        const ud = it.UserData || {};
        const w = expDecayWeight(ud.LastPlayedDate, ud.PlayCount, ud.IsFavorite);
        for (const g of it.Genres || []) add('genres', g, w);
        for (const p of it.People || []) add('people', p.Name, 0.6 * w);
        for (const s of it.Studios || []) add('studios', s.Name, 0.4 * w);
    }
    return prof;
}

function scoreItem(it, prof) {
    const g = (it.Genres || []).reduce((a, x) => a + (prof.genres[x] || 0), 0);
    const p = (it.People || []).reduce((a, x) => a + (prof.people[x.Name] || 0), 0);
    const s = (it.Studios || []).reduce((a, x) => a + (prof.studios[x.Name] || 0), 0);
    // Slot for trending boost later (from server JSON) — set to 0 for client-only MVP
    const trendingBoost = 0;
    return (0.5 * g) + (0.3 * p) + (0.1 * s) + (0.4 * trendingBoost);
}

/**
 * Build per-user recommendations and cache for 24h.
 * Returns { movies: BaseItemDto[], series: BaseItemDto[], combined: BaseItemDto[] }
 */
export async function buildClientRecommendations(apiClient, userId) {
    const cached = readCache(userId);
    if (cached?.movies && cached?.series && cached?.combined) return cached;

    const [played, candidates] = await Promise.all([
        getPlayed(apiClient, userId),
        getCandidates(apiClient, userId)
    ]);

    const profile = buildProfile(played);

    const scored = [];
    for (const it of candidates) {
    // Allow resurfacing items played > 2 years ago
        const last = it?.UserData?.LastPlayedDate ? fromIso(it.UserData.LastPlayedDate) : null;
        if (last && ((Date.now() - last.getTime()) / DAY_MS) <= 730) continue;

        const s = scoreItem(it, profile);
        if (s > 0) scored.push({ s, it });
    }

    scored.sort((a, b) => b.s - a.s);

    const movies = [];
    const series = [];
    for (const x of scored) {
        if (x.it.Type === 'Movie' && movies.length < 60) movies.push(x.it);
        else if ((x.it.Type === 'Series' || x.it.Type === 'Show') && series.length < 60) series.push(x.it);
        if (movies.length >= 60 && series.length >= 60) break;
    }

    const combined = scored.slice(0, 60).map(x => x.it);

    const payload = { movies, series, combined, generated_at_utc: nowUtcIso() };
    writeCache(userId, payload);
    return payload;
}

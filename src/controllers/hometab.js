import * as userSettings from '../scripts/settings/userSettings';
import loading from '../components/loading/loading';
import focusManager from '../components/focusManager';
import homeSections from '../components/homesections/homesections';
import { renderClientRecommendations } from '../components/clientrecs/renderClientRecs';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import globalize from '../lib/globalize';

import '../elements/emby-itemscontainer/emby-itemscontainer';

class HomeTab {
    constructor(view, params) {
        this.view = view;
        this.params = params;
        this.apiClient = ServerConnections.currentApiClient();
        this.sectionsContainer = view.querySelector('.sections');

        this.sectionsContainer?.addEventListener(
            'settingschange',
            onHomeScreenSettingsChanged.bind(this)
        );
    }

    onResume(options) {
        if (this.sectionsRendered) {
            const sc = this.sectionsContainer;
            if (sc) return homeSections.resume(sc, options);
            return Promise.resolve();
        }

        loading.show();
        const view = this.view;
        const apiClient = this.apiClient;

        this.destroyHomeSections();
        this.sectionsRendered = true;

        return apiClient.getCurrentUser()
            .then(async (user) => {
                const sectionsEl = view.querySelector('.sections');

                // 1) Load all the normal home rails (Continue Watching / Next Up / etc.)
                await homeSections.loadSections(sectionsEl, apiClient, user, userSettings);

                // 2) Remove ONLY the "My Media" rail
                try {
                    const myMediaTitle = (globalize.translate('HeaderMyMedia') || 'My Media').toLowerCase();

                    sectionsEl.querySelectorAll('.sectionTitle, .sectionTitle-cards, h2').forEach(h => {
                        const t = (h.textContent || '').trim().toLowerCase();
                        if (t === myMediaTitle) {
                            const sec = h.closest('.homeSection, .section');
                            if (sec) sec.remove();
                        }
                    });

                    sectionsEl.querySelectorAll(
                        '[data-section="smalllibrarytiles"],'
                        + '.section-smalllibrarytiles,'
                        + '.section-librarybuttons'
                    ).forEach(el => el.remove());
                } catch (e) {
                    console.warn('Failed to remove My Media section', e);
                }

                // 3) Prepend your client-side Recommendations rails at the very top
                try {
                    await renderClientRecommendations(sectionsEl, apiClient, user);
                } catch (e) {
                    console.warn('client recs failed', e);
                }

                // 4) Wait for custom scrollers to upgrade, then reorder (prevents addScrollEventListener crash)
                try {
                    await waitForScrollerUpgrade(sectionsEl);
                    reorderHomeSections(sectionsEl);
                } catch (e) {
                    console.warn('reorder failed', e);
                }
            })
            .then(() => {
                if (options.autoFocus) focusManager.autoFocus(this.view);
            })
            .catch(err => {
                console.error(err);
            })
            .finally(() => loading.hide());
    }

    onPause() {
        const sc = this.sectionsContainer;
        if (sc) homeSections.pause(sc);
    }

    destroy() {
        this.view = null;
        this.params = null;
        this.apiClient = null;
        this.destroyHomeSections();
        this.sectionsContainer = null;
    }

    destroyHomeSections() {
        const sc = this.sectionsContainer;
        if (!sc) return;

        try { homeSections.destroySections(sc); } catch {}
        sc.querySelectorAll('.clientRecsSection').forEach(n => n.remove());
        if (sc.dataset) delete sc.dataset.clientRecsRendered;
    }
}

function onHomeScreenSettingsChanged() {
    this.sectionsRendered = false;
    if (!this.paused) {
        this.onResume({ refresh: true });
    }
}

/* ------------ helpers: wait + ordering (no DOM structure changes) ------------ */

// Wait until all scrollers inside root are upgraded (have the methods scrollbuttons need)
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForScrollerUpgrade(root, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const scrollers = root.querySelectorAll('emby-scroller,[is="emby-scroller"]');
        if (scrollers.length === 0) return; // nothing to wait for
        const ready = [...scrollers].every(s =>
            typeof s.addScrollEventListener === 'function'
            && typeof s.getScrollSlider === 'function'
        );
        if (ready) return;
        // give the WebComponents polyfill time to upgrade, and avoid thrashing
        await sleep(50);
    }
    // If we time out, proceed anyway rather than block the page
}

function normalizeTitle(node) {
    return (node?.textContent || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function findSectionByHeader(root, matchFn) {
    const headers = root.querySelectorAll('.sectionTitle, .sectionTitle-cards, h2');
    for (const h of headers) {
        const t = normalizeTitle(h);
        if (matchFn(t)) {
            return h.closest('.verticalSection') || h.closest('.homeSection') || h.closest('.section');
        }
    }
    return null;
}

function reorderHomeSections(root) {
    // Desired order (top → down):
    // 1 Continue Watching
    // 2 Next Up
    // 3 Recommended
    // 4 Recommended Movies
    // 5 Recently Added in Movies
    // 6 Recommended Shows  (aka Recommended TV)
    // 7 Recently Added in Shows
    // 8 Recently Added in Music

    const containsRecent = t => t.includes('recent') || t.includes('latest');

    const secContinue = findSectionByHeader(root, t => t.includes('continue watching'));
    const secNextUp = findSectionByHeader(root, t => t.includes('next up'));

    const secRec = root.querySelector('[data-section="client-recs-combined"]')?.closest('.verticalSection, .homeSection, .section');
    const secRecMovies = root.querySelector('[data-section="client-recs-movies"]')?.closest('.verticalSection, .homeSection, .section');
    const secRecShows = root.querySelector('[data-section="client-recs-series"]')?.closest('.verticalSection, .homeSection, .section');

    const secRecentMovies = findSectionByHeader(root, t => containsRecent(t) && t.includes('movie'));
    const secRecentShows = findSectionByHeader(root, t => containsRecent(t) && (t.includes('tv') || t.includes('show') || t.includes('shows') || t.includes('series')));
    const secRecentMusic = findSectionByHeader(root, t => containsRecent(t) && t.includes('music'));

    const order = [
        secContinue,
        secNextUp,
        secRec,
        secRecMovies,
        secRecentMovies,
        secRecShows,
        secRecentShows,
        secRecentMusic
    ].filter(Boolean);

    // Move to top in exact order without touching internals
    let anchor = root.firstElementChild;
    for (let i = order.length - 1; i >= 0; i--) {
        const sec = order[i];
        if (!sec || sec.parentElement !== root) continue;
        root.insertBefore(sec, anchor);
        anchor = sec;
    }
}

export default HomeTab;

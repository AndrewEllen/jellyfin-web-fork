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
                    // Localized text for the header
                    const myMediaTitle = (globalize.translate('HeaderMyMedia') || 'My Media').toLowerCase();

                    // Remove section by matching its header text
                    sectionsEl.querySelectorAll('.sectionTitle, .sectionTitle-cards, h2').forEach(h => {
                        const t = (h.textContent || '').trim().toLowerCase();
                        if (t === myMediaTitle) {
                            const sec = h.closest('.homeSection, .section');
                            if (sec) sec.remove();
                        }
                    });

                    // Defensive removals by known markers
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

export default HomeTab;

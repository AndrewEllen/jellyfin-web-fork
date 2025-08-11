import TabbedView from '../components/tabbedview/tabbedview';
import globalize from '../lib/globalize';
import '../elements/emby-tabs/emby-tabs';
import '../elements/emby-button/emby-button';
import '../elements/emby-scroller/emby-scroller';
import LibraryMenu from '../scripts/libraryMenu';
// Pull in the router so we can navigate away from the home view when
// library tabs are selected.  Without navigation the tabbed view
// attempts to load library controllers into the home page which
// results in missing markup and runtime errors.
import { appRouter } from '../components/router/appRouter';
// Access the Jellyfin API client to query user views.  This is used
// to determine which library tabs should be visible to the current
// user.  We import ServerConnections from the apiclient instead of
// constructing a new ApiClient instance because the current client
// holds authentication and server state.
import { ServerConnections } from 'lib/jellyfin-apiclient';

/**
 * HomeView extends the core TabbedView and defines the set of tabs that
 * appear along the top of the home screen.  By default Jellyfin only
 * exposes "Home" and "Favorites" here.  To improve discoverability of
 * different library types this class has been extended to include
 * additional tabs for Movies, Shows, Music and Playlists.  Each entry
 * defines a translated name to display and is mapped to the appropriate
 * controller below.  When a tab is selected the corresponding controller
 * is lazy‑loaded via dynamic import.
 */
class HomeView extends TabbedView {
    setTitle() {
        // Clear the library title when landing on the home view.
        LibraryMenu.setTitle(null);
    }

    onPause() {
        super.onPause(this);
        document.querySelector('.skinHeader').classList.remove('noHomeButtonHeader');
    }

    onResume(options) {
        // Always await the base implementation to ensure the tabbed view is fully
        // initialised before we perform our own logic.  Although the base
        // implementation isn’t asynchronous it may return a promise in some
        // versions of Jellyfin so we await the result for safety.
        const result = super.onResume(this, options);
        // Hide the back button on the header when on the home page.
        document.querySelector('.skinHeader').classList.add('noHomeButtonHeader');
        // Kick off asynchronous work to adjust tab visibility and remove the
        // "My Media" library section.  These operations run in the
        // background and do not block rendering the home page.
        this.updateTabVisibility().catch(err => {
            console.error('Failed to update tab visibility', err);
        });
        return result;
    }

    getDefaultTabIndex() {
        return 0;
    }

    /**
     * Returns an array of objects describing the tabs to render.  The order of
     * this array defines the index passed to getTabController below.  To
     * translate the visible name of each tab the globalize helper is used.
     */
    getTabs() {
        // The tab array is defined statically here but the updateTabVisibility
        // method will hide tabs that the user does not have access to.  If
        // additional library types need to be supported they can be added
        // here and handled in updateTabVisibility.
        return [
            { name: globalize.translate('Home') },
            { name: globalize.translate('Favorites') },
            { name: globalize.translate('Movies') },
            { name: globalize.translate('Shows') },
            { name: globalize.translate('Music') },
            { name: globalize.translate('Playlists') }
        ];
    }

    /**
     * Given a zero‑based index this method resolves the correct controller for
     * the selected tab.  The mapping uses relative import paths pointing
     * into the existing controllers directory.  When adding new tabs be sure
     * to update this switch to map indexes to the correct modules.
     *
     * @param {number} index The index of the selected tab.
     * @returns {Promise<object>} A promise resolving to a controller instance.
     */
    getTabController(index) {
        if (index == null) {
            throw new Error('index cannot be null');
        }
        // Map each index to either the built‑in controller (for Home and
        // Favorites) or a lightweight redirector that navigates to the full
        // library page.  When selecting a library tab we avoid
        // instantiating the library controller directly because the home
        // layout lacks the necessary markup.  Instead we return a dummy
        // controller whose onResume method triggers a navigation via the
        // application router.
        const instance = this;
        switch (index) {
            case 0:
            case 1:
                // For Home and Favorites we defer to the existing controllers.
                {
                    let depends;
                    depends = index === 0 ? 'hometab' : 'favorites';
                    return import(/* webpackChunkName: "[request]" */ `../controllers/${depends}`).then(({ default: ControllerFactory }) => {
                        let controller = instance.tabControllers[index];
                        if (!controller) {
                            controller = new ControllerFactory(
                                instance.view.querySelector(
                                    `.tabContent[data-index='${index}']`
                                ),
                                instance.params
                            );
                            instance.tabControllers[index] = controller;
                        }
                        return controller;
                    });
                }
            case 2:
                return Promise.resolve({
                    onResume() {
                        // Navigate to the movies page when the tab is selected
                        appRouter.show('movies');
                    },
                    onPause() {},
                    destroy() {}
                });
            case 3:
                return Promise.resolve({
                    onResume() {
                        // TV shows live under the 'tv' route rather than 'shows'.
                        // Using the correct path avoids navigation errors.
                        appRouter.show('tv');
                    },
                    onPause() {},
                    destroy() {}
                });
            case 4:
                return Promise.resolve({
                    onResume() {
                        appRouter.show('music');
                    },
                    onPause() {},
                    destroy() {}
                });
            case 5:
                return Promise.resolve({
                    onResume() {
                        appRouter.show('music/playlists');
                    },
                    onPause() {},
                    destroy() {}
                });
            default:
                return Promise.reject(new Error(`Unsupported tab index: ${index}`));
        }
    }

    /**
     * Determines which library tabs should be visible to the current user and
     * hides any that are not applicable.  This method queries the server
     * for the user’s accessible views and removes tabs corresponding to
     * collection types that are absent.  It also removes the “My Media”
     * library section from the home page because the library tabs at the
     * top of the page replace that functionality.
     *
     * @returns {Promise<void>} A promise that resolves when the DOM has been updated.
     */
    async updateTabVisibility() {
        try {
            const apiClient = ServerConnections.currentApiClient();
            if (!apiClient) {
                return;
            }
            // Fetch the current user so we can pass the user id to the views
            const currentUser = await apiClient.getCurrentUser();
            const userId = currentUser?.Id || apiClient.getCurrentUserId?.();
            if (!userId) {
                return;
            }
            // Retrieve the list of views the user has access to.  Depending on
            // the Jellyfin SDK version this may be returned from getUserViews
            // with either { Items: [...] } or directly as an array.  We
            // normalise into an array of view objects.
            let viewsResult;
            if (typeof apiClient.getUserViews === 'function') {
                viewsResult = await apiClient.getUserViews({ UserId: userId });
            }
            const userViews = Array.isArray(viewsResult?.Items) ? viewsResult.Items : (Array.isArray(viewsResult) ? viewsResult : []);
            const types = new Set();
            for (const view of userViews) {
                const t = (view.CollectionType || view.CollectionTypeName || view.Type || '').toLowerCase();
                if (t) {
                    types.add(t);
                }
            }
            // Map collection types to tab indices.  The tab order must match
            // getTabs().  Jellyfin uses collection type strings like
            // 'movies', 'tvshows', 'music', 'playlists'.  We also treat
            // 'series' as an alias for shows.  If a type is missing we
            // hide the corresponding tab and its tab content container.
            const typeToIndex = {
                movies: 2,
                tvshows: 3,
                series: 3,
                music: 4,
                playlists: 5
            };
            // Determine which indices to hide
            const indicesToHide = [];
            for (const [type, index] of Object.entries(typeToIndex)) {
                if (!types.has(type)) {
                    indicesToHide.push(index);
                }
            }
            // Hide the tabs and corresponding content for each missing type
            const tabsElement = this.view.querySelector('emby-tabs');
            if (tabsElement) {
                const tabButtons = tabsElement.querySelectorAll('.emby-tab, button, .tab');
                for (const index of indicesToHide) {
                    const btn = tabButtons[index];
                    if (btn) {
                        btn.style.display = 'none';
                    }
                }
            }
            // Hide tab content as well
            for (const index of indicesToHide) {
                const content = this.view.querySelector(`.tabContent[data-index='${index}']`);
                if (content) {
                    content.style.display = 'none';
                }
            }
            // Attempt to remove the first home section (My Media) if present.
            const homeTab = this.view.querySelector(".tabContent[data-index='0']");
            if (homeTab) {
                const sectionsContainer = homeTab.querySelector('.homeSectionsContainer');
                if (sectionsContainer) {
                    const librarySection = sectionsContainer.querySelector('.section0');
                    if (librarySection) {
                        librarySection.remove();
                    }
                }
            }
        } catch (err) {
            console.error('Error updating tab visibility', err);
        }
    }
}

export default HomeView;
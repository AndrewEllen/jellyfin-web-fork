// src/components/clientrecs/renderClientRecs.js
import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import layoutManager from 'components/layoutManager';
import { getBackdropShape } from 'utils/card';
import { buildClientRecommendations } from './recommender';

// Build a section using the SAME DOM structure/classes as built-in rails
function buildSectionHtml(title, items) {
    const enableOverflow = true; // match homesections default to get nav arrows
    let html = '';

    // Title container matches Next Up / Recently Added
    html += '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    // For MVP we just render <h2>; you can make this an <a is="emby-linkbutton"> later
    html += '<h2 class="sectionTitle sectionTitle-cards">' + title + '</h2>';
    html += '</div>';

    // Scroller + itemsContainer structure is what gives you the left/right chevrons
    if (enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x">';
    }

    html += cardBuilder.getCardsHtml({
        items,
        shape: getBackdropShape(enableOverflow),
        showTitle: true,
        centerText: true,
        overlayText: false,
        lazy: true,
        transition: false,
        allowBottomPadding: !enableOverflow
    });

    if (enableOverflow) {
        html += '</div>';
    }
    html += '</div>';

    return html;
}

function makeVerticalSection(id, title, items) {
    const wrap = document.createElement('div');
    // Built-ins use verticalSection as the wrapper
    wrap.className = 'verticalSection clientRecsSection';
    wrap.dataset.section = id;
    wrap.innerHTML = buildSectionHtml(title, items);
    imageLoader.lazyChildren(wrap);
    return wrap;
}

export async function renderClientRecommendations(sectionsEl, apiClient, user) {
    if (!sectionsEl || !apiClient || !user) return;
    if (sectionsEl.dataset.clientRecsRendered === '1') return;

    const { movies, series, combined } = await buildClientRecommendations(apiClient, user.Id);

    const secCombined = makeVerticalSection('client-recs-combined', 'Recommended', combined);
    const secMovies = makeVerticalSection('client-recs-movies', 'Recommended Movies', movies);
    const secSeries = makeVerticalSection('client-recs-series', 'Recommended TV', series);

    // Prepend to the very top: Combined, then Movies, then TV
    const first = sectionsEl.firstElementChild;
    sectionsEl.insertBefore(secSeries, first);
    sectionsEl.insertBefore(secMovies, secSeries);
    sectionsEl.insertBefore(secCombined, secMovies);

    sectionsEl.dataset.clientRecsRendered = '1';
}

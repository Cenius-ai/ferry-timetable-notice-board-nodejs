/** Application shell: navigation, history routing, session state. */

import { h, mount } from './lib/dom.js';
import { api } from './lib/api.js';
import { loadingPanel, errorPanel } from './lib/ui.js';
import * as homePage from './pages/home.js';
import * as timetablePage from './pages/timetable.js';
import * as noticesPage from './pages/notices.js';
import * as bookPage from './pages/book.js';
import * as loginPage from './pages/login.js';
import * as dashboardPage from './pages/dashboard.js';
import * as staffBookingsPage from './pages/staff-bookings.js';
import * as staffCrossingsPage from './pages/staff-crossings.js';
import * as staffNoticesPage from './pages/staff-notices.js';

const state = { user: null, activeNav: '' };

const routes = [
  { path: '/', page: homePage.render, title: 'Today’s board', nav: 'home' },
  { path: '/timetable', page: timetablePage.render, title: 'Timetable', nav: 'timetable' },
  { path: '/notices', page: noticesPage.render, title: 'Service notices', nav: 'notices' },
  { path: '/book', page: bookPage.render, title: 'Vehicle deck booking', nav: 'book' },
  { path: '/login', page: loginPage.render, title: 'Staff sign in', nav: '' },
  { path: '/dashboard', page: dashboardPage.render, title: 'Operations dashboard', auth: true, nav: 'dashboard' },
  { path: '/staff/bookings', page: staffBookingsPage.render, title: 'Booking review queue', auth: true, nav: 'bookings' },
  {
    path: '/staff/bookings/:id',
    page: staffBookingsPage.renderDetail,
    title: 'Booking request',
    auth: true,
    nav: 'bookings',
  },
  { path: '/staff/timetable', page: staffCrossingsPage.render, title: 'Crossing timetable', auth: true, nav: 'crossings' },
  {
    path: '/staff/timetable/new',
    page: staffCrossingsPage.renderForm,
    title: 'New crossing',
    auth: true,
    nav: 'crossings',
  },
  {
    path: '/staff/timetable/:id/edit',
    page: staffCrossingsPage.renderForm,
    title: 'Edit crossing',
    auth: true,
    nav: 'crossings',
  },
  { path: '/staff/notices', page: staffNoticesPage.render, title: 'Notice management', auth: true, nav: 'staff-notices' },
  {
    path: '/staff/notices/new',
    page: staffNoticesPage.renderForm,
    title: 'Write a notice',
    auth: true,
    nav: 'staff-notices',
  },
  {
    path: '/staff/notices/:id/edit',
    page: staffNoticesPage.renderForm,
    title: 'Edit notice',
    auth: true,
    nav: 'staff-notices',
  },
];

const PUBLIC_LINKS = [
  { href: '/', label: 'Board', key: 'home' },
  { href: '/timetable', label: 'Timetable', key: 'timetable' },
  { href: '/notices', label: 'Notices', key: 'notices' },
  { href: '/book', label: 'Vehicle deck', key: 'book' },
];

const STAFF_LINKS = [
  { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/staff/bookings', label: 'Booking queue', key: 'bookings' },
  { href: '/staff/timetable', label: 'Crossings', key: 'crossings' },
  { href: '/staff/notices', label: 'Notices', key: 'staff-notices' },
];

/* ------------------------------ routing ------------------------------ */

function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    const segments = candidate.path.split('/').filter(Boolean);
    if (segments.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index].startsWith(':')) params[segments[index].slice(1)] = decodeURIComponent(parts[index]);
      else if (segments[index] !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function navigate(path, { replace = false } = {}) {
  const target = new URL(path, window.location.origin);
  const next = `${target.pathname}${target.search}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current && !replace) {
    renderRoute();
    return;
  }
  if (replace) window.history.replaceState({}, '', next);
  else window.history.pushState({}, '', next);
  renderRoute();
}

function setUser(user) {
  state.user = user || null;
  renderHeader();
}

async function refreshUser() {
  try {
    const payload = await api.get('/api/auth/me');
    setUser(payload.user);
    return payload.user;
  } catch {
    setUser(null);
    return null;
  }
}

function errorView(error, retry) {
  if (error && error.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    setUser(null);
    navigate(`/login?next=${encodeURIComponent(next)}&expired=1`, { replace: true });
    return loadingPanel('Your session expired. Taking you to sign in…');
  }
  return h(
    'div',
    { class: 'page' },
    h('h1', { class: 'page-intro__title', text: 'Something went wrong' }),
    errorPanel(error && error.message, retry),
  );
}

let renderToken = 0;

async function renderRoute() {
  const token = (renderToken += 1);
  const main = document.getElementById('main');
  const { pathname, search } = window.location;
  const match = matchRoute(pathname);

  if (!match) {
    document.title = 'Page not found · Ferry Timetable Notice Board';
    state.activeNav = '';
    renderHeader();
    mount(
      main,
      h(
        'div',
        { class: 'page' },
        h('h1', { class: 'page-intro__title', text: 'Page not found' }),
        h(
          'div',
          { class: 'state state--empty' },
          h('p', { class: 'state__title', text: 'That page does not exist' }),
          h('p', { class: 'state__message', text: 'The link may be out of date. Head back to the board to find today’s sailings.' }),
          h('div', { class: 'state__action' }, h('a', { class: 'btn btn--primary', href: '/' }, 'Back to the board')),
        ),
      ),
    );
    return;
  }

  if (match.route.auth && !state.user) {
    state.activeNav = '';
    const next = `${pathname}${search}`;
    navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    return;
  }

  state.activeNav = match.route.nav || '';
  renderHeader();
  document.title = `${match.route.title} · Ferry Timetable Notice Board`;
  mount(main, loadingPanel());

  const ctx = {
    params: match.params,
    search: new URLSearchParams(search),
    user: state.user,
    setUser,
    navigate,
    reload: () => renderRoute(),
    errorView,
  };

  try {
    const node = await match.route.page(ctx);
    if (token !== renderToken) return;
    mount(main, node);
  } catch (error) {
    if (token !== renderToken) return;
    console.error(`[route ${pathname}]`, error);
    mount(main, errorView(error, ctx.reload));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ------------------------------ chrome ------------------------------ */

function navLinks(links, extraClass) {
  return h(
    'ul',
    { class: `nav-list ${extraClass || ''}`.trim() },
    ...links.map((link) =>
      h(
        'li',
        {},
        h(
          'a',
          {
            href: link.href,
            class: 'nav-link',
            'aria-current': state.activeNav === link.key ? 'page' : null,
          },
          link.label,
        ),
      ),
    ),
  );
}

function brandMark() {
  return h('img', { src: '/favicon.svg', alt: '', width: '30', height: '30', class: 'brand__mark' });
}

function renderHeader() {
  const header = document.getElementById('site-header');

  const account = state.user
    ? h(
        'div',
        { class: 'topbar__account' },
        h('span', { class: 'topbar__identity' }, 'Signed in as ', h('strong', { text: state.user.name })),
        h('button', {
          type: 'button',
          class: 'btn btn--ghost btn--sm',
          text: 'Sign out',
          onclick: async () => {
            try {
              await api.post('/api/auth/logout', {});
            } catch {
              /* clearing the local session below is still the right move */
            }
            setUser(null);
            navigate('/login', { replace: true });
          },
        }),
      )
    : h('div', { class: 'topbar__account' }, h('a', { class: 'btn btn--ghost btn--sm', href: '/login' }, 'Staff sign in'));

  mount(
    header,
    h(
      'div',
      { class: 'topbar__inner' },
      h(
        'a',
        { class: 'brand', href: '/', 'aria-label': 'Ferry Timetable Notice Board — home' },
        brandMark(),
        h(
          'span',
          { class: 'brand__text' },
          h('span', { class: 'brand__name', text: 'Ferry Board' }),
          h('span', { class: 'brand__sub', text: 'Timetable & notices' }),
        ),
      ),
      h('nav', { class: 'topbar__nav', 'aria-label': 'Public pages' }, navLinks(PUBLIC_LINKS)),
      account,
    ),
    state.user
      ? h(
          'div',
          { class: 'subnav' },
          h('div', { class: 'subnav__inner' },
            h('span', { class: 'subnav__label', text: 'Staff console' }),
            h('nav', { 'aria-label': 'Staff pages' }, navLinks(STAFF_LINKS, 'nav-list--staff')),
          ),
        )
      : null,
  );
}

/* ------------------------------ boot ------------------------------ */

function interceptLinks() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => renderRoute());
}

async function boot() {
  interceptLinks();
  await refreshUser();
  renderRoute();
}

boot().catch((error) => {
  console.error('[boot]', error);
  const main = document.getElementById('main');
  if (main) mount(main, errorPanel('The board could not start. Please reload the page.'));
});

import { h, timeAgo } from '../lib/dom.js';
import { api } from '../lib/api.js';
import {
  bento,
  emptyPanel,
  pageIntro,
  panel,
  severityBadge,
  statCell,
} from '../lib/ui.js';

function departureRow(departure) {
  return h(
    'li',
    { class: 'departure' },
    h('span', { class: 'departure__time', text: departure.departureTime }),
    h(
      'span',
      { class: 'departure__body' },
      h('span', { class: 'departure__pier', text: departure.pierName }),
      h('span', {
        class: 'departure__meta',
        text: `${departure.vesselName} · arrives ${departure.arrivalTime} · ${departure.vehicleCapacity} vehicle spaces`,
      }),
    ),
  );
}

function worstSeverity(notices) {
  if (notices.some((notice) => notice.severity === 'Critical')) return 'Critical';
  if (notices.some((notice) => notice.severity === 'Warning')) return 'Warning';
  return 'Info';
}

export async function render(ctx) {
  const board = await api.get('/api/board');
  const departures = board.departures.slice(0, 7);
  const notices = board.notices;

  const serviceCell = h(
    'section',
    { class: 'cell cell--accent' },
    h('p', { class: 'cell__label', text: 'Service status' }),
    notices.length
      ? h(
          'div',
          { class: 'status-summary' },
          h('div', { class: 'status-summary__head' }, severityBadge(worstSeverity(notices)), h('span', { text: `${notices.length} published ${notices.length === 1 ? 'notice' : 'notices'}` })),
          h('p', { class: 'status-summary__title', text: notices[0].title }),
          h('p', { class: 'status-summary__meta', text: `${notices[0].pierName || 'All piers'} · ${timeAgo(notices[0].publishedAt)}` }),
        )
      : h('p', { class: 'cell__note', text: 'No disruptions reported. All sailings are running to timetable.' }),
    h('a', { class: 'cell__link', href: '/notices' }, 'Read the notice board'),
  );

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: `${board.weekdayName} · ${board.departures.length} sailings today`,
      title: 'Today’s ferry board',
      description:
        'Weekly crossings by pier, disruption notices and vehicle-deck space for the North Quay, Harbour Point and Cliffside Landing service.',
      actions: h('a', { class: 'btn btn--primary', href: '/timetable' }, 'Open the timetable'),
    }),
    bento(
      panel({
        title: 'Next departures',
        subtitle: 'Active crossings for today, soonest first',
        ticked: true,
        className: 'cell--anchor',
        actions: h('a', { class: 'cell__link', href: '/timetable' }, 'Full timetable'),
        children: departures.length
          ? h('ul', { class: 'departure-list' }, ...departures.map(departureRow))
          : emptyPanel({
              title: 'No sailings scheduled today',
              message: 'There are no active crossings for today. Check another weekday on the timetable.',
              action: h('a', { class: 'btn btn--primary', href: '/timetable' }, 'Choose a weekday'),
            }),
      }),
      serviceCell,
      panel({
        title: 'Vehicle deck',
        subtitle: 'Space is limited and reviewed by the pier office',
        children: h(
          'div',
          { class: 'stack' },
          h('p', {
            class: 'cell__note',
            text: 'Request deck space for a car, van, campervan or motorcycle. You get a booking reference immediately and a decision by email.',
          }),
          h('a', { class: 'btn btn--primary btn--block', href: '/book' }, 'Request deck space'),
        ),
      }),
      panel({
        title: 'Passenger information',
        subtitle: 'Timetable changes and planned works',
        children: h(
          'div',
          { class: 'stack' },
          h('p', {
            class: 'cell__note',
            text: 'Every published notice appears on the timetable for the piers it affects, so you always see the disruption next to the sailing.',
          }),
          h('a', { class: 'btn btn--secondary btn--block', href: '/notices' }, 'View all notices'),
        ),
      }),
      panel({
        title: 'Piers served',
        subtitle: 'Three landings, one weekly timetable',
        className: 'cell--wide',
        children: h(
          'ul',
          { class: 'pier-list' },
          ...board.piers.map((pier) =>
            h(
              'li',
              { class: 'pier' },
              h('span', { class: 'pier__code', text: pier.code }),
              h(
                'span',
                { class: 'pier__body' },
                h('span', { class: 'pier__name', text: pier.name }),
                h('span', {
                  class: 'pier__meta',
                  text: pier.crossingsToday
                    ? `${pier.crossingsToday} crossings today · first at ${pier.firstDeparture}`
                    : 'No crossings scheduled today',
                }),
              ),
            ),
          ),
        ),
      }),
      statCell({
        label: 'Published notices',
        value: String(board.publishedNotices),
        note: board.publishedNotices === 0 ? 'Nothing reported — normal service.' : 'Live on the timetable banner',
        action: h('a', { class: 'cell__link', href: '/notices' }, 'Open notices'),
      }),
      stateStaffCell(ctx),
    ),
  );
}

function stateStaffCell(ctx) {
  return panel({
    title: 'Staff console',
    subtitle: ctx.user ? 'Operations tools for the crew' : 'For pier operations staff',
    children: ctx.user
      ? h(
          'div',
          { class: 'stack' },
          h('p', { class: 'cell__note', text: `Signed in as ${ctx.user.name}. Review deck requests and keep the board current.` }),
          h('a', { class: 'btn btn--secondary btn--block', href: '/dashboard' }, 'Open the dashboard'),
        )
      : h(
          'div',
          { class: 'stack' },
          h('p', {
            class: 'cell__note',
            text: 'Sign in to review vehicle-deck requests, edit the timetable and publish disruption notices.',
          }),
          h('a', { class: 'btn btn--secondary btn--block', href: '/login' }, 'Staff sign in'),
        ),
  });
}

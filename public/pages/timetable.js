import { h, mount, duration, todayWeekday, WEEKDAYS } from '../lib/dom.js';
import { api } from '../lib/api.js';
import {
  dataTable,
  emptyPanel,
  errorPanel,
  field,
  loadingPanel,
  pageIntro,
  panel,
  severityBadge,
} from '../lib/ui.js';

function noticeBanner(notices, pierName) {
  return h(
    'section',
    { class: `banner${notices.length ? '' : ' banner--clear'}`, 'aria-label': 'Service notices for this pier' },
    h(
      'div',
      { class: 'banner__head' },
      h('h2', { class: 'banner__title', text: 'Service notices' }),
      h('a', { class: 'banner__link', href: '/notices' }, 'All notices'),
    ),
    notices.length
      ? h(
          'ul',
          { class: 'banner__list' },
          ...notices.map((notice) =>
            h(
              'li',
              { class: 'banner__item' },
              severityBadge(notice.severity),
              h(
                'div',
                { class: 'banner__body' },
                h('p', { class: 'banner__item-title', text: notice.title }),
                h('p', { class: 'banner__item-meta', text: notice.body }),
              ),
            ),
          ),
        )
      : h('p', { class: 'banner__empty', text: `No disruptions reported for ${pierName}. Sailings are running to the published timetable.` }),
  );
}

function timetableTable(crossings) {
  return dataTable({
    caption: 'Active crossings for the selected pier and weekday',
    columns: [
      { label: 'Departure' },
      { label: 'Arrival' },
      { label: 'Crossing time' },
      { label: 'Vessel' },
      { label: 'Vehicle deck', numeric: true },
    ],
    rows: crossings.map((crossing) => ({
      key: crossing.id,
      cells: [
        h('span', { class: 'time', text: crossing.departureTime }),
        h('span', { class: 'time', text: crossing.arrivalTime }),
        duration(crossing.durationMinutes),
        crossing.vesselName,
        `${crossing.vehicleCapacity} spaces`,
      ],
    })),
  });
}

export async function render(ctx) {
  const piersPayload = await api.get('/api/piers');
  const piers = piersPayload.piers;

  if (!piers.length) {
    return h(
      'div',
      { class: 'page' },
      pageIntro({ title: 'Timetable', description: 'Weekly crossings per pier.' }),
      emptyPanel({
        title: 'No piers are configured',
        message: 'An administrator needs to add a pier before sailings can be published.',
      }),
    );
  }

  const requestedPier = ctx.search.get('pier');
  let pierId = piers.some((pier) => pier.id === requestedPier) ? requestedPier : piers[0].id;
  const requestedWeekday = ctx.search.get('weekday');
  let weekday = requestedWeekday !== null && /^[0-6]$/.test(requestedWeekday) ? Number(requestedWeekday) : todayWeekday();

  const writeUrl = () => {
    const canonical = `/timetable?pier=${encodeURIComponent(pierId)}&weekday=${weekday}`;
    if (`${window.location.pathname}${window.location.search}` !== canonical) {
      window.history.replaceState({}, '', canonical);
    }
  };
  writeUrl();

  const pierField = field({
    id: 'timetable-pier',
    label: 'Pier',
    type: 'select',
    value: pierId,
    options: piers.map((pier) => ({ value: pier.id, label: `${pier.name} (${pier.code})` })),
  });
  const weekdayField = field({
    id: 'timetable-weekday',
    label: 'Weekday',
    type: 'select',
    value: String(weekday),
    options: WEEKDAYS.map((name, index) => ({ value: String(index), label: name })),
  });
  const todayButton = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: 'Jump to today' });

  const resultsLine = h('p', { class: 'results-line', role: 'status' });
  const content = h('div', { class: 'stack stack--lg' });

  const filters = h(
    'div',
    { class: 'filters' },
    pierField.wrapper,
    weekdayField.wrapper,
    h('div', { class: 'filters__actions' }, todayButton),
  );

  const pageNode = h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Weekly timetable',
      title: 'Crossings by pier and weekday',
      description:
        'Only active sailings are shown here. Service notices for this pier and for all piers appear above the timetable.',
    }),
    panel({ children: filters, ticked: true }),
    content,
  );

  const currentPierName = () => (piers.find((pier) => pier.id === pierId) || piers[0]).name;

  async function load({ showSkeleton = true } = {}) {
    if (showSkeleton) mount(content, loadingPanel('Loading the timetable…'));
    try {
      const data = await api.get(`/api/timetable?pier=${encodeURIComponent(pierId)}&weekday=${weekday}`);
      resultsLine.textContent = `${data.crossings.length} active ${data.crossings.length === 1 ? 'sailing' : 'sailings'} from ${data.pier.name} on ${data.weekdayName}.`;
      mount(
        content,
        resultsLine,
        noticeBanner(data.notices, data.pier.name),
        data.crossings.length
          ? timetableTable(data.crossings)
          : emptyPanel({
              title: 'No published sailings',
              message: `There are no active crossings from ${data.pier.name} on a ${data.weekdayName}. Try another pier or weekday.`,
              action: h('button', {
                class: 'btn btn--primary',
                type: 'button',
                text: 'Show today’s sailings',
                onclick: () => {
                  weekday = todayWeekday();
                  weekdayField.setValue(String(weekday));
                  writeUrl();
                  load();
                },
              }),
            }),
      );
    } catch (error) {
      if (error && error.status === 401) throw error;
      mount(content, errorPanel(error.message, () => load()));
    }
  }

  pierField.control.addEventListener('change', () => {
    pierId = pierField.control.value;
    writeUrl();
    load();
  });
  weekdayField.control.addEventListener('change', () => {
    weekday = Number(weekdayField.control.value);
    writeUrl();
    load();
  });
  todayButton.addEventListener('click', () => {
    weekday = todayWeekday();
    weekdayField.setValue(String(weekday));
    writeUrl();
    load();
  });

  await load({ showSkeleton: false });
  return pageNode;
}

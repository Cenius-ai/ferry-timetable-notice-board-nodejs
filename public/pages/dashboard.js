import { h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { bento, dataTable, emptyPanel, pageIntro, panel, statCell } from '../lib/ui.js';

function greetingFor(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = name.split(' ')[0];
  return `${part}, ${firstName}`;
}

function quickLink(href, label, description) {
  return h(
    'a',
    { class: 'quick-link', href },
    h('span', { class: 'quick-link__label', text: label }),
    h('span', { class: 'quick-link__description', text: description }),
  );
}

export async function render(ctx) {
  const data = await api.get('/api/dashboard');
  const counts = data.counts;
  const departures = data.departures;

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: `Staff console · ${data.weekdayName}`,
      title: greetingFor(data.user.name),
      description: 'Everything the pier office should act on today: deck requests waiting for a decision, notices live on the board and sailings on the water.',
      actions: h('a', { class: 'btn btn--primary', href: '/staff/bookings?status=Pending' }, 'Review pending requests'),
    }),
    bento(
      statCell({
        label: 'Pending deck requests',
        value: String(counts.pendingBookings),
        note: counts.pendingBookings === 0 ? 'Queue is clear — nothing waiting on a decision.' : 'Waiting for a decision',
        tone: 'accent',
        action:
          counts.pendingBookings > 0
            ? h('a', { class: 'cell__link', href: '/staff/bookings?status=Pending' }, 'Open the queue')
            : null,
      }),
      statCell({
        label: 'Published notices',
        value: String(counts.publishedNotices),
        note: counts.publishedNotices === 0 ? 'No live notices — normal service.' : 'Live on the timetable banner',
        action: h('a', { class: 'cell__link', href: '/staff/notices' }, 'Manage notices'),
      }),
      statCell({
        label: 'Active crossings today',
        value: String(counts.activeCrossingsToday),
        note:
          counts.activeCrossingsToday === 0
            ? 'No sailings scheduled for today.'
            : `Across ${counts.piers} piers on ${data.weekdayName}`,
        action: h('a', { class: 'cell__link', href: '/staff/timetable' }, 'Manage timetable'),
      }),
      statCell({
        label: 'Draft notices',
        value: String(counts.draftNotices),
        note: counts.draftNotices === 0 ? 'Every notice is published.' : 'Hidden from the public board',
        action: h('a', { class: 'cell__link', href: '/staff/notices' }, 'Finish a draft'),
      }),
      panel({
        title: 'Today’s departures',
        subtitle: `Active sailings for ${data.weekdayName} across all piers`,
        ticked: true,
        className: 'cell--anchor',
        actions: h('a', { class: 'cell__link', href: '/timetable' }, 'Public timetable'),
        children: departures.length
          ? dataTable({
              caption: 'Today’s active departures',
              columns: [{ label: 'Departure' }, { label: 'Pier' }, { label: 'Vessel' }, { label: 'Deck', numeric: true }],
              rows: departures.map((departure) => ({
                key: departure.id,
                cells: [
                  h('span', { class: 'time', text: departure.departureTime }),
                  departure.pierName,
                  departure.vesselName,
                  `${departure.vehicleCapacity} spaces`,
                ],
              })),
            })
          : emptyPanel({
              title: 'No sailings today',
              message: 'Nothing is scheduled for today. Add a crossing or check the timetable for another weekday.',
              action: h('a', { class: 'btn btn--primary', href: '/staff/timetable/new' }, 'Create a crossing'),
            }),
      }),
      panel({
        title: 'Quick actions',
        subtitle: 'The jobs that keep the board accurate',
        children: h(
          'div',
          { class: 'quick-links' },
          quickLink('/staff/bookings', 'Review bookings', `Approve or decline deck requests (${counts.pendingBookings} pending)`),
          quickLink('/staff/timetable', 'Manage timetable', `${counts.totalCrossings} crossings including inactive sailings`),
          quickLink('/staff/notices', 'Write a notice', `${counts.publishedNotices} published, ${counts.draftNotices} draft`),
          quickLink('/notices', 'View public board', 'See exactly what passengers see'),
        ),
      }),
    ),
  );
}

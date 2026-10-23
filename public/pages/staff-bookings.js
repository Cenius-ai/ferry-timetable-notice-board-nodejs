import { h, clear, mount, formatDateShort, formatDateTime, timeAgo } from '../lib/dom.js';
import { ApiError, api } from '../lib/api.js';
import {
  alertBanner,
  dataTable,
  emptyPanel,
  field,
  pageIntro,
  panel,
  statePanel,
  statusBadge,
} from '../lib/ui.js';

const FILTERS = ['All', 'Pending', 'Approved', 'Declined'];

function filterTabs(counts, active) {
  return h(
    'nav',
    { class: 'tabs', 'aria-label': 'Filter by status' },
    ...FILTERS.map((filter) =>
      h(
        'a',
        {
          class: `tab${active === filter ? ' tab--active' : ''}`,
          href: `/staff/bookings${filter === 'All' ? '' : `?status=${filter}`}`,
          'aria-current': active === filter ? 'page' : null,
        },
        h('span', { text: filter }),
        h('span', { class: 'tab__count', text: String(counts[filter === 'All' ? 'all' : filter] ?? 0) }),
      ),
    ),
  );
}

export async function render(ctx) {
  const requested = ctx.search.get('status') || 'All';
  const active = FILTERS.includes(requested) ? requested : 'All';
  const data = await api.get(`/api/staff/bookings${active === 'All' ? '' : `?status=${encodeURIComponent(active)}`}`);

  const rows = data.bookings.map((booking) => ({
    key: booking.id,
    cells: [
      h('span', { class: 'mono', text: booking.reference }),
      booking.passengerName,
      booking.pierName,
      booking.departureTime ? `${booking.departureTime} · ${booking.vesselName}` : 'Crossing withdrawn',
      formatDateShort(booking.travelDate),
      `${booking.vehicleType} · ${booking.vehicleLength} m`,
      statusBadge(booking.status),
      h('a', { class: 'btn btn--ghost btn--sm', href: `/staff/bookings/${encodeURIComponent(booking.id)}` }, 'Review'),
    ],
  }));

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Staff console',
      title: 'Vehicle deck requests',
      description: 'Newest first. Approving or declining records your name and the decision time against the request.',
      actions: h('a', { class: 'btn btn--secondary', href: '/dashboard' }, 'Back to dashboard'),
    }),
    h(
      'div',
      { class: 'stack' },
      filterTabs(data.counts, active),
      data.bookings.length
        ? dataTable({
            caption: 'Booking requests',
            columns: [
              { label: 'Reference' },
              { label: 'Passenger' },
              { label: 'Pier' },
              { label: 'Departure' },
              { label: 'Travel date' },
              { label: 'Vehicle' },
              { label: 'Status' },
              { label: 'Action' },
            ],
            rows,
          })
        : emptyPanel({
            title: active === 'All' ? 'No booking requests yet' : `No ${active.toLowerCase()} requests`,
            message:
              active === 'All'
                ? 'Requests submitted from the public booking form appear here for review.'
                : `Nothing in this queue right now. Clear the filter to see the whole queue.`,
            action:
              active === 'All'
                ? h('a', { class: 'btn btn--primary', href: '/book' }, 'Open the public booking form')
                : h('a', { class: 'btn btn--primary', href: '/staff/bookings' }, 'Show all requests'),
          }),
    ),
  );
}

function detailList(booking) {
  const entries = [
    ['Passenger', booking.passengerName],
    ['Email', booking.email],
    ['Phone', booking.phone],
    ['Pier', booking.pierName],
    ['Sailing', booking.departureTime ? `${booking.departureTime} → ${booking.arrivalTime} · ${booking.vesselName}` : 'Crossing withdrawn'],
    ['Travel date', `${formatDateShort(booking.travelDate)} (${booking.weekdayName || '—'})`],
    ['Vehicle', `${booking.vehicleType} · ${booking.vehicleLength} m`],
    ['Requested', timeAgo(booking.createdAt)],
  ];
  return h(
    'dl',
    { class: 'detail-list' },
    ...entries.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: String(value) })]),
  );
}

function decisionSummary(booking) {
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'decision-head' }, statusBadge(booking.status), h('span', { class: 'cell__note', text: `Decided ${timeAgo(booking.decidedAt)}` })),
    h(
      'dl',
      { class: 'detail-list' },
      h('dt', { text: 'Reviewer' }),
      h('dd', { text: booking.reviewerName || 'Unknown reviewer' }),
      h('dt', { text: 'Decision time' }),
      h('dd', { text: formatDateTime(booking.decidedAt) }),
      booking.declineReason ? h('dt', { text: 'Decline reason' }) : null,
      booking.declineReason ? h('dd', { text: booking.declineReason }) : null,
    ),
    h('p', { class: 'cell__note', text: 'Decisions are final in this MVP and are recorded against the request for the audit trail.' }),
  );
}

function decisionForm(booking, onDecided) {
  const reasonField = field({
    id: 'decline-reason',
    label: 'Decline reason',
    type: 'textarea',
    rows: 3,
    required: false,
    placeholder: 'Tell the passenger why deck space cannot be offered…',
    hint: 'Required when you decline. The passenger sees this wording.',
  });
  const banner = h('div', { class: 'form__banner' });
  const approveButton = h('button', { type: 'button', class: 'btn btn--primary', text: 'Approve request' });
  const declineButton = h('button', { type: 'button', class: 'btn btn--danger', text: 'Decline request' });
  let busy = false;

  async function decide(action) {
    if (busy) return;
    clear(banner);
    reasonField.clearError();
    if (action === 'decline' && reasonField.getValue().trim().length < 5) {
      reasonField.setError('Give a short reason so the passenger knows why the request was declined.');
      reasonField.control.focus();
      return;
    }
    busy = true;
    approveButton.disabled = true;
    declineButton.disabled = true;
    const activeButton = action === 'approve' ? approveButton : declineButton;
    const originalLabel = activeButton.textContent;
    activeButton.textContent = action === 'approve' ? 'Approving…' : 'Declining…';
    try {
      const payload = await api.post(`/api/staff/bookings/${encodeURIComponent(booking.id)}/decision`, {
        action,
        reason: reasonField.getValue().trim(),
      });
      onDecided(payload.booking);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error.fields && error.fields.reason) reasonField.setError(error.fields.reason);
      banner.appendChild(alertBanner(error.message || 'The decision could not be saved. Please try again.'));
      busy = false;
      approveButton.disabled = false;
      declineButton.disabled = false;
      activeButton.textContent = originalLabel;
    }
  }

  approveButton.addEventListener('click', () => decide('approve'));
  declineButton.addEventListener('click', () => decide('decline'));

  return h(
    'div',
    { class: 'stack' },
    banner,
    reasonField.wrapper,
    h('div', { class: 'form__actions' }, approveButton, declineButton),
    h('p', { class: 'cell__note', text: 'Approving records you as the reviewer and stamps the decision time.' }),
  );
}

export async function renderDetail(ctx) {
  const container = h('div', { class: 'page' });
  let booking = null;

  function paint() {
    const decisionCell = panel({
      title: booking.status === 'Pending' ? 'Make a decision' : 'Decision',
      subtitle: booking.status === 'Pending' ? 'Approve or decline this deck request.' : 'Recorded against this request.',
      ticked: booking.status === 'Pending',
      children:
        booking.status === 'Pending'
          ? decisionForm(booking, (updated) => {
              booking = updated;
              paint();
            })
          : decisionSummary(booking),
    });

    mount(
      container,
      pageIntro({
        eyebrow: `Booking ${booking.reference}`,
        title: booking.passengerName,
        description: `Requested ${timeAgo(booking.createdAt)} for the ${booking.departureTime || 'withdrawn'} sailing from ${booking.pierName}.`,
        actions: h('div', { class: 'stack stack--row' }, statusBadge(booking.status), h('a', { class: 'btn btn--ghost btn--sm', href: '/staff/bookings' }, 'Back to queue')),
      }),
      h(
        'div',
        { class: 'detail-layout' },
        panel({ title: 'Request details', children: detailList(booking) }),
        decisionCell,
      ),
      booking.notes ? panel({ title: 'Passenger notes', children: h('p', { class: 'cell__note', text: booking.notes }) }) : null,
    );
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  try {
    const payload = await api.get(`/api/staff/bookings/${encodeURIComponent(ctx.params.id)}`);
    booking = payload.booking;
    paint();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (error instanceof ApiError && error.status === 404) {
      mount(
        container,
        pageIntro({ eyebrow: 'Staff console', title: 'Booking not found' }),
        statePanel({
          tone: 'empty',
          title: 'That request is not in the queue',
          message: 'It may have been created under a different reference, or the link is out of date.',
          action: h('a', { class: 'btn btn--primary', href: '/staff/bookings' }, 'Back to the queue'),
        }),
      );
    } else {
      throw error;
    }
  }

  return container;
}

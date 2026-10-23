import { h, clear, mount, WEEKDAYS } from '../lib/dom.js';
import { ApiError, api } from '../lib/api.js';
import {
  alertBanner,
  confirmAction,
  dataTable,
  emptyPanel,
  field,
  pageIntro,
  panel,
  statePanel,
  statusBadge,
} from '../lib/ui.js';

function crossingPayload(crossing, active) {
  return {
    pierId: crossing.pierId,
    weekday: crossing.weekday,
    departureTime: crossing.departureTime,
    arrivalTime: crossing.arrivalTime,
    vesselName: crossing.vesselName,
    vehicleCapacity: crossing.vehicleCapacity,
    active,
  };
}

export async function render(ctx) {
  const data = await api.get('/api/staff/crossings');
  const crossings = data.crossings;

  const rows = crossings.map((crossing) => {
    const rowStatus = h('span', { class: 'confirm__status', role: 'status' });
    return {
      key: crossing.id,
      className: crossing.active ? null : 'is-inactive',
      cells: [
        `${crossing.pierName} (${crossing.pierCode})`,
        crossing.weekdayName,
        h('span', { class: 'time', text: crossing.departureTime }),
        h('span', { class: 'time', text: crossing.arrivalTime }),
        crossing.vesselName,
        `${crossing.vehicleCapacity}`,
        statusBadge(crossing.active ? 'Active' : 'Inactive'),
        h(
          'div',
          { class: 'row-actions' },
          h('a', { class: 'btn btn--ghost btn--sm', href: `/staff/timetable/${encodeURIComponent(crossing.id)}/edit` }, 'Edit'),
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            text: crossing.active ? 'Deactivate' : 'Activate',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await api.put(`/api/staff/crossings/${encodeURIComponent(crossing.id)}`, crossingPayload(crossing, !crossing.active));
                ctx.reload();
              } catch (error) {
                button.disabled = false;
                rowStatus.textContent = error.message || 'Could not update the crossing.';
              }
            },
          }),
          confirmAction({
            label: 'Delete',
            question: `Delete ${crossing.weekdayName} ${crossing.departureTime}?`,
            confirmLabel: 'Delete crossing',
            onConfirm: async () => {
              await api.del(`/api/staff/crossings/${encodeURIComponent(crossing.id)}`);
              ctx.reload();
            },
          }),
          rowStatus,
        ),
      ],
    };
  });

  const activeCount = crossings.filter((crossing) => crossing.active).length;

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Staff console',
      title: 'Crossing timetable',
      description: `${crossings.length} crossings on file, ${activeCount} active. Inactive sailings stay here but disappear from the public timetable and booking departures.`,
      actions: h('a', { class: 'btn btn--primary', href: '/staff/timetable/new' }, 'New crossing'),
    }),
    crossings.length
      ? dataTable({
          caption: 'All crossings including inactive sailings',
          columns: [
            { label: 'Pier' },
            { label: 'Day' },
            { label: 'Depart' },
            { label: 'Arrive' },
            { label: 'Vessel' },
            { label: 'Deck', numeric: true },
            { label: 'Status' },
            { label: 'Actions' },
          ],
          rows,
        })
      : emptyPanel({
          title: 'No crossings yet',
          message: 'Add the first sailing and it will appear on the public timetable for that pier and weekday.',
          action: h('a', { class: 'btn btn--primary', href: '/staff/timetable/new' }, 'Create the first crossing'),
        }),
  );
}

export async function renderForm(ctx) {
  const isEdit = Boolean(ctx.params.id);
  const [piersPayload, crossingsPayload] = await Promise.all([api.get('/api/piers'), api.get('/api/staff/crossings')]);
  const piers = piersPayload.piers;

  let existing = null;
  if (isEdit) {
    existing = crossingsPayload.crossings.find((crossing) => crossing.id === ctx.params.id) || null;
    if (!existing) {
      return h(
        'div',
        { class: 'page' },
        pageIntro({ eyebrow: 'Staff console', title: 'Crossing not found' }),
        statePanel({
          tone: 'empty',
          title: 'That crossing is no longer on file',
          message: 'It may have been deleted. Head back to the timetable to pick another sailing.',
          action: h('a', { class: 'btn btn--primary', href: '/staff/timetable' }, 'Back to the timetable'),
        }),
      );
    }
  }

  const pierField = field({
    id: 'crossing-pier',
    label: 'Pier',
    type: 'select',
    value: existing ? existing.pierId : piers[0] && piers[0].id,
    required: true,
    options: piers.map((pier) => ({ value: pier.id, label: `${pier.name} (${pier.code})` })),
  });
  const weekdayField = field({
    id: 'crossing-weekday',
    label: 'Weekday',
    type: 'select',
    value: String(existing ? existing.weekday : new Date().getDay()),
    required: true,
    options: WEEKDAYS.map((name, index) => ({ value: String(index), label: name })),
  });
  const departureField = field({
    id: 'crossing-departure',
    label: 'Departure time',
    type: 'time',
    value: existing ? existing.departureTime : '09:00',
    required: true,
  });
  const arrivalField = field({
    id: 'crossing-arrival',
    label: 'Arrival time',
    type: 'time',
    value: existing ? existing.arrivalTime : '09:45',
    required: true,
    hint: 'Must be later than the departure time.',
  });
  const vesselField = field({
    id: 'crossing-vessel',
    label: 'Vessel name',
    value: existing ? existing.vesselName : '',
    required: true,
    placeholder: 'MV Northwind',
  });
  const capacityField = field({
    id: 'crossing-capacity',
    label: 'Vehicle capacity',
    type: 'number',
    value: existing ? String(existing.vehicleCapacity) : '36',
    required: true,
    min: '1',
    max: '500',
    step: '1',
    inputmode: 'numeric',
    hint: 'Number of vehicles the deck can take.',
  });
  const activeField = field({
    id: 'crossing-active',
    label: 'Active on the public timetable',
    type: 'checkbox',
    checkboxLabel: 'Active — show this sailing publicly and offer it in booking departures',
    value: existing ? existing.active : true,
  });

  const banner = h('div', { class: 'form__banner' });
  const submitButton = h('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'Save crossing' : 'Create crossing' });

  const form = h(
    'form',
    { class: 'form', novalidate: true },
    banner,
    h(
      'div',
      { class: 'form__grid' },
      pierField.wrapper,
      weekdayField.wrapper,
      departureField.wrapper,
      arrivalField.wrapper,
      vesselField.wrapper,
      capacityField.wrapper,
    ),
    activeField.wrapper,
    h(
      'div',
      { class: 'form__actions' },
      submitButton,
      h('a', { class: 'btn btn--ghost', href: '/staff/timetable' }, 'Cancel'),
    ),
  );

  const fields = { pierId: pierField, weekday: weekdayField, departureTime: departureField, arrivalTime: arrivalField, vesselName: vesselField, vehicleCapacity: capacityField };
  let submitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clear(banner);
    for (const entry of Object.values(fields)) entry.clearError();

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = isEdit ? 'Saving…' : 'Creating…';
    try {
      const payload = {
        pierId: pierField.getValue(),
        weekday: Number(weekdayField.getValue()),
        departureTime: departureField.getValue(),
        arrivalTime: arrivalField.getValue(),
        vesselName: vesselField.getValue().trim(),
        vehicleCapacity: Number(capacityField.getValue()),
        active: activeField.getValue(),
      };
      if (isEdit) await api.put(`/api/staff/crossings/${encodeURIComponent(existing.id)}`, payload);
      else await api.post('/api/staff/crossings', payload);
      ctx.navigate('/staff/timetable');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error.fields) {
        for (const [key, message] of Object.entries(error.fields)) {
          if (fields[key]) fields[key].setError(message);
        }
      }
      banner.appendChild(alertBanner(error.message || 'The crossing could not be saved.'));
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = isEdit ? 'Save crossing' : 'Create crossing';
    }
  });

  return h(
    'div',
    { class: 'page page--narrow' },
    pageIntro({
      eyebrow: 'Staff console',
      title: isEdit ? 'Edit crossing' : 'New crossing',
      description: isEdit
        ? 'Changes reach the public timetable as soon as you save.'
        : 'Active crossings appear on the public timetable and in booking departure options.',
      actions: h('a', { class: 'btn btn--ghost', href: '/staff/timetable' }, 'Back to timetable'),
    }),
    panel({ ticked: true, children: form }),
  );
}

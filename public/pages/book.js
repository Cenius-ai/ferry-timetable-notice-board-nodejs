import { h, clear, mount, addDays, formatDateMedium, isoFromDate, parseDateOnly, todayIso, weekdayName } from '../lib/dom.js';
import { ApiError, api } from '../lib/api.js';
import { alertBanner, emptyPanel, field, pageIntro, panel, statusBadge } from '../lib/ui.js';

const VEHICLE_TYPES = ['Car', 'Car with trailer', 'Campervan', 'Light van', 'Motorcycle'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function setOptions(select, options) {
  clear(select);
  for (const option of options) {
    select.appendChild(h('option', { value: option.value, selected: option.selected || false }, option.label));
  }
}

function successPanel(result, ctx) {
  const booking = result.booking;
  return h(
    'div',
    { class: 'book-layout' },
    panel({
      ticked: true,
      className: 'cell--accent',
      children: h(
        'div',
        { class: 'success' },
        h('p', { class: 'eyebrow', text: 'Request received' }),
        h('p', { class: 'success__reference', text: result.reference }),
        h('div', { class: 'success__status' }, statusBadge('Pending')),
        h('p', {
          class: 'success__message',
          text: `${booking.passengerName}, your vehicle-deck request is pending review. Keep the reference above — the pier office will confirm or decline it, usually within one working day.`,
        }),
        h(
          'dl',
          { class: 'detail-list' },
          h('dt', { text: 'Pier' }),
          h('dd', { text: booking.pierName }),
          h('dt', { text: 'Departure' }),
          h('dd', { text: `${booking.departureTime} · ${booking.vesselName}` }),
          h('dt', { text: 'Travel date' }),
          h('dd', { text: `${formatDateMedium(booking.travelDate)} (${booking.weekdayName})` }),
          h('dt', { text: 'Vehicle' }),
          h('dd', { text: `${booking.vehicleType} · ${booking.vehicleLength} m` }),
          h('dt', { text: 'Contact' }),
          h('dd', { text: `${booking.email} · ${booking.phone}` }),
          booking.notes ? h('dt', { text: 'Notes' }) : null,
          booking.notes ? h('dd', { text: booking.notes }) : null,
        ),
        h(
          'div',
          { class: 'form__actions' },
          h('button', { class: 'btn btn--primary', type: 'button', text: 'Make another request', onclick: () => ctx.reload() }),
          h('a', { class: 'btn btn--secondary', href: '/timetable' }, 'Back to the timetable'),
        ),
      ),
    }),
    panel({
      title: 'What happens next',
      children: h(
        'ol',
        { class: 'steps' },
        h('li', { text: 'The pier office checks the deck plan for your sailing.' }),
        h('li', { text: 'You get an approved or declined decision against your reference.' }),
        h('li', { text: 'Turn up 20 minutes before departure and quote the reference to the marshal.' }),
        h('li', { text: 'Deck space is released ten minutes before departure if you have not checked in.' }),
      ),
    }),
  );
}

export async function render(ctx) {
  const { piers } = await api.get('/api/piers');
  if (!piers.length) {
    return h(
      'div',
      { class: 'page' },
      pageIntro({ title: 'Request vehicle deck space' }),
      emptyPanel({ title: 'No piers are configured', message: 'Bookings open once a pier is published.' }),
    );
  }

  const defaultDate = addDays(new Date(), 1);
  const defaultDateIso = isoFromDate(defaultDate);

  const passengerField = field({
    id: 'booking-passenger',
    label: 'Passenger name',
    value: '',
    required: true,
    autocomplete: 'name',
    placeholder: 'Fiona MacLeod',
  });
  const emailField = field({
    id: 'booking-email',
    label: 'Email',
    type: 'email',
    required: true,
    autocomplete: 'email',
    placeholder: 'you@example.com',
    hint: 'The decision goes to this address.',
  });
  const phoneField = field({
    id: 'booking-phone',
    label: 'Phone',
    type: 'tel',
    required: true,
    autocomplete: 'tel',
    placeholder: '07700 900412',
  });
  const pierField = field({
    id: 'booking-pier',
    label: 'Pier',
    type: 'select',
    value: piers[0].id,
    required: true,
    options: piers.map((pier) => ({ value: pier.id, label: `${pier.name} (${pier.code})` })),
  });
  const dateField = field({
    id: 'booking-date',
    label: 'Travel date',
    type: 'date',
    value: defaultDateIso,
    required: true,
    min: todayIso(),
    hint: 'Departures are matched to the weekday of your travel date.',
  });
  const departureField = field({
    id: 'booking-departure',
    label: 'Departure',
    type: 'select',
    value: '',
    required: true,
    options: [{ value: '', label: 'Loading departures…' }],
  });
  const vehicleTypeField = field({
    id: 'booking-vehicle-type',
    label: 'Vehicle type',
    type: 'select',
    value: 'Car',
    required: true,
    options: VEHICLE_TYPES.map((type) => ({ value: type, label: type })),
  });
  const lengthField = field({
    id: 'booking-vehicle-length',
    label: 'Vehicle length (metres)',
    type: 'number',
    value: '4.5',
    required: true,
    min: '1',
    max: '30',
    step: '0.1',
    inputmode: 'decimal',
    hint: 'Include any trailer or rear rack.',
  });
  const notesField = field({
    id: 'booking-notes',
    label: 'Notes for the deck crew',
    type: 'textarea',
    value: '',
    required: false,
    rows: 3,
    placeholder: 'Roof box, bicycle rack, accessibility needs…',
  });

  const departureStatus = h('p', { class: 'field__hint field__hint--status', role: 'status' });
  const banner = h('div', { class: 'form__banner' });

  const submitButton = h('button', { class: 'btn btn--primary', type: 'submit', text: 'Send request' });
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    banner,
    h(
      'div',
      { class: 'form__grid' },
      passengerField.wrapper,
      emailField.wrapper,
      phoneField.wrapper,
      pierField.wrapper,
      dateField.wrapper,
      departureField.wrapper,
      vehicleTypeField.wrapper,
      lengthField.wrapper,
    ),
    departureStatus,
    notesField.wrapper,
    h('div', { class: 'form__actions' }, submitButton, h('a', { class: 'btn btn--ghost', href: '/' }, 'Cancel')),
  );

  const pageNode = h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Vehicle deck',
      title: 'Request vehicle deck space',
      description:
        'Tell us the sailing you want and what you are bringing. Requests are reviewed by the pier office and you get a booking reference straight away.',
    }),
    h(
      'div',
      { class: 'book-layout' },
      panel({ children: form, ticked: true }),
      panel({
        title: 'Before you book',
        children: h(
          'div',
          { class: 'stack' },
          h(
            'ol',
            { class: 'steps' },
            h('li', { text: 'Pick the pier and the date you are travelling.' }),
            h('li', { text: 'Choose a sailing from that day’s active departures.' }),
            h('li', { text: 'Tell us the vehicle type and length so the deck crew can plan the load.' }),
          ),
          h('p', {
            class: 'cell__note',
            text: 'Deck space is confirmed by the pier office, not by this request. Motorcycles and light vans are usually approved the same day.',
          }),
          h('p', { class: 'cell__note', text: 'Pier office: 01890 555 014, 07:00–20:00.' }),
        ),
      }),
    ),
  );

  let departuresAvailable = false;
  let submitting = false;

  async function loadDepartures() {
    const dateValue = dateField.getValue();
    const parsed = parseDateOnly(dateValue) || new Date();
    const weekday = parsed.getDay();
    departureStatus.textContent = 'Loading departures…';
    departureField.clearError();
    setOptions(departureField.control, [{ value: '', label: 'Loading departures…' }]);
    try {
      const data = await api.get(
        `/api/crossings?pierId=${encodeURIComponent(pierField.getValue())}&weekday=${weekday}`,
      );
      departuresAvailable = data.crossings.length > 0;
      if (departuresAvailable) {
        setOptions(
          departureField.control,
          data.crossings.map((crossing, index) => ({
            value: crossing.id,
            label: `${crossing.departureTime} → ${crossing.arrivalTime} · ${crossing.vesselName} · ${crossing.vehicleCapacity} spaces`,
            selected: index === 0,
          })),
        );
        departureStatus.textContent = `${data.crossings.length} active ${data.crossings.length === 1 ? 'sailing' : 'sailings'} on ${weekdayName(weekday)}.`;
        submitButton.disabled = false;
      } else {
        setOptions(departureField.control, [{ value: '', label: `No sailings on ${weekdayName(weekday)}` }]);
        departureStatus.textContent = `No scheduled sailings on ${weekdayName(weekday)} from this pier. Try another date or pier.`;
        submitButton.disabled = true;
      }
    } catch (error) {
      departuresAvailable = false;
      setOptions(departureField.control, [{ value: '', label: 'Departures unavailable' }]);
      departureStatus.textContent = 'Could not load departures. Change the date or pier to retry.';
      submitButton.disabled = false;
    }
  }

  pierField.control.addEventListener('change', loadDepartures);
  dateField.control.addEventListener('change', loadDepartures);

  function resetErrors() {
    for (const wrapper of [passengerField, emailField, phoneField, pierField, dateField, departureField, vehicleTypeField, lengthField, notesField]) {
      wrapper.clearError();
    }
    clear(banner);
  }

  function validate() {
    const errors = [];
    const name = passengerField.getValue().trim();
    if (name.length < 2) errors.push([passengerField, 'Passenger name is required.']);
    const email = emailField.getValue().trim();
    if (!email) errors.push([emailField, 'Email is required.']);
    else if (!EMAIL_PATTERN.test(email)) errors.push([emailField, 'Email must be a valid email address.']);
    const phone = phoneField.getValue().trim();
    if (phone.length < 6) errors.push([phoneField, 'Phone number is required.']);
    if (!pierField.getValue()) errors.push([pierField, 'Choose a pier.']);
    const date = dateField.getValue();
    if (!date) errors.push([dateField, 'Travel date is required.']);
    else if (date < todayIso()) errors.push([dateField, 'Travel date cannot be in the past.']);
    if (!departureField.getValue()) errors.push([departureField, 'Choose a departure.']);
    const length = Number(lengthField.getValue());
    if (!Number.isFinite(length) || length < 1 || length > 30) {
      errors.push([lengthField, 'Vehicle length must be between 1 and 30 metres.']);
    }
    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    resetErrors();

    const errors = validate();
    if (errors.length) {
      for (const [wrapper, message] of errors) wrapper.setError(message);
      banner.appendChild(alertBanner(`${errors.length === 1 ? 'One field needs' : `${errors.length} fields need`} your attention before this request can be sent.`));
      errors[0][0].control.focus();
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Sending request…';
    try {
      const payload = {
        passengerName: passengerField.getValue().trim(),
        email: emailField.getValue().trim(),
        phone: phoneField.getValue().trim(),
        pierId: pierField.getValue(),
        crossingId: departureField.getValue(),
        travelDate: dateField.getValue(),
        vehicleType: vehicleTypeField.getValue(),
        vehicleLength: Number(lengthField.getValue()),
        notes: notesField.getValue().trim(),
      };
      const result = await api.post('/api/bookings', payload);
      mount(pageNode, successPanel(result, ctx));
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error.fields && Object.keys(error.fields).length) {
        const map = {
          passengerName: passengerField,
          email: emailField,
          phone: phoneField,
          pierId: pierField,
          crossingId: departureField,
          travelDate: dateField,
          vehicleType: vehicleTypeField,
          vehicleLength: lengthField,
          notes: notesField,
        };
        for (const [key, message] of Object.entries(error.fields)) {
          if (map[key]) map[key].setError(message);
        }
      }
      banner.appendChild(alertBanner(error.message || 'The request could not be sent. Please try again.'));
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Send request';
    }
  });

  await loadDepartures();
  return pageNode;
}

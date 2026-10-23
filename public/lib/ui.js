/** Shared presentational building blocks used by every screen. */

import { h, clear } from './dom.js';

export function pageIntro({ eyebrow, title, description, actions }) {
  return h(
    'div',
    { class: 'page-intro' },
    h(
      'div',
      { class: 'page-intro__text' },
      eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
      h('h1', { class: 'page-intro__title', text: title }),
      description ? h('p', { class: 'page-intro__description', text: description }) : null,
    ),
    actions ? h('div', { class: 'page-intro__actions' }, actions) : null,
  );
}

export function badge(label, tone = 'neutral') {
  return h('span', { class: `badge badge--${tone}`, text: label });
}

export function severityBadge(severity) {
  const tone = severity === 'Critical' ? 'critical' : severity === 'Warning' ? 'warning' : 'info';
  return badge(severity, tone);
}

export function statusBadge(status) {
  const tone =
    status === 'Approved' || status === 'Active'
      ? 'success'
      : status === 'Declined'
        ? 'critical'
        : status === 'Pending'
          ? 'warning'
          : 'neutral';
  return badge(status, tone);
}

export function noticeStatusBadge(status) {
  return status === 'Published' ? badge('Published', 'success') : badge('Draft', 'neutral');
}

export function statePanel({ tone = 'info', title, message, action }) {
  return h(
    'div',
    { class: `state state--${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    h('p', { class: 'state__title', text: title }),
    message ? h('p', { class: 'state__message', text: message }) : null,
    action ? h('div', { class: 'state__action' }, action) : null,
  );
}

export function loadingPanel(message = 'Loading the board…') {
  return h(
    'div',
    { class: 'state state--loading', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'visually-hidden', text: message }),
    h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
  );
}

export function errorPanel(message, onRetry) {
  return statePanel({
    tone: 'error',
    title: 'That did not load',
    message: message || 'Something went wrong while talking to the board.',
    action: h('button', { class: 'btn btn--primary', type: 'button', onclick: onRetry, text: 'Try again' }),
  });
}

export function emptyPanel({ title, message, action }) {
  return statePanel({ tone: 'empty', title, message, action });
}

export function alertBanner(message, tone = 'error') {
  return h('div', { class: `alert alert--${tone}`, role: tone === 'error' ? 'alert' : 'status' }, message);
}

export function statCell({ label, value, note, tone = 'plain', action }) {
  return h(
    'div',
    { class: `cell cell--stat${tone === 'accent' ? ' cell--accent' : ''}` },
    h('p', { class: 'cell__label', text: label }),
    h('p', { class: 'cell__value', text: value }),
    note ? h('p', { class: 'cell__note', text: note }) : null,
    action || null,
  );
}

export function panel({ title, subtitle, actions, children, ticked = false, className = '' }) {
  return h(
    'section',
    { class: `cell ${ticked ? 'cell--ticked' : ''} ${className}`.trim() },
    title || actions
      ? h(
          'div',
          { class: 'cell__head' },
          h(
            'div',
            {},
            title ? h('h2', { class: 'cell__title', text: title }) : null,
            subtitle ? h('p', { class: 'cell__subtitle', text: subtitle }) : null,
          ),
          actions || null,
        )
      : null,
    children,
  );
}

export function bento(...cells) {
  return h('div', { class: 'bento' }, ...cells);
}

/** Accessible data table. Each row becomes a labelled card below 720px. */
export function dataTable({ columns, rows, caption, empty }) {
  if (!rows.length) return empty || emptyPanel({ title: 'Nothing to show yet', message: 'There are no records here.' });
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table' },
      h('caption', { class: 'visually-hidden', text: caption || 'Records' }),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...columns.map((column) =>
            h('th', { scope: 'col', class: column.numeric ? 'is-numeric' : null }, column.label),
          ),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((row) =>
          h(
            'tr',
            { class: row.className || null },
            ...columns.map((column, index) =>
              h(
                'td',
                { 'data-label': column.label, class: column.numeric ? 'is-numeric' : null },
                row.cells[index] === null || row.cells[index] === undefined ? '—' : row.cells[index],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

const CONTROL_TAGS = { textarea: 'textarea', select: 'select' };

/**
 * Build one labelled form control plus its error slot.
 * Returns { wrapper, control, getValue, setValue, setError, clearError }.
 */
export function field(spec) {
  const {
    id,
    label,
    type = 'text',
    name = id,
    value = '',
    options = [],
    hint,
    required = false,
    placeholder,
    autocomplete,
    inputmode,
    min,
    max,
    step,
    rows = 4,
    disabled = false,
    checkboxLabel,
  } = spec;

  if (type === 'checkbox') {
    const control = h('input', { type: 'checkbox', id, name, checked: Boolean(value), disabled });
    const errorNode = h('p', { class: 'field__error', id: `${id}-error`, role: 'alert', hidden: true });
    const wrapper = h(
      'div',
      { class: 'field field--checkbox' },
      h('label', { class: 'field__check-label', for: id }, control, h('span', { text: checkboxLabel || label })),
      errorNode,
    );
    return fieldApi(wrapper, control, errorNode);
  }

  const tag = CONTROL_TAGS[type] === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input';
  const controlProps = { id, name, class: 'input', disabled };
  if (tag === 'input') {
    controlProps.type = type;
    controlProps.value = value;
    if (placeholder) controlProps.placeholder = placeholder;
    if (autocomplete) controlProps.autocomplete = autocomplete;
    if (inputmode) controlProps.inputmode = inputmode;
    if (min !== undefined) controlProps.min = min;
    if (max !== undefined) controlProps.max = max;
    if (step !== undefined) controlProps.step = step;
  } else if (tag === 'textarea') {
    controlProps.value = value;
    controlProps.rows = rows;
    if (placeholder) controlProps.placeholder = placeholder;
  } else {
    controlProps.value = value;
  }
  if (required) controlProps.required = true;

  const control = h(tag, controlProps);
  if (tag === 'select') {
    for (const option of options) {
      control.appendChild(
        h('option', { value: option.value, selected: String(option.value) === String(value) }, option.label),
      );
    }
  }

  const describedBy = [];
  if (hint) describedBy.push(`${id}-hint`);
  describedBy.push(`${id}-error`);
  control.setAttribute('aria-describedby', describedBy.join(' '));

  const errorNode = h('p', { class: 'field__error', id: `${id}-error`, role: 'alert', hidden: true });
  const wrapper = h(
    'div',
    { class: 'field' },
    h(
      'label',
      { class: 'field__label', for: id },
      label,
      required ? h('span', { class: 'field__required', 'aria-hidden': 'true', text: '*' }) : null,
    ),
    control,
    hint ? h('p', { class: 'field__hint', id: `${id}-hint`, text: hint }) : null,
    errorNode,
  );

  return fieldApi(wrapper, control, errorNode);
}

function fieldApi(wrapper, control, errorNode) {
  return {
    wrapper,
    control,
    getValue() {
      if (control.type === 'checkbox') return control.checked;
      return control.value;
    },
    setValue(next) {
      if (control.type === 'checkbox') control.checked = Boolean(next);
      else control.value = next;
    },
    setError(message) {
      errorNode.textContent = message;
      errorNode.hidden = false;
      control.setAttribute('aria-invalid', 'true');
    },
    clearError() {
      errorNode.textContent = '';
      errorNode.hidden = true;
      control.removeAttribute('aria-invalid');
    },
  };
}

/** Destructive action that asks for confirmation inline (no modal dialog). */
export function confirmAction({ label, question, confirmLabel = 'Delete', onConfirm }) {
  const wrap = h('span', { class: 'confirm' });
  const trigger = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--danger-ghost', text: label });
  trigger.addEventListener('click', () => {
    clear(wrap);
    const status = h('span', { class: 'confirm__status', role: 'status' });
    const confirmButton = h('button', { type: 'button', class: 'btn btn--danger btn--sm', text: confirmLabel });
    const cancelButton = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: 'Cancel' });
    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      status.textContent = 'Working…';
      try {
        await onConfirm();
      } catch (error) {
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        status.textContent = error.message || 'That did not work.';
      }
    });
    cancelButton.addEventListener('click', () => {
      clear(wrap);
      wrap.appendChild(trigger);
    });
    wrap.append(h('span', { class: 'confirm__question', text: question }), confirmButton, cancelButton, status);
    cancelButton.focus();
  });
  wrap.appendChild(trigger);
  return wrap;
}

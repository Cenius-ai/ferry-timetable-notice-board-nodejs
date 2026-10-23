/**
 * Tiny DOM helpers. Everything is built with createElement + textContent so
 * user-supplied strings can never be interpreted as markup.
 */

export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  let deferredValue = null;
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      switch (key) {
        case 'class':
          element.className = value;
          break;
        case 'text':
          element.textContent = value;
          break;
        case 'dataset':
          Object.assign(element.dataset, value);
          break;
        case 'value':
          if (tag === 'select' || tag === 'textarea') deferredValue = value;
          else element.value = value;
          break;
        case 'checked':
        case 'disabled':
        case 'required':
        case 'readOnly':
        case 'selected':
          element[key] = Boolean(value);
          break;
        default:
          if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.slice(2).toLowerCase(), value);
          } else if (value !== true) {
            element.setAttribute(key, value);
          } else {
            element.setAttribute(key, '');
          }
      }
    }
  }
  append(element, children);
  if (deferredValue !== null) element.value = deferredValue;
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

/* --------------------------- formatting --------------------------- */

const DATE_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DATE_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DATE_MEDIUM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME_OF_DAY = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Parse a YYYY-MM-DD value in local time (avoids UTC off-by-one). */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isoFromDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDateShort(value) {
  const date = parseDateOnly(value);
  return date ? DATE_SHORT.format(date) : '—';
}

export function formatDateMedium(value) {
  const date = parseDateOnly(value);
  return date ? DATE_MEDIUM.format(date) : '—';
}

export function formatDateLong(value) {
  const date = parseDateOnly(value);
  return date ? DATE_LONG.format(date) : '—';
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${DATE_MEDIUM.format(date)}, ${TIME_OF_DAY.format(date)}`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? '' : 's'} ago`;
  return DATE_MEDIUM.format(date);
}

export function duration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(index) {
  return WEEKDAYS[index] || '—';
}

export function todayWeekday() {
  return new Date().getDay();
}

export function titleCase(value) {
  return String(value || '').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

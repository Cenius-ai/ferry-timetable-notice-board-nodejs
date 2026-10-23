import { h, clear } from '../lib/dom.js';
import { ApiError, api } from '../lib/api.js';
import { alertBanner, field, pageIntro, panel } from '../lib/ui.js';

const DEMO = { email: 'cenius@cenius.ai', password: 'cenius' };
const ALTERNATE = { email: 'demo@ferryboard.app', password: 'FerryDemo123!' };

function demoCard({ title, email, password, note }) {
  return h(
    'div',
    { class: 'demo-card' },
    h(
      'div',
      { class: 'demo-card__head' },
      h('p', { class: 'demo-card__label', text: title }),
      h('span', { class: 'demo-card__badge', text: 'Seeded' }),
    ),
    h('p', { class: 'demo-card__cred' }, h('code', { text: email }), h('span', { text: ' / ' }), h('code', { text: password })),
    note ? h('p', { class: 'demo-card__note', text: note }) : null,
  );
}

export async function render(ctx) {
  if (ctx.user) {
    return h(
      'div',
      { class: 'page page--narrow' },
      pageIntro({ eyebrow: 'Staff console', title: 'You are signed in', description: `Signed in as ${ctx.user.name} (${ctx.user.email}).` }),
      panel({
        children: h(
          'div',
          { class: 'stack' },
          h('a', { class: 'btn btn--primary btn--block', href: '/dashboard' }, 'Open the operations dashboard'),
          h('a', { class: 'btn btn--secondary btn--block', href: '/staff/bookings' }, 'Review booking requests'),
          h(
            'button',
            {
              class: 'btn btn--ghost btn--block',
              type: 'button',
              text: 'Sign out',
              onclick: async () => {
                try {
                  await api.post('/api/auth/logout', {});
                } catch {
                  /* the local session is cleared regardless */
                }
                ctx.setUser(null);
                ctx.navigate('/login', { replace: true });
              },
            },
          ),
        ),
      }),
    );
  }

  const nextParam = ctx.search.get('next');
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';
  const expired = ctx.search.get('expired') === '1';

  const emailField = field({
    id: 'login-email',
    name: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    autocomplete: 'username',
    placeholder: 'cenius@cenius.ai',
  });
  const passwordField = field({
    id: 'login-password',
    name: 'password',
    label: 'Password',
    type: 'password',
    required: true,
    autocomplete: 'current-password',
    placeholder: 'Your password',
  });

  const banner = h('div', { class: 'form__banner' });
  if (expired) {
    banner.appendChild(alertBanner('Your session expired. Sign in again to pick up where you left off.', 'info'));
  }

  const toggleButton = h('button', {
    class: 'btn btn--ghost btn--sm password-toggle',
    type: 'button',
    text: 'Show',
    'aria-label': 'Show password',
    'aria-pressed': 'false',
  });
  toggleButton.addEventListener('click', () => {
    const showing = passwordField.control.type === 'text';
    passwordField.control.type = showing ? 'password' : 'text';
    toggleButton.textContent = showing ? 'Show' : 'Hide';
    toggleButton.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggleButton.setAttribute('aria-pressed', showing ? 'false' : 'true');
  });

  const submitButton = h('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Sign in' });
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    banner,
    emailField.wrapper,
    h('div', { class: 'field field--password' }, passwordField.wrapper, toggleButton),
    h('div', { class: 'form__actions' }, submitButton),
  );

  let submitting = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clear(banner);
    emailField.clearError();
    passwordField.clearError();

    const email = emailField.getValue().trim();
    const password = passwordField.getValue();
    let invalid = false;
    if (!email) {
      emailField.setError('Email is required.');
      invalid = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) {
      emailField.setError('Enter a valid email address.');
      invalid = true;
    }
    if (!password) {
      passwordField.setError('Password is required.');
      invalid = true;
    }
    if (invalid) {
      (email ? passwordField : emailField).control.focus();
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';
    try {
      const payload = await api.post('/api/auth/login', { email, password });
      ctx.setUser(payload.user);
      ctx.navigate(safeNext, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        banner.appendChild(alertBanner('Email or password is incorrect.'));
        passwordField.control.focus();
        passwordField.control.select();
      } else {
        banner.appendChild(alertBanner(error.message || 'Sign in failed. Please try again.'));
      }
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Sign in';
    }
  });

  function fillDemo(credentials) {
    emailField.setValue(credentials.email);
    passwordField.setValue(credentials.password);
    emailField.clearError();
    passwordField.clearError();
    clear(banner);
    submitButton.focus();
  }

  const demoPrimary = demoCard({
    title: 'Demo: cenius@cenius.ai / cenius',
    email: DEMO.email,
    password: DEMO.password,
    note: 'Full operations access — booking review, timetable and notices.',
  });
  demoPrimary.appendChild(
    h('button', {
      class: 'btn btn--secondary btn--sm',
      type: 'button',
      text: 'Use demo account',
      onclick: () => fillDemo(DEMO),
    }),
  );

  const demoAlternate = demoCard({
    title: 'Alternate staff account',
    email: ALTERNATE.email,
    password: ALTERNATE.password,
    note: 'Same console, useful for trying the reviewer trail.',
  });
  demoAlternate.appendChild(
    h('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      text: 'Fill alternate',
      onclick: () => fillDemo(ALTERNATE),
    }),
  );

  return h(
    'div',
    { class: 'page page--narrow' },
    pageIntro({
      eyebrow: 'Staff only',
      title: 'Sign in to the staff console',
      description: 'Post disruption notices, manage the weekly timetable and review vehicle-deck requests.',
    }),
    h(
      'div',
      { class: 'login-grid' },
      panel({
        ticked: true,
        title: 'Staff sign in',
        subtitle: 'Accounts are issued by the pier administrator.',
        children: form,
      }),
      h(
        'div',
        { class: 'stack' },
        demoPrimary,
        demoAlternate,
        h('p', {
          class: 'cell__note',
          text: 'Demo accounts are seeded for evaluation. Remove them before running the board for real traffic.',
        }),
      ),
    ),
  );
}

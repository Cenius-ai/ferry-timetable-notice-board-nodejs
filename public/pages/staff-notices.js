import { h, clear, timeAgo } from '../lib/dom.js';
import { ApiError, api } from '../lib/api.js';
import {
  alertBanner,
  confirmAction,
  emptyPanel,
  field,
  noticeStatusBadge,
  pageIntro,
  panel,
  severityBadge,
  statePanel,
} from '../lib/ui.js';

const SEVERITIES = ['Info', 'Warning', 'Critical'];

function noticePayload(notice, status) {
  return {
    title: notice.title,
    body: notice.body,
    severity: notice.severity,
    pierId: notice.pierId || '',
    status,
  };
}

export async function render(ctx) {
  const payload = await api.get('/api/staff/notices');
  const notices = payload.notices;

  const items = notices.map((notice) => {
    const rowStatus = h('span', { class: 'confirm__status', role: 'status' });
    return h(
      'article',
      { class: `notice notice--${notice.severity.toLowerCase()}` },
      h(
        'div',
        { class: 'notice__head' },
        noticeStatusBadge(notice.status),
        severityBadge(notice.severity),
        h('span', { class: 'notice__scope', text: notice.pierName || 'All piers' }),
        h('span', { class: 'notice__time', text: `Updated ${timeAgo(notice.updatedAt)}` }),
      ),
      h('h2', { class: 'notice__title', text: notice.title }),
      h('p', { class: 'notice__body', text: notice.body }),
      h(
        'div',
        { class: 'notice__foot' },
        h('p', { class: 'notice__meta', text: `Author: ${notice.authorName}` }),
        h(
          'div',
          { class: 'row-actions' },
          h('a', { class: 'btn btn--ghost btn--sm', href: `/staff/notices/${encodeURIComponent(notice.id)}/edit` }, 'Edit'),
          h('button', {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            text: notice.status === 'Published' ? 'Unpublish' : 'Publish',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await api.put(
                  `/api/staff/notices/${encodeURIComponent(notice.id)}`,
                  noticePayload(notice, notice.status === 'Published' ? 'Draft' : 'Published'),
                );
                ctx.reload();
              } catch (error) {
                button.disabled = false;
                rowStatus.textContent = error.message || 'Could not change the publication state.';
              }
            },
          }),
          confirmAction({
            label: 'Delete',
            question: 'Delete this notice?',
            confirmLabel: 'Delete notice',
            onConfirm: async () => {
              await api.del(`/api/staff/notices/${encodeURIComponent(notice.id)}`);
              ctx.reload();
            },
          }),
          rowStatus,
        ),
      ),
    );
  });

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Staff console',
      title: 'Disruption notices',
      description: 'Drafts stay internal. Publishing puts the notice on the public notice board and on the timetable banner for the piers it affects.',
      actions: h('a', { class: 'btn btn--primary', href: '/staff/notices/new' }, 'Write a notice'),
    }),
    notices.length
      ? h('div', { class: 'notice-list' }, ...items)
      : emptyPanel({
          title: 'No notices yet',
          message: 'Write the first disruption notice. It stays a draft until you publish it.',
          action: h('a', { class: 'btn btn--primary', href: '/staff/notices/new' }, 'Write the first notice'),
        }),
  );
}

export async function renderForm(ctx) {
  const isEdit = Boolean(ctx.params.id);
  const [noticesPayload, piersPayload] = await Promise.all([api.get('/api/staff/notices'), api.get('/api/piers')]);
  const piers = piersPayload.piers;

  let existing = null;
  if (isEdit) {
    existing = noticesPayload.notices.find((notice) => notice.id === ctx.params.id) || null;
    if (!existing) {
      return h(
        'div',
        { class: 'page' },
        pageIntro({ eyebrow: 'Staff console', title: 'Notice not found' }),
        statePanel({
          tone: 'empty',
          title: 'That notice is no longer on file',
          message: 'It may have been deleted. Head back to the notice list to pick another one.',
          action: h('a', { class: 'btn btn--primary', href: '/staff/notices' }, 'Back to notices'),
        }),
      );
    }
  }

  const titleField = field({
    id: 'notice-title',
    label: 'Title',
    value: existing ? existing.title : '',
    required: true,
    maxlength: '120',
    placeholder: 'High winds forecast — vehicle loading may be delayed',
  });
  const bodyField = field({
    id: 'notice-body',
    label: 'Notice text',
    type: 'textarea',
    value: existing ? existing.body : '',
    required: true,
    rows: 5,
    placeholder: 'What is happening, which piers are affected and what passengers should do.',
  });
  const severityField = field({
    id: 'notice-severity',
    label: 'Severity',
    type: 'select',
    value: existing ? existing.severity : 'Warning',
    required: true,
    options: SEVERITIES.map((severity) => ({ value: severity, label: severity })),
  });
  const pierField = field({
    id: 'notice-pier',
    label: 'Affected pier',
    type: 'select',
    value: existing && existing.pierId ? existing.pierId : '',
    required: false,
    options: [{ value: '', label: 'All piers' }, ...piers.map((pier) => ({ value: pier.id, label: `${pier.name} (${pier.code})` }))],
  });
  const statusField = field({
    id: 'notice-status',
    label: 'Publication',
    type: 'select',
    value: existing ? existing.status : 'Draft',
    required: true,
    options: [
      { value: 'Draft', label: 'Draft — internal only' },
      { value: 'Published', label: 'Published — live on the public board' },
    ],
  });

  const banner = h('div', { class: 'form__banner' });
  const submitButton = h('button', { class: 'btn btn--primary', type: 'submit', text: isEdit ? 'Save notice' : 'Save notice' });
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    banner,
    titleField.wrapper,
    bodyField.wrapper,
    h('div', { class: 'form__grid' }, severityField.wrapper, pierField.wrapper, statusField.wrapper),
    h(
      'div',
      { class: 'form__actions' },
      submitButton,
      h('a', { class: 'btn btn--ghost', href: '/staff/notices' }, 'Cancel'),
    ),
  );

  const fields = { title: titleField, body: bodyField, severity: severityField, pierId: pierField, status: statusField };
  let submitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clear(banner);
    for (const entry of Object.values(fields)) entry.clearError();

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';
    try {
      const payload = {
        title: titleField.getValue().trim(),
        body: bodyField.getValue().trim(),
        severity: severityField.getValue(),
        pierId: pierField.getValue(),
        status: statusField.getValue(),
      };
      if (isEdit) await api.put(`/api/staff/notices/${encodeURIComponent(existing.id)}`, payload);
      else await api.post('/api/staff/notices', payload);
      ctx.navigate('/staff/notices');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      if (error.fields) {
        for (const [key, message] of Object.entries(error.fields)) {
          if (fields[key]) fields[key].setError(message);
        }
      }
      banner.appendChild(alertBanner(error.message || 'The notice could not be saved.'));
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Save notice';
    }
  });

  return h(
    'div',
    { class: 'page page--narrow' },
    pageIntro({
      eyebrow: 'Staff console',
      title: isEdit ? 'Edit notice' : 'Write a notice',
      description: 'Publishing a notice updates the public notice board and the timetable banner immediately.',
      actions: h('a', { class: 'btn btn--ghost', href: '/staff/notices' }, 'Back to notices'),
    }),
    panel({
      ticked: true,
      children: form,
    }),
  );
}

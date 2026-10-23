import { h, timeAgo } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { emptyPanel, pageIntro, severityBadge } from '../lib/ui.js';

function noticeArticle(notice) {
  const scope = notice.pierId ? notice.pierName || 'Selected pier' : 'All piers';
  return h(
    'article',
    { class: `notice notice--${notice.severity.toLowerCase()}` },
    h(
      'div',
      { class: 'notice__head' },
      severityBadge(notice.severity),
      h('span', { class: 'notice__scope', text: scope }),
      h('span', { class: 'notice__time', text: timeAgo(notice.publishedAt) }),
    ),
    h('h2', { class: 'notice__title', text: notice.title }),
    h('p', { class: 'notice__body', text: notice.body }),
    h('p', { class: 'notice__meta', text: `Published by ${notice.authorName}` }),
  );
}

export async function render(ctx) {
  const noticesPayload = await api.get('/api/notices');

  return h(
    'div',
    { class: 'page' },
    pageIntro({
      eyebrow: 'Service disruption notices',
      title: 'Notice board',
      description:
        'Published notices from the pier operations team, newest first. Each notice also appears on the timetable for the piers it affects.',
      actions: h('a', { class: 'btn btn--secondary', href: '/timetable' }, 'Back to the timetable'),
    }),
    noticesPayload.notices.length
      ? h('div', { class: 'notice-list' }, ...noticesPayload.notices.map((notice) => noticeArticle(notice)))
      : emptyPanel({
          title: 'No service notices right now',
          message: 'Nothing has been published, which means normal service. Check the timetable for scheduled crossings.',
          action: h('a', { class: 'btn btn--primary', href: '/timetable' }, 'View the timetable'),
        }),
  );
}

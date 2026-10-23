'use strict';

/**
 * API + persistence test suite. Runs the real server in-process against a
 * throwaway data directory: no network, no external services, no prompts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-board-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

const { startServer, DB_FILE } = require('../server.js');

let server;
let baseUrl;
let staffCookie;

test.before(async () => {
  server = startServer();
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

async function call(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function readCookie(headers) {
  const raw = headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function signIn(email = 'cenius@cenius.ai', password = 'cenius') {
  const result = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, `login should succeed for ${email}`);
  const cookie = readCookie(result.headers);
  assert.ok(cookie, 'login must set a session cookie');
  return cookie;
}

test('serves the app shell and every static asset at its referenced path', async () => {
  const root = await call('/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.match(root.text, /<main id="main"/);
  assert.match(root.text, /\/app\.js/);

  for (const asset of ['/app.js', '/styles.css', '/styles-ui.css', '/favicon.svg', '/lib/dom.js', '/pages/home.js']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be delivered`);
  }
  const font = await fetch(`${baseUrl}/fonts/hanken-grotesk-latin.woff2`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type'), /font\/woff2/);
});

test('deep links fall back to the SPA shell and security headers are present', async () => {
  const response = await call('/staff/bookings');
  assert.equal(response.status, 200);
  assert.match(response.text, /<main id="main"/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('seeds piers, crossings, notices, bookings and the demo staff accounts', () => {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.piers.length, 3);
  assert.ok(db.crossings.length >= 21, 'at least three weeks of crossings');
  assert.ok(db.crossings.some((crossing) => crossing.active === false), 'one seeded inactive crossing');
  assert.equal(db.notices.length, 4);
  assert.equal(db.notices.filter((notice) => notice.status === 'Published').length, 3);
  assert.equal(db.bookings.length, 5);
  assert.deepEqual(
    db.bookings.map((booking) => booking.status).sort(),
    ['Approved', 'Declined', 'Pending', 'Pending', 'Pending'],
  );
  const demo = db.staffUsers.find((user) => user.email === 'cenius@cenius.ai');
  assert.ok(demo, 'standard demo account is seeded');
  assert.equal(demo.name, 'Dana Whitfield');
  assert.ok(demo.passwordHash && demo.passwordSalt, 'password is stored as a salted scrypt hash');
  assert.ok(!JSON.stringify(db).includes('"password":"cenius"'), 'no plaintext password anywhere');
});

test('public timetable defaults to the first pier and today, and hides inactive crossings', async () => {
  const response = await call('/api/timetable');
  assert.equal(response.status, 200);
  const payload = response.json;
  assert.equal(payload.pier.id, 'pier-north-quay');
  assert.equal(payload.weekday, new Date().getDay());
  assert.ok(payload.crossings.length > 0);
  assert.ok(payload.crossings.every((crossing) => crossing.active));
  const departures = payload.crossings.map((crossing) => crossing.departureTime);
  assert.deepEqual(departures, [...departures].sort(), 'departures are ordered by time');

  const filtered = await call('/api/timetable?pier=pier-harbour-point&weekday=3');
  assert.equal(filtered.status, 200);
  assert.ok(filtered.json.crossings.every((crossing) => crossing.pierId === 'pier-harbour-point'));
  assert.ok(filtered.json.crossings.every((crossing) => crossing.weekday === 3));
  assert.ok(
    !filtered.json.crossings.some((crossing) => crossing.vesselName.includes('charter')),
    'the seeded inactive charter sailing is never public',
  );
});

test('timetable notices match the selected pier or All piers only', async () => {
  const northQuay = await call('/api/timetable?pier=pier-north-quay&weekday=3');
  const titles = northQuay.json.notices.map((notice) => notice.title.toLowerCase());
  assert.ok(titles.some((title) => title.includes('high winds')), 'all-pier notice appears');
  assert.ok(titles.some((title) => title.includes('extra 06:40')), 'pier notice appears');
  assert.ok(!titles.some((title) => title.includes('slipway')), 'harbour point notice is excluded');

  const harbour = await call('/api/timetable?pier=pier-harbour-point&weekday=3');
  const harbourTitles = harbour.json.notices.map((notice) => notice.title.toLowerCase());
  assert.ok(harbourTitles.some((title) => title.includes('slipway')));
  assert.ok(!harbourTitles.some((title) => title.includes('extra 06:40')));
});

test('public notices endpoint lists published notices newest first', async () => {
  const response = await call('/api/notices');
  assert.equal(response.status, 200);
  const notices = response.json.notices;
  assert.equal(notices.length, 3);
  assert.ok(notices.every((notice) => notice.status === 'Published'));
  const times = notices.map((notice) => notice.publishedAt);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.ok(notices.every((notice) => notice.pierName !== undefined));
});

test('booking departures only offer active crossings for the pier and weekday', async () => {
  const response = await call('/api/crossings?pierId=pier-cliffside&weekday=2');
  assert.equal(response.status, 200);
  assert.ok(response.json.crossings.length > 0);
  assert.ok(response.json.crossings.every((crossing) => crossing.active && crossing.pierId === 'pier-cliffside' && crossing.weekday === 2));

  const badWeekday = await call('/api/crossings?pierId=pier-cliffside&weekday=9');
  assert.equal(badWeekday.status, 400);
});

test('a valid booking request persists with a unique reference and Pending status', async () => {
  const departures = await call('/api/crossings?pierId=pier-north-quay&weekday=4');
  const crossingId = departures.json.crossings[0].id;
  const travel = new Date();
  const daysAhead = (4 - travel.getDay() + 7) % 7 || 7;
  travel.setDate(travel.getDate() + daysAhead);
  const travelDate = travel.toISOString().slice(0, 10);

  const body = {
    passengerName: 'Eilidh Fraser',
    email: 'eilidh.fraser@example.com',
    phone: '07700 900321',
    pierId: 'pier-north-quay',
    crossingId,
    travelDate,
    vehicleType: 'Car',
    vehicleLength: 4.6,
    notes: 'Travelling with a roof box.',
  };
  const first = await call('/api/bookings', { method: 'POST', body });
  assert.equal(first.status, 201);
  assert.match(first.json.reference, /^FB-[A-Z0-9]{4}$/);
  assert.equal(first.json.booking.status, 'Pending');

  const second = await call('/api/bookings', { method: 'POST', body });
  assert.equal(second.status, 201);
  assert.notEqual(second.json.reference, first.json.reference, 'references are unique');

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const stored = db.bookings.find((booking) => booking.reference === first.json.reference);
  assert.ok(stored, 'the booking was written to disk, not just to memory');
  assert.equal(stored.passengerName, 'Eilidh Fraser');
});

test('invalid booking submissions are rejected with field-level messages', async () => {
  const blankName = await call('/api/bookings', {
    method: 'POST',
    body: {
      passengerName: '',
      email: 'not-an-email',
      phone: '123',
      pierId: 'pier-north-quay',
      crossingId: 'crossing-nq-2-0',
      travelDate: '2999-01-01',
      vehicleType: 'Car',
      vehicleLength: 4.5,
    },
  });
  assert.equal(blankName.status, 400);
  assert.ok(blankName.json.fields.passengerName);
  assert.ok(blankName.json.fields.email);
  assert.ok(blankName.json.fields.phone);

  const pastDate = await call('/api/bookings', {
    method: 'POST',
    body: {
      passengerName: 'Test Passenger',
      email: 'test@example.com',
      phone: '07700 900000',
      pierId: 'pier-north-quay',
      crossingId: 'crossing-nq-2-0',
      travelDate: '2000-01-01',
      vehicleType: 'Car',
      vehicleLength: 4.5,
    },
  });
  assert.equal(pastDate.status, 400);
  assert.ok(pastDate.json.fields.travelDate);
});

test('staff endpoints require a session and reject wrong credentials generically', async () => {
  const anonymous = await call('/api/staff/bookings');
  assert.equal(anonymous.status, 401);

  const wrong = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'cenius@cenius.ai', password: '***REDACTED-SECRET***' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, 'Email or password is incorrect.');
  assert.equal(wrong.headers.get('set-cookie'), null);

  const unknown = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'whatever' },
  });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.error, wrong.json.error, 'the message never reveals which field was wrong');
});

test('both seeded demo accounts accept their documented credentials', async () => {
  const primary = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'cenius@cenius.ai', password: 'cenius' },
  });
  assert.equal(primary.status, 200);
  assert.equal(primary.json.user.name, 'Dana Whitfield');

  const alternate = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'demo@ferryboard.app', password: 'FerryDemo123!' },
  });
  assert.equal(alternate.status, 200);
  assert.equal(alternate.json.user.email, 'demo@ferryboard.app');
  assert.equal(alternate.json.user.name, 'Priya Raman');

  const wrongForAlternate = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'demo@ferryboard.app', password: 'cenius' },
  });
  assert.equal(wrongForAlternate.status, 401, 'each demo account keeps its own password');
});

test('the demo account signs in and the session survives subsequent requests', async () => {
  staffCookie = await signIn();
  const me = await call('/api/auth/me', { cookie: staffCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'cenius@cenius.ai');
  assert.equal(me.json.user.name, 'Dana Whitfield');
  assert.equal(me.json.user.passwordHash, undefined, 'password material never leaves the server');

  const queue = await call('/api/staff/bookings', { cookie: staffCookie });
  assert.equal(queue.status, 200);
  assert.equal(queue.json.status, 'All');
  assert.equal(queue.json.counts.all, queue.json.bookings.length);
});

test('approving a request records reviewer and decision time', async () => {
  const queue = await call('/api/staff/bookings?status=Pending', { cookie: staffCookie });
  const pending = queue.json.bookings[0];
  assert.ok(pending, 'a pending request is seeded');

  const decision = await call(`/api/staff/bookings/${pending.id}/decision`, {
    method: 'POST',
    body: { action: 'approve' },
    cookie: staffCookie,
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.json.booking.status, 'Approved');
  assert.equal(decision.json.booking.reviewerName, 'Dana Whitfield');
  assert.ok(decision.json.booking.decidedAt);

  const again = await call(`/api/staff/bookings/${pending.id}/decision`, {
    method: 'POST',
    body: { action: 'decline', reason: 'Changed my mind entirely.' },
    cookie: staffCookie,
  });
  assert.equal(again.status, 409, 'decided requests cannot be decided twice');
});

test('declining requires a written reason and stores it with the decision', async () => {
  const queue = await call('/api/staff/bookings?status=Pending', { cookie: staffCookie });
  const pending = queue.json.bookings[0];
  assert.ok(pending);

  const missingReason = await call(`/api/staff/bookings/${pending.id}/decision`, {
    method: 'POST',
    body: { action: 'decline', reason: '' },
    cookie: staffCookie,
  });
  assert.equal(missingReason.status, 400);
  assert.ok(missingReason.json.fields.reason);

  const declined = await call(`/api/staff/bookings/${pending.id}/decision`, {
    method: 'POST',
    body: { action: 'decline', reason: 'Deck limit exceeded for this vessel.' },
    cookie: staffCookie,
  });
  assert.equal(declined.status, 200);
  assert.equal(declined.json.booking.status, 'Declined');
  assert.equal(declined.json.booking.declineReason, 'Deck limit exceeded for this vessel.');
  assert.equal(declined.json.booking.reviewerName, 'Dana Whitfield');
});

test('staff crossing CRUD controls public visibility through the active flag', async () => {
  const created = await call('/api/staff/crossings', {
    method: 'POST',
    body: {
      pierId: 'pier-harbour-point',
      weekday: 1,
      departureTime: '05:15',
      arrivalTime: '06:05',
      vesselName: 'MV Dawn Patrol',
      vehicleCapacity: 22,
    },
    cookie: staffCookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.crossing.active, true, 'new crossings default to active');
  const crossingId = created.json.crossing.id;

  const publicBefore = await call('/api/timetable?pier=pier-harbour-point&weekday=1');
  assert.ok(publicBefore.json.crossings.some((crossing) => crossing.id === crossingId));

  const badTimes = await call(`/api/staff/crossings/${crossingId}`, {
    method: 'PUT',
    body: {
      pierId: 'pier-harbour-point',
      weekday: 1,
      departureTime: '09:00',
      arrivalTime: '08:30',
      vesselName: 'MV Dawn Patrol',
      vehicleCapacity: 22,
      active: true,
    },
    cookie: staffCookie,
  });
  assert.equal(badTimes.status, 400);
  assert.ok(badTimes.json.fields.arrivalTime);

  const deactivated = await call(`/api/staff/crossings/${crossingId}`, {
    method: 'PUT',
    body: {
      pierId: 'pier-harbour-point',
      weekday: 1,
      departureTime: '05:15',
      arrivalTime: '06:05',
      vesselName: 'MV Dawn Patrol',
      vehicleCapacity: 22,
      active: false,
    },
    cookie: staffCookie,
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.json.crossing.active, false);

  const publicAfter = await call('/api/timetable?pier=pier-harbour-point&weekday=1');
  assert.ok(!publicAfter.json.crossings.some((crossing) => crossing.id === crossingId), 'inactive crossings leave the public timetable');

  const staffList = await call('/api/staff/crossings', { cookie: staffCookie });
  assert.ok(staffList.json.crossings.some((crossing) => crossing.id === crossingId), 'staff still see inactive crossings');

  const removed = await call(`/api/staff/crossings/${crossingId}`, { method: 'DELETE', cookie: staffCookie });
  assert.equal(removed.status, 200);
  const afterDelete = await call('/api/staff/crossings', { cookie: staffCookie });
  assert.ok(!afterDelete.json.crossings.some((crossing) => crossing.id === crossingId));
});

test('staff notice authoring: drafts stay private, publishing reaches the public board', async () => {
  const created = await call('/api/staff/notices', {
    method: 'POST',
    body: {
      title: 'Harbour Point crane lift on Tuesday',
      body: 'The heavy lift crane will occupy two deck lanes between 09:00 and 12:00. Allow extra time.',
      severity: 'Critical',
      pierId: 'pier-harbour-point',
      status: 'Draft',
    },
    cookie: staffCookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.notice.status, 'Draft');
  assert.equal(created.json.notice.authorName, 'Dana Whitfield');
  const noticeId = created.json.notice.id;

  const publicWhileDraft = await call('/api/notices');
  assert.ok(!publicWhileDraft.json.notices.some((notice) => notice.id === noticeId), 'drafts are hidden publicly');

  const staffList = await call('/api/staff/notices', { cookie: staffCookie });
  assert.ok(staffList.json.notices.some((notice) => notice.id === noticeId), 'drafts are visible to staff');

  const published = await call(`/api/staff/notices/${noticeId}`, {
    method: 'PUT',
    body: {
      title: 'Harbour Point crane lift on Tuesday',
      body: 'The heavy lift crane will occupy two deck lanes between 09:00 and 12:00. Allow extra time.',
      severity: 'Critical',
      pierId: 'pier-harbour-point',
      status: 'Published',
    },
    cookie: staffCookie,
  });
  assert.equal(published.status, 200);
  assert.ok(published.json.notice.publishedAt);

  const publicAfter = await call('/api/notices');
  const live = publicAfter.json.notices.find((notice) => notice.id === noticeId);
  assert.ok(live, 'published notices appear publicly');
  assert.equal(live.severity, 'Critical');
  assert.equal(live.pierName, 'Harbour Point');

  const banner = await call('/api/timetable?pier=pier-harbour-point&weekday=2');
  assert.ok(banner.json.notices.some((notice) => notice.id === noticeId));
  const otherPier = await call('/api/timetable?pier=pier-north-quay&weekday=2');
  assert.ok(!otherPier.json.notices.some((notice) => notice.id === noticeId), 'pier-scoped notices stay off other piers');

  const edited = await call(`/api/staff/notices/${noticeId}`, {
    method: 'PUT',
    body: {
      title: 'Harbour Point crane lift moved to Wednesday',
      body: 'The heavy lift crane now occupies two deck lanes on Wednesday between 09:00 and 12:00.',
      severity: 'Warning',
      pierId: 'pier-harbour-point',
      status: 'Published',
    },
    cookie: staffCookie,
  });
  assert.equal(edited.status, 200);
  const updatedPublic = await call('/api/notices');
  const updated = updatedPublic.json.notices.find((notice) => notice.id === noticeId);
  assert.match(updated.title, /moved to Wednesday/);

  const deleted = await call(`/api/staff/notices/${noticeId}`, { method: 'DELETE', cookie: staffCookie });
  assert.equal(deleted.status, 200);
  const afterDelete = await call('/api/notices');
  assert.ok(!afterDelete.json.notices.some((notice) => notice.id === noticeId));
});

test('dashboard reports counts that move with real decisions', async () => {
  const before = await call('/api/dashboard', { cookie: staffCookie });
  assert.equal(before.status, 200);
  assert.equal(before.json.user.name, 'Dana Whitfield');
  assert.equal(before.json.counts.activeCrossingsToday, before.json.departures.length);
  assert.equal(typeof before.json.counts.publishedNotices, 'number');
  assert.equal(typeof before.json.counts.pendingBookings, 'number');

  const queue = await call('/api/staff/bookings?status=Pending', { cookie: staffCookie });
  if (queue.json.bookings.length > 0) {
    await call(`/api/staff/bookings/${queue.json.bookings[0].id}/decision`, {
      method: 'POST',
      body: { action: 'approve' },
      cookie: staffCookie,
    });
    const after = await call('/api/dashboard', { cookie: staffCookie });
    assert.equal(after.json.counts.pendingBookings, before.json.counts.pendingBookings - 1);
  }
});

test('logout destroys the server-side session', async () => {
  const cookie = await signIn();
  const out = await call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(out.status, 200);
  const me = await call('/api/auth/me', { cookie });
  assert.equal(me.status, 401);
});

test('cross-origin writes are refused', async () => {
  const response = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'cenius@cenius.ai', password: 'cenius' },
    headers: { Origin: 'http://evil.example' },
  });
  assert.equal(response.status, 403);
});

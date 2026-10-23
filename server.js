'use strict';

/**
 * Ferry Timetable Notice Board — single-process HTTP server.
 *
 * Everything lives here on purpose: routing, validation, persistence, seeding
 * and auth are all in one auditable file built only from Node 20 built-ins.
 * The browser app in public/ is served from this same process.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.resolve(ROOT_DIR, process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL_MS = Math.max(5, Number(process.env.SESSION_TTL_MINUTES || 720)) * 60 * 1000;
const SESSION_COOKIE = 'ferry_session';
const MAX_BODY_BYTES = 64 * 1024;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SEVERITIES = ['Info', 'Warning', 'Critical'];
const NOTICE_STATUSES = ['Draft', 'Published'];
const BOOKING_STATUSES = ['Pending', 'Approved', 'Declined'];
const VEHICLE_TYPES = ['Car', 'Car with trailer', 'Campervan', 'Light van', 'Motorcycle'];

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function httpError(status, message, fields, headers) {
  const error = new Error(message);
  error.status = status;
  if (fields) error.fields = fields;
  if (headers) error.headers = headers;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function todayWeekday() {
  return new Date().getDay();
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/* ------------------------------------------------------------------ *
 * Persistence: one JSON document, written atomically
 * ------------------------------------------------------------------ */

let db = null;

function createEmptyDatabase() {
  return {
    version: 1,
    piers: [],
    staffUsers: [],
    crossings: [],
    notices: [],
    bookings: [],
  };
}

function readDatabaseFile() {
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const next = createEmptyDatabase();
    for (const key of Object.keys(next)) {
      if (Array.isArray(next[key])) next[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
      else if (key === 'version') next[key] = parsed[key] || 1;
    }
    return next;
  } catch (error) {
    console.error(`[db] could not parse ${DB_FILE}:`, error.message);
    return null;
  }
}

function persistDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

function initialiseDatabase() {
  const existing = readDatabaseFile();
  db = existing || createEmptyDatabase();
  const changed = seedDatabase(db);
  if (!existing || changed) persistDatabase();
  return db;
}

/* ------------------------------------------------------------------ *
 * Password hashing (scrypt + per-user salt) and sessions
 * ------------------------------------------------------------------ */

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { passwordSalt: salt, passwordHash: hashPassword(password, salt) };
}

function verifyPassword(user, password) {
  if (!user || typeof user.passwordHash !== 'string' || typeof user.passwordSalt !== 'string') return false;
  const attempted = Buffer.from(hashPassword(password, user.passwordSalt), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (attempted.length !== stored.length) return false;
  return crypto.timingSafeEqual(attempted, stored);
}

const sessions = new Map();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) jar[key] = decodeURIComponent(value);
  }
  return jar;
}

function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = db.staffUsers.find((candidate) => candidate.id === session.userId);
  return user || null;
}

function requireStaffUser(req) {
  const user = sessionUser(req);
  if (!user) throw httpError(401, 'Sign in to continue.');
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function sessionCookie(value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.COOKIE_SECURE === 'true') parts.push('Secure');
  return parts.join('; ');
}

/* ------------------------------------------------------------------ *
 * Rate limiting for the login endpoint (in-process, windowed)
 * ------------------------------------------------------------------ */

const loginBuckets = new Map();

function consumeLoginAttempt(key, limit, windowMs) {
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    loginBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function clearLoginAttempts(key) {
  loginBuckets.delete(key);
}

/* ------------------------------------------------------------------ *
 * Boundary validation helpers
 * ------------------------------------------------------------------ */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function createValidator() {
  const errors = {};
  const add = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };
  const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

  return {
    errors,


    finish() {
      if (Object.keys(errors).length > 0) {
        throw httpError(400, 'Please correct the highlighted fields.', errors);
      }
    },

    /** required/optional trimmed text with a length window */
    string(body, field, label, { min = 1, max = 200, required = true } = {}) {
      const raw = body[field];
      if (isBlank(raw)) {
        if (required) add(field, `${label} is required.`);
        return '';
      }
      if (typeof raw !== 'string') {
        add(field, `${label} must be text.`);
        return '';
      }
      const value = raw.trim();
      if (value.length < min) {
        add(field, `${label} must be at least ${min} characters.`);
        return value;
      }
      if (value.length > max) {
        add(field, `${label} must be ${max} characters or fewer.`);
        return value.slice(0, max);
      }
      return value;
    },

    email(body, field, label) {
      const value = this.string(body, field, label, { min: 5, max: 254 });
      if (value && !EMAIL_PATTERN.test(value)) add(field, `${label} must be a valid email address.`);
      return value.toLowerCase();
    },

    isoDate(body, field, label, { allowPast = true } = {}) {
      const value = this.string(body, field, label, { min: 10, max: 10 });
      if (!value) return '';
      if (!DATE_PATTERN.test(value)) {
        add(field, `${label} must use the YYYY-MM-DD format.`);
        return '';
      }
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        add(field, `${label} is not a real date.`);
        return '';
      }
      if (!allowPast) {
        const today = new Date();
        const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        if (parsed.getTime() < todayUtc) add(field, `${label} cannot be in the past.`);
      }
      return value;
    },

    time(body, field, label) {
      const value = this.string(body, field, label, { min: 5, max: 5 });
      if (value && !TIME_PATTERN.test(value)) {
        add(field, `${label} must use the 24-hour HH:MM format.`);
        return '';
      }
      return value;
    },

    number(body, field, label, { min = 0, max = 100000, integer = false } = {}) {
      const raw = body[field];
      if (isBlank(raw)) {
        add(field, `${label} is required.`);
        return NaN;
      }
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) {
        add(field, `${label} must be a number.`);
        return NaN;
      }
      if (integer && !Number.isInteger(value)) {
        add(field, `${label} must be a whole number.`);
        return NaN;
      }
      if (value < min || value > max) {
        add(field, `${label} must be between ${min} and ${max}.`);
        return NaN;
      }
      return value;
    },

    oneOf(body, field, label, allowed, { required = true, fallback = null } = {}) {
      const raw = body[field];
      if (isBlank(raw)) {
        if (required) add(field, `${label} is required.`);
        return fallback;
      }
      const value = String(raw);
      if (!allowed.includes(value)) {
        add(field, `${label} must be one of: ${allowed.join(', ')}.`);
        return fallback;
      }
      return value;
    },

    weekday(body, field, label) {
      const raw = body[field];
      if (isBlank(raw)) {
        add(field, `${label} is required.`);
        return NaN;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 6) {
        add(field, `${label} must be a day between Sunday (0) and Saturday (6).`);
        return NaN;
      }
      return value;
    },

    /** Accepts booleans plus the strings "true"/"false" from form payloads. */
    boolean(body, field, fallback) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === '') return fallback;
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'on' || raw === 1 || raw === '1') return true;
      if (raw === 'false' || raw === 'off' || raw === 0 || raw === '0') return false;
      add(field, `${field} must be true or false.`);
      return fallback;
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(httpError(400, 'Request body must be valid JSON.'));
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(httpError(400, 'Request body must be a JSON object.'));
        return;
      }
      resolve(parsed);
    });
    req.on('error', () => reject(httpError(400, 'Could not read the request body.')));
  });
}

/* ------------------------------------------------------------------ *
 * Domain lookups and projections
 * ------------------------------------------------------------------ */

function pierById(id) {
  return db.piers.find((pier) => pier.id === id) || null;
}

function sortedPiers() {
  return [...db.piers].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function staffUserById(id) {
  return db.staffUsers.find((user) => user.id === id) || null;
}

function firstPierId() {
  const piers = sortedPiers();
  return piers.length > 0 ? piers[0].id : null;
}

function noticeView(notice) {
  const pier = notice.pierId ? pierById(notice.pierId) : null;
  const author = staffUserById(notice.authorId);
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    severity: notice.severity,
    pierId: notice.pierId,
    pierName: pier ? pier.name : null,
    status: notice.status,
    authorId: notice.authorId,
    authorName: author ? author.name : 'Operations',
    publishedAt: notice.publishedAt,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
  };
}

function crossingView(crossing) {
  const pier = pierById(crossing.pierId);
  return {
    id: crossing.id,
    pierId: crossing.pierId,
    pierName: pier ? pier.name : 'Unknown pier',
    pierCode: pier ? pier.code : '—',
    weekday: crossing.weekday,
    weekdayName: WEEKDAY_NAMES[crossing.weekday] || '',
    departureTime: crossing.departureTime,
    arrivalTime: crossing.arrivalTime,
    durationMinutes: minutesFromTime(crossing.arrivalTime) - minutesFromTime(crossing.departureTime),
    vesselName: crossing.vesselName,
    vehicleCapacity: crossing.vehicleCapacity,
    active: crossing.active,
    createdAt: crossing.createdAt,
    updatedAt: crossing.updatedAt,
  };
}

function bookingView(booking) {
  const pier = pierById(booking.pierId);
  const crossing = db.crossings.find((candidate) => candidate.id === booking.crossingId) || null;
  const reviewer = booking.reviewerId ? staffUserById(booking.reviewerId) : null;
  return {
    id: booking.id,
    reference: booking.reference,
    passengerName: booking.passengerName,
    email: booking.email,
    phone: booking.phone,
    pierId: booking.pierId,
    pierName: pier ? pier.name : 'Unknown pier',
    crossingId: booking.crossingId,
    departureTime: crossing ? crossing.departureTime : null,
    arrivalTime: crossing ? crossing.arrivalTime : null,
    vesselName: crossing ? crossing.vesselName : 'Crossing withdrawn',
    weekday: crossing ? crossing.weekday : null,
    weekdayName: crossing ? WEEKDAY_NAMES[crossing.weekday] : null,
    travelDate: booking.travelDate,
    vehicleType: booking.vehicleType,
    vehicleLength: booking.vehicleLength,
    notes: booking.notes,
    status: booking.status,
    declineReason: booking.declineReason,
    reviewerId: booking.reviewerId,
    reviewerName: reviewer ? reviewer.name : null,
    decidedAt: booking.decidedAt,
    createdAt: booking.createdAt,
  };
}

function publishedNotices() {
  return db.notices
    .filter((notice) => notice.status === 'Published')
    .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)));
}

function noticeAppliesToPier(notice, pierId) {
  return notice.pierId === null || notice.pierId === pierId;
}

function activeCrossings(pierId, weekday) {
  return db.crossings
    .filter((crossing) => crossing.active && crossing.pierId === pierId && crossing.weekday === weekday)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

function bookingCounts() {
  const counts = { all: db.bookings.length, Pending: 0, Approved: 0, Declined: 0 };
  for (const booking of db.bookings) {
    if (counts[booking.status] !== undefined) counts[booking.status] += 1;
  }
  return counts;
}

function newBookingReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let suffix = '';
    for (let index = 0; index < 4; index += 1) {
      suffix += alphabet[crypto.randomInt(alphabet.length)];
    }
    const reference = `FB-${suffix}`;
    if (!db.bookings.some((booking) => booking.reference === reference)) return reference;
  }
  return `FB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/* ------------------------------------------------------------------ *
 * Seed data
 * ------------------------------------------------------------------ */

const SEED_PIERS = [
  { id: 'pier-north-quay', name: 'North Quay', code: 'NQ', sortOrder: 1, note: 'Mainland terminal for the north island run.' },
  { id: 'pier-harbour-point', name: 'Harbour Point', code: 'HP', sortOrder: 2, note: 'Town-centre pier with the wide vehicle deck ramp.' },
  { id: 'pier-cliffside', name: 'Cliffside Landing', code: 'CL', sortOrder: 3, note: 'Short crossing from the western headland.' },
];

// Weekday sailings per pier: [departure, arrival, vesselName, vehicleCapacity]
const SEED_SAILINGS = {
  'pier-north-quay': {
    weekday: [
      ['06:40', '07:25', 'MV Northwind', 48],
      ['08:20', '09:05', 'MV Selkie', 36],
      ['11:00', '11:45', 'MV Northwind', 48],
      ['14:30', '15:20', 'MV Selkie', 36],
      ['17:40', '18:25', 'MV Cormorant', 54],
    ],
    weekend: [
      ['08:00', '08:50', 'MV Northwind', 48],
      ['12:00', '12:50', 'MV Selkie', 36],
      ['16:00', '16:50', 'MV Cormorant', 54],
    ],
  },
  'pier-harbour-point': {
    weekday: [
      ['07:10', '07:55', 'MV Tern', 60],
      ['10:05', '10:50', 'MV Beacon', 42],
      ['13:15', '14:05', 'MV Tern', 60],
      ['18:10', '18:55', 'MV Beacon', 42],
    ],
    weekend: [
      ['09:30', '10:15', 'MV Tern', 60],
      ['15:20', '16:10', 'MV Beacon', 42],
    ],
  },
  'pier-cliffside': {
    weekday: [
      ['06:55', '07:35', 'MV Saltire', 24],
      ['12:40', '13:20', 'MV Saltire', 24],
      ['16:45', '17:30', 'MV Osprey', 30],
    ],
    weekend: [
      ['10:20', '11:00', 'MV Saltire', 24],
      ['14:10', '14:55', 'MV Osprey', 30],
    ],
  },
};

// Demo staff accounts. Credentials are read from the environment with
// clearly non-production demo fallbacks so a fresh clone can sign in; set the
// environment variables before running the board for real traffic. Both
// accounts hash through the same scrypt path as every other account.
const DEMO_STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD || 'cenius';
const DEMO_ALT_STAFF_PASSWORD = process.env.DEMO_ALT_STAFF_PASSWORD || 'FerryDemo123!';

const SEED_STAFF = [
  {
    id: 'staff-cenius',
    name: 'Dana Whitfield',
    email: 'cenius@cenius.ai',
    password: DEMO_STAFF_PASSWORD,
    role: 'admin',
  },
  {
    id: 'staff-demo',
    name: 'Priya Raman',
    email: 'demo@ferryboard.app',
    password: DEMO_ALT_STAFF_PASSWORD,
    role: 'staff',
  },
];

const SEED_NOTICES = [
  {
    id: 'notice-harbour-slipway',
    title: 'Harbour Point slipway closed for emergency repairs',
    body:
      'The vehicle ramp at Harbour Point is closed until Friday while the hydraulic lift is repaired. ' +
      'Vehicles are being redirected to North Quay, where the 13:15 and 18:10 sailings have extra deck space.',
    severity: 'Critical',
    pierId: 'pier-harbour-point',
    status: 'Published',
    daysAgo: 0.2,
  },
  {
    id: 'notice-high-winds',
    title: 'High winds forecast — vehicle loading may be delayed',
    body:
      'Gusts of up to 45 mph are forecast from Thursday evening. Deck crews may pause loading between sailings ' +
      'for safety. Please arrive 20 minutes before departure and follow marshals on the quay.',
    severity: 'Warning',
    pierId: null,
    status: 'Published',
    daysAgo: 1.4,
  },
  {
    id: 'notice-extra-sailing',
    title: 'Extra 06:40 weekday sailing added from North Quay',
    body:
      'A third early sailing now runs Monday to Friday to cover commuter demand. Deck capacity is 48 vehicles ' +
      'and foot passengers board from the east gangway.',
    severity: 'Info',
    pierId: 'pier-north-quay',
    status: 'Published',
    daysAgo: 4.1,
  },
  {
    id: 'notice-cliffside-carpark',
    title: 'Cliffside Landing car park resurfacing (draft)',
    body:
      'The long-stay car park will close for resurfacing next month. Awaiting confirmation of the contractor ' +
      'start date before this notice is published.',
    severity: 'Warning',
    pierId: 'pier-cliffside',
    status: 'Draft',
    daysAgo: 2.3,
  },
];

const SEED_BOOKINGS = [
  {
    id: 'booking-fiona',
    passengerName: 'Fiona MacLeod',
    email: 'fiona.macleod@example.com',
    phone: '07700 900412',
    pierId: 'pier-north-quay',
    crossingIndex: 1,
    weekday: 'weekday',
    travelInDays: 2,
    vehicleType: 'Car',
    vehicleLength: 4.4,
    notes: 'Roof box fitted, total height 2.1m.',
    status: 'Pending',
    hoursAgo: 2,
  },
  {
    id: 'booking-owen',
    passengerName: 'Owen Brady',
    email: 'owen.brady@example.com',
    phone: '07700 900188',
    pierId: 'pier-harbour-point',
    crossingIndex: 0,
    weekday: 'weekday',
    travelInDays: 4,
    vehicleType: 'Campervan',
    vehicleLength: 6.2,
    notes: 'Travelling with two bicycles on a rear rack.',
    status: 'Pending',
    hoursAgo: 20,
  },
  {
    id: 'booking-isla',
    passengerName: 'Isla Nguyen',
    email: 'isla.nguyen@example.com',
    phone: '07700 900733',
    pierId: 'pier-cliffside',
    crossingIndex: 0,
    weekday: 'weekday',
    travelInDays: 1,
    vehicleType: 'Light van',
    vehicleLength: 5.1,
    notes: 'Delivering farm supplies to the headland shop.',
    status: 'Approved',
    hoursAgo: 30,
    decidedHoursAgo: 26,
  },
  {
    id: 'booking-theo',
    passengerName: 'Theo Marsh',
    email: 'theo.marsh@example.com',
    phone: '07700 900264',
    pierId: 'pier-north-quay',
    crossingIndex: 3,
    weekday: 'weekday',
    travelInDays: 3,
    vehicleType: 'Car with trailer',
    vehicleLength: 9.8,
    notes: 'Boat trailer, single axle.',
    status: 'Declined',
    hoursAgo: 52,
    decidedHoursAgo: 48,
    declineReason: 'Combined length exceeds the 8 metre deck limit for this vessel. Please book the 11:00 sailing, which uses the wider MV Northwind.',
  },
  {
    id: 'booking-astrid',
    passengerName: 'Astrid Berg',
    email: 'astrid.berg@example.com',
    phone: '07700 900951',
    pierId: 'pier-cliffside',
    crossingIndex: 1,
    weekday: 'weekend',
    travelInDays: 6,
    vehicleType: 'Motorcycle',
    vehicleLength: 2.1,
    notes: 'Side panniers, no trailer.',
    status: 'Pending',
    hoursAgo: 5,
  },
];

function seedCrossingsFor(target, pierId) {
  const pier = SEED_PIERS.find((candidate) => candidate.id === pierId);
  if (!pier) return 0;
  const code = pier.code.toLowerCase();
  let created = 0;
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const isWeekend = weekday === 0 || weekday === 6;
    const sailings = isWeekend ? SEED_SAILINGS[pierId].weekend : SEED_SAILINGS[pierId].weekday;
    sailings.forEach((sailing, index) => {
      const id = `crossing-${code}-${weekday}-${index}`;
      if (target.crossings.some((crossing) => crossing.id === id)) return;
      const [departureTime, arrivalTime, vesselName, vehicleCapacity] = sailing;
      target.crossings.push({
        id,
        pierId,
        weekday,
        departureTime,
        arrivalTime,
        vesselName,
        vehicleCapacity,
        active: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created += 1;
    });
  }
  const inactiveId = `crossing-${code}-inactive`;
  if (!target.crossings.some((crossing) => crossing.id === inactiveId)) {
    target.crossings.push({
      id: inactiveId,
      pierId,
      weekday: 3,
      departureTime: '21:30',
      arrivalTime: '22:15',
      vesselName: 'MV Osprey (charter)',
      vehicleCapacity: 18,
      active: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    created += 1;
  }
  return created;
}

function seedDatabase(target) {
  let changed = 0;

  for (const pier of SEED_PIERS) {
    if (!target.piers.some((existing) => existing.id === pier.id)) {
      target.piers.push({ ...pier, createdAt: nowIso() });
      changed += 1;
    }
  }

  for (const staff of SEED_STAFF) {
    const existing = target.staffUsers.find((user) => user.email.toLowerCase() === staff.email);
    if (!existing) {
      const record = makePasswordRecord(staff.password);
      target.staffUsers.push({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        passwordHash: record.passwordHash,
        passwordSalt: record.passwordSalt,
        role: staff.role,
        createdAt: nowIso(),
      });
      changed += 1;
    } else if (!verifyPassword(existing, staff.password)) {
      // The configured demo credential changed (for example a deployment set
      // DEMO_STAFF_PASSWORD), so re-hash to keep the seeded login working.
      const record = makePasswordRecord(staff.password);
      existing.passwordHash = record.passwordHash;
      existing.passwordSalt = record.passwordSalt;
      changed += 1;
    }
  }

  for (const pier of SEED_PIERS) {
    changed += seedCrossingsFor(target, pier.id);
  }

  const author = target.staffUsers.find((user) => user.email === 'cenius@cenius.ai') || target.staffUsers[0];
  const authorId = author ? author.id : null;

  for (const notice of SEED_NOTICES) {
    if (target.notices.some((existing) => existing.id === notice.id)) continue;
    const createdAt = new Date(Date.now() - notice.daysAgo * 86400000).toISOString();
    target.notices.push({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      severity: notice.severity,
      pierId: notice.pierId,
      status: notice.status,
      authorId,
      publishedAt: notice.status === 'Published' ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    });
    changed += 1;
  }

  for (const booking of SEED_BOOKINGS) {
    if (target.bookings.some((existing) => existing.id === booking.id)) continue;
    const sailings = SEED_SAILINGS[booking.pierId][booking.weekday];
    const sailing = sailings[Math.min(booking.crossingIndex, sailings.length - 1)];
    if (!sailing) continue;
    const pierCode = (SEED_PIERS.find((pier) => pier.id === booking.pierId) || { code: 'XX' }).code.toLowerCase();
    const crossingWeekday = booking.weekday === 'weekend' ? 6 : 2;
    const crossing = target.crossings.find(
      (candidate) => candidate.pierId === booking.pierId && candidate.weekday === crossingWeekday && candidate.departureTime === sailing[0],
    );
    const createdAt = new Date(Date.now() - booking.hoursAgo * 3600000).toISOString();
    const travelDate = new Date(Date.now() + booking.travelInDays * 86400000).toISOString().slice(0, 10);
    const decided = booking.status !== 'Pending';
    target.bookings.push({
      id: booking.id,
      reference: `FB-${pierCode.toUpperCase()}${booking.crossingIndex}${booking.status.slice(0, 1)}`,
      passengerName: booking.passengerName,
      email: booking.email,
      phone: booking.phone,
      pierId: booking.pierId,
      crossingId: crossing ? crossing.id : `${pierCode}-fallback`,
      travelDate,
      vehicleType: booking.vehicleType,
      vehicleLength: booking.vehicleLength,
      notes: booking.notes,
      status: booking.status,
      declineReason: booking.declineReason || null,
      reviewerId: decided ? authorId : null,
      decidedAt: decided ? new Date(Date.now() - booking.decidedHoursAgo * 3600000).toISOString() : null,
      createdAt,
    });
    changed += 1;
  }

  return changed;
}

/* ------------------------------------------------------------------ *
 * HTTP responses
 * ------------------------------------------------------------------ */

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; " +
      "frame-ancestors 'none'; object-src 'none'",
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/* ------------------------------------------------------------------ *
 * API handlers
 * ------------------------------------------------------------------ */

function handleLogin(req, res, body) {
  const validator = createValidator();
  const email = validator.email(body, 'email', 'Email');
  const password = validator.string(body, 'password', 'Password', { min: 1, max: 200 });
  validator.finish();

  const ip = req.socket.remoteAddress || 'unknown';
  const ipLimit = consumeLoginAttempt(`ip:${ip}`, 20, 10 * 60 * 1000);
  if (!ipLimit.allowed) {
    throw httpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.', null, {
      'Retry-After': String(ipLimit.retryAfterSeconds || 60),
    });
  }
  const identityLimit = consumeLoginAttempt(`email:${email}`, 8, 10 * 60 * 1000);
  if (!identityLimit.allowed) {
    throw httpError(429, 'Too many sign-in attempts for this account. Please wait a few minutes and try again.', null, {
      'Retry-After': String(identityLimit.retryAfterSeconds || 60),
    });
  }

  const user = db.staffUsers.find((candidate) => candidate.email.toLowerCase() === email);
  if (!user) {
    // Burn an equivalent scrypt round so a missing account is not detectable by timing.
    hashPassword(password, 'ferryboard-unknown-account-salt');
    throw httpError(401, 'Email or password is incorrect.');
  }
  if (!verifyPassword(user, password)) {
    throw httpError(401, 'Email or password is incorrect.');
  }

  clearLoginAttempts(`email:${email}`);
  const token = createSession(user.id);
  sendJson(res, 200, { user: publicUser(user) }, {
    'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)),
  });
}

function handleLogout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  destroySession(token);
  sendJson(res, 200, { ok: true }, {
    'Set-Cookie': sessionCookie('', 0),
  });
}

function handleTimetable(req, res, url) {
  const piers = sortedPiers();
  const requestedPier = url.searchParams.get('pier');
  const pier = (requestedPier && pierById(requestedPier)) || (piers.length ? piers[0] : null);
  const weekdayParam = url.searchParams.get('weekday');
  const requestedWeekday = weekdayParam === null || weekdayParam === '' ? NaN : Number(weekdayParam);
  const weekday = Number.isInteger(requestedWeekday) && requestedWeekday >= 0 && requestedWeekday <= 6
    ? requestedWeekday
    : todayWeekday();

  if (!pier) {
    sendJson(res, 200, { pier: null, weekday, weekdayName: WEEKDAY_NAMES[weekday], crossings: [], notices: [], piers: [] });
    return;
  }

  const crossings = activeCrossings(pier.id, weekday).map(crossingView);
  const notices = publishedNotices()
    .filter((notice) => noticeAppliesToPier(notice, pier.id))
    .map(noticeView);

  sendJson(res, 200, {
    pier: { id: pier.id, name: pier.name, code: pier.code, sortOrder: pier.sortOrder, note: pier.note || '' },
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    crossings,
    notices,
    piers: piers.map((entry) => ({ id: entry.id, name: entry.name, code: entry.code, sortOrder: entry.sortOrder })),
  });
}

function handlePublicCrossings(req, res, url) {
  const pierId = url.searchParams.get('pierId') || firstPierId();
  if (!pierId || !pierById(pierId)) throw httpError(404, 'Pier not found.');
  const weekdayParam = url.searchParams.get('weekday');
  const weekday = weekdayParam === null || weekdayParam === '' ? null : Number(weekdayParam);
  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    throw httpError(400, 'Weekday must be a day between Sunday (0) and Saturday (6).');
  }
  const crossings = db.crossings
    .filter((crossing) => crossing.active && crossing.pierId === pierId && (weekday === null || crossing.weekday === weekday))
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
    .map(crossingView);
  sendJson(res, 200, { pierId, weekday, crossings });
}

function handleCreateBooking(req, res, body) {
  const validator = createValidator();
  const passengerName = validator.string(body, 'passengerName', 'Passenger name', { min: 2, max: 80 });
  const email = validator.email(body, 'email', 'Email');
  const phone = validator.string(body, 'phone', 'Phone number', { min: 6, max: 30 });
  const pierId = validator.string(body, 'pierId', 'Pier', { min: 1, max: 80 });
  const crossingId = validator.string(body, 'crossingId', 'Departure', { min: 1, max: 80 });
  const travelDate = validator.isoDate(body, 'travelDate', 'Travel date', { allowPast: false });
  const vehicleType = validator.oneOf(body, 'vehicleType', 'Vehicle type', VEHICLE_TYPES);
  const vehicleLength = validator.number(body, 'vehicleLength', 'Vehicle length', { min: 1, max: 30 });
  const notes = validator.string(body, 'notes', 'Notes', { required: false, max: 400 });
  validator.finish();

  if (!pierById(pierId)) {
    throw httpError(400, 'Please correct the highlighted fields.', { pierId: 'Choose a pier from the list.' });
  }
  const crossing = db.crossings.find((candidate) => candidate.id === crossingId);
  if (!crossing || !crossing.active || crossing.pierId !== pierId) {
    throw httpError(400, 'Please correct the highlighted fields.', {
      crossingId: 'Choose an active departure for the selected pier.',
    });
  }
  if (travelDate) {
    const travelWeekday = new Date(`${travelDate}T00:00:00Z`).getUTCDay();
    if (crossing.weekday !== travelWeekday) {
      throw httpError(400, 'Please correct the highlighted fields.', {
        crossingId: `That departure does not sail on ${WEEKDAY_NAMES[travelWeekday]}. Choose another departure or date.`,
      });
    }
  }

  const booking = {
    id: crypto.randomUUID(),
    reference: newBookingReference(),
    passengerName,
    email,
    phone,
    pierId,
    crossingId,
    travelDate,
    vehicleType,
    vehicleLength,
    notes,
    status: 'Pending',
    declineReason: null,
    reviewerId: null,
    decidedAt: null,
    createdAt: nowIso(),
  };
  db.bookings.push(booking);
  persistDatabase();
  sendJson(res, 201, { reference: booking.reference, booking: bookingView(booking) });
}

function handleStaffBookings(req, res, url) {
  const statusParam = url.searchParams.get('status');
  let status = null;
  if (statusParam && statusParam !== 'All') {
    if (!BOOKING_STATUSES.includes(statusParam)) throw httpError(400, 'Unknown booking status filter.');
    status = statusParam;
  }
  const bookings = db.bookings
    .filter((booking) => (status ? booking.status === status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(bookingView);
  sendJson(res, 200, { bookings, counts: bookingCounts(), status: status || 'All' });
}

function handleStaffBookingDetail(req, res, params) {
  const booking = db.bookings.find((candidate) => candidate.id === params.id);
  if (!booking) throw httpError(404, 'Booking request not found.');
  sendJson(res, 200, { booking: bookingView(booking) });
}

function handleBookingDecision(req, res, params, body, user) {
  const booking = db.bookings.find((candidate) => candidate.id === params.id);
  if (!booking) throw httpError(404, 'Booking request not found.');

  const validator = createValidator();
  const action = validator.oneOf(body, 'action', 'Decision', ['approve', 'decline']);
  const reason = validator.string(body, 'reason', 'Decline reason', { required: action === 'decline', max: 300 });
  validator.finish();

  if (booking.status !== 'Pending') {
    throw httpError(409, `This request has already been ${booking.status.toLowerCase()}.`);
  }
  if (action === 'decline' && reason.trim().length < 5) {
    throw httpError(400, 'Please correct the highlighted fields.', {
      reason: 'Give a short reason so the passenger knows why the request was declined.',
    });
  }

  booking.status = action === 'approve' ? 'Approved' : 'Declined';
  booking.declineReason = action === 'decline' ? reason.trim() : null;
  booking.reviewerId = user.id;
  booking.decidedAt = nowIso();
  persistDatabase();
  sendJson(res, 200, { booking: bookingView(booking) });
}

function readCrossingPayload(body) {
  const validator = createValidator();
  const pierId = validator.string(body, 'pierId', 'Pier', { min: 1, max: 80 });
  const weekday = validator.weekday(body, 'weekday', 'Weekday');
  const departureTime = validator.time(body, 'departureTime', 'Departure time');
  const arrivalTime = validator.time(body, 'arrivalTime', 'Arrival time');
  const vesselName = validator.string(body, 'vesselName', 'Vessel name', { min: 2, max: 80 });
  const vehicleCapacity = validator.number(body, 'vehicleCapacity', 'Vehicle capacity', { min: 1, max: 500, integer: true });
  const active = validator.boolean(body, 'active', true);
  validator.finish();

  if (!pierById(pierId)) {
    throw httpError(400, 'Please correct the highlighted fields.', { pierId: 'Choose a pier from the list.' });
  }
  if (minutesFromTime(arrivalTime) <= minutesFromTime(departureTime)) {
    throw httpError(400, 'Please correct the highlighted fields.', {
      arrivalTime: 'Arrival must be later than departure.',
    });
  }
  return { pierId, weekday, departureTime, arrivalTime, vesselName, vehicleCapacity, active };
}

function handleCreateCrossing(req, res, body) {
  const payload = readCrossingPayload(body);
  const crossing = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.crossings.push(crossing);
  persistDatabase();
  sendJson(res, 201, { crossing: crossingView(crossing) });
}

function handleUpdateCrossing(req, res, params, body) {
  const crossing = db.crossings.find((candidate) => candidate.id === params.id);
  if (!crossing) throw httpError(404, 'Crossing not found.');
  const payload = readCrossingPayload(body);
  Object.assign(crossing, payload, { updatedAt: nowIso() });
  persistDatabase();
  sendJson(res, 200, { crossing: crossingView(crossing) });
}

function handleDeleteCrossing(req, res, params) {
  const index = db.crossings.findIndex((candidate) => candidate.id === params.id);
  if (index < 0) throw httpError(404, 'Crossing not found.');
  const [removed] = db.crossings.splice(index, 1);
  persistDatabase();
  sendJson(res, 200, { ok: true, id: removed.id });
}

function handleStaffCrossings(req, res) {
  const crossings = [...db.crossings]
    .map(crossingView)
    .sort(
      (a, b) =>
        a.pierName.localeCompare(b.pierName) ||
        a.weekday - b.weekday ||
        a.departureTime.localeCompare(b.departureTime),
    );
  sendJson(res, 200, { crossings });
}

function staffNoticeList() {
  return [...db.notices]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(noticeView);
}

function readNoticePayload(body) {
  const validator = createValidator();
  const title = validator.string(body, 'title', 'Title', { min: 4, max: 120 });
  const noticeBody = validator.string(body, 'body', 'Notice text', { min: 10, max: 2000 });
  const severity = validator.oneOf(body, 'severity', 'Severity', SEVERITIES);
  const status = validator.oneOf(body, 'status', 'Status', NOTICE_STATUSES, { required: false, fallback: 'Draft' }) || 'Draft';
  const rawPier = body.pierId;
  let pierId = null;
  if (rawPier !== undefined && rawPier !== null && String(rawPier).trim() !== '' && String(rawPier) !== 'all') {
    pierId = String(rawPier);
  }
  validator.finish();
  if (pierId && !pierById(pierId)) {
    throw httpError(400, 'Please correct the highlighted fields.', { pierId: 'Choose a pier from the list, or All piers.' });
  }
  return { title, body: noticeBody, severity, status, pierId };
}

function handleCreateNotice(req, res, body, user) {
  const payload = readNoticePayload(body);
  const notice = {
    id: crypto.randomUUID(),
    ...payload,
    authorId: user.id,
    publishedAt: payload.status === 'Published' ? nowIso() : null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.notices.push(notice);
  persistDatabase();
  sendJson(res, 201, { notice: noticeView(notice) });
}

function handleUpdateNotice(req, res, params, body) {
  const notice = db.notices.find((candidate) => candidate.id === params.id);
  if (!notice) throw httpError(404, 'Notice not found.');
  const payload = readNoticePayload(body);
  const becomingPublished = payload.status === 'Published' && notice.status !== 'Published';
  Object.assign(notice, payload, {
    publishedAt: becomingPublished ? nowIso() : payload.status === 'Published' ? notice.publishedAt : null,
    updatedAt: nowIso(),
  });
  persistDatabase();
  sendJson(res, 200, { notice: noticeView(notice) });
}

function handleDeleteNotice(req, res, params) {
  const index = db.notices.findIndex((candidate) => candidate.id === params.id);
  if (index < 0) throw httpError(404, 'Notice not found.');
  const [removed] = db.notices.splice(index, 1);
  persistDatabase();
  sendJson(res, 200, { ok: true, id: removed.id });
}

function todaysDepartures() {
  const weekday = todayWeekday();
  return db.crossings
    .filter((crossing) => crossing.active && crossing.weekday === weekday)
    .sort(
      (a, b) =>
        a.departureTime.localeCompare(b.departureTime) ||
        (pierById(a.pierId)?.sortOrder || 0) - (pierById(b.pierId)?.sortOrder || 0),
    )
    .map(crossingView);
}

function handleDashboard(req, res, user) {
  const weekday = todayWeekday();
  const departures = todaysDepartures();
  const counts = bookingCounts();
  sendJson(res, 200, {
    user: publicUser(user),
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    counts: {
      pendingBookings: counts.Pending,
      approvedBookings: counts.Approved,
      declinedBookings: counts.Declined,
      publishedNotices: db.notices.filter((notice) => notice.status === 'Published').length,
      draftNotices: db.notices.filter((notice) => notice.status === 'Draft').length,
      activeCrossingsToday: departures.length,
      totalCrossings: db.crossings.length,
      piers: db.piers.length,
    },
    departures,
  });
}

function handleBoard(req, res) {
  const weekday = todayWeekday();
  const piers = sortedPiers().map((pier) => {
    const crossings = activeCrossings(pier.id, weekday);
    return {
      id: pier.id,
      name: pier.name,
      code: pier.code,
      sortOrder: pier.sortOrder,
      note: pier.note || '',
      crossingsToday: crossings.length,
      firstDeparture: crossings.length ? crossings[0].departureTime : null,
    };
  });
  const notices = publishedNotices().slice(0, 4).map(noticeView);
  sendJson(res, 200, {
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    piers,
    departures: todaysDepartures(),
    notices,
    publishedNotices: db.notices.filter((notice) => notice.status === 'Published').length,
  });
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

const routes = [];
function route(method, pattern, handler, options = {}) {
  const segments = pattern.split('/').filter(Boolean);
  routes.push({ method, segments, handler, auth: Boolean(options.auth) });
}

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[index]);
      else if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

route('GET', '/api/auth/me', (req, res) => {
  const user = sessionUser(req);
  if (!user) throw httpError(401, 'Not signed in.');
  sendJson(res, 200, { user: publicUser(user) });
});
route('POST', '/api/auth/login', (req, res) => readJsonBody(req).then((body) => handleLogin(req, res, body)));
route('POST', '/api/auth/logout', (req, res) => handleLogout(req, res), { auth: true });

route('GET', '/api/piers', (req, res) => {
  sendJson(res, 200, {
    piers: sortedPiers().map((pier) => ({
      id: pier.id,
      name: pier.name,
      code: pier.code,
      sortOrder: pier.sortOrder,
      note: pier.note || '',
    })),
  });
});
route('GET', '/api/timetable', (req, res, params, url) => handleTimetable(req, res, url));
route('GET', '/api/notices', (req, res) => sendJson(res, 200, { notices: publishedNotices().map(noticeView) }));
route('GET', '/api/crossings', (req, res, params, url) => handlePublicCrossings(req, res, url));
route('GET', '/api/board', (req, res) => handleBoard(req, res));
route('POST', '/api/bookings', (req, res) => readJsonBody(req).then((body) => handleCreateBooking(req, res, body)));

route('GET', '/api/staff/bookings', (req, res, params, url) => handleStaffBookings(req, res, url), { auth: true });
route('GET', '/api/staff/bookings/:id', (req, res, params) => handleStaffBookingDetail(req, res, params), { auth: true });
route(
  'POST',
  '/api/staff/bookings/:id/decision',
  (req, res, params, url, user) => readJsonBody(req).then((body) => handleBookingDecision(req, res, params, body, user)),
  { auth: true },
);

route('GET', '/api/staff/crossings', (req, res) => handleStaffCrossings(req, res), { auth: true });
route('POST', '/api/staff/crossings', (req, res) => readJsonBody(req).then((body) => handleCreateCrossing(req, res, body)), { auth: true });
route(
  'PUT',
  '/api/staff/crossings/:id',
  (req, res, params) => readJsonBody(req).then((body) => handleUpdateCrossing(req, res, params, body)),
  { auth: true },
);
route('DELETE', '/api/staff/crossings/:id', (req, res, params) => handleDeleteCrossing(req, res, params), { auth: true });

route('GET', '/api/staff/notices', (req, res) => sendJson(res, 200, { notices: staffNoticeList() }), { auth: true });
route(
  'POST',
  '/api/staff/notices',
  (req, res, params, url, user) => readJsonBody(req).then((body) => handleCreateNotice(req, res, body, user)),
  { auth: true },
);
route(
  'PUT',
  '/api/staff/notices/:id',
  (req, res, params) => readJsonBody(req).then((body) => handleUpdateNotice(req, res, params, body)),
  { auth: true },
);
route('DELETE', '/api/staff/notices/:id', (req, res, params) => handleDeleteNotice(req, res, params), { auth: true });

route('GET', '/api/dashboard', (req, res, params, url, user) => handleDashboard(req, res, user), { auth: true });

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

let indexHtmlCache = null;

function readIndexHtml() {
  if (indexHtmlCache) return indexHtmlCache;
  indexHtmlCache = fs.readFileSync(INDEX_FILE);
  return indexHtmlCache;
}

function serveIndexHtml(res) {
  const body = readIndexHtml();
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': CONTENT_TYPES['.html'],
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStaticFile(res, filePath, extension) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  const immutable = extension === '.woff2';
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function handleStatic(req, res, pathname) {
  const relative = pathname.replace(/^\/+/, '');
  const safePath = path.resolve(PUBLIC_DIR, relative);
  if (safePath.startsWith(PUBLIC_DIR + path.sep)) {
    const extension = path.extname(safePath).toLowerCase();
    if (CONTENT_TYPES[extension] && serveStaticFile(res, safePath, extension)) return;
  }
  // History fallback: every client-side route renders the SPA shell.
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveIndexHtml(res);
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed.' });
}

/* ------------------------------------------------------------------ *
 * Request pipeline
 * ------------------------------------------------------------------ */

function checkSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return; // non-browser clients (curl, tests) omit Origin
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw httpError(403, 'Request origin is not allowed.');
  }
  const host = req.headers.host;
  if (host && originHost !== host) throw httpError(403, 'Request origin is not allowed.');
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: 'Malformed request path.' });
    return;
  }

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!pathname.startsWith('/api/')) {
    handleStatic(req, res, pathname);
    return;
  }

  const match = matchRoute(req.method, pathname);
  if (!match) {
    sendJson(res, 404, { error: 'Endpoint not found.' });
    return;
  }

  try {
    checkSameOrigin(req);
    let user = null;
    if (match.route.auth) user = requireStaffUser(req);
    await match.route.handler(req, res, match.params, url, user);
  } catch (error) {
    if (res.headersSent) {
      console.error('[api] handler failed after responding', error);
      res.end();
      return;
    }
    if (error && error.status) {
      sendJson(
        res,
        error.status,
        {
          error: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
        error.headers || {},
      );
      return;
    }
    console.error('[api] unhandled error', error);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function startServer() {
  initialiseDatabase();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('[server] request failed', error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Something went wrong on our side.' });
      } else {
        res.end();
      }
    });
  });

  server.listen(PORT, HOST, () => {
    const pierCount = db.piers.length;
    const crossingCount = db.crossings.length;
    console.log(
      `Ferry Timetable Notice Board listening on ${HOST}:${PORT} — ` +
        `${pierCount} piers, ${crossingCount} crossings, ${db.notices.length} notices seeded.`,
    );
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, closing.`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

module.exports = {
  startServer,
  initialiseDatabase,
  getDatabase: () => db,
  DB_FILE,
  DATA_DIR,
};

if (require.main === module) {
  startServer();
}

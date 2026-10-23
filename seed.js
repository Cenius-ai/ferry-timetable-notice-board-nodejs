'use strict';

/**
 * Seed entrypoint: creates data/db.json (if missing) and fills it with the
 * demo piers, timetable, notices, booking requests and staff accounts.
 *
 * Safe to run repeatedly — every insert is check-before-write — and it never
 * starts the HTTP server, so it cannot hold the app port.
 */

const { initialiseDatabase, DB_FILE } = require('./server.js');

const db = initialiseDatabase();

const summary = [
  ['piers', db.piers.length],
  ['crossings', db.crossings.length],
  ['notices', db.notices.length],
  ['booking requests', db.bookings.length],
  ['staff accounts', db.staffUsers.length],
]
  .map(([label, count]) => `${count} ${label}`)
  .join(', ');

console.log(`Seed complete: ${summary}.`);
console.log(`Data file: ${DB_FILE}`);
console.log('Demo staff login: cenius@cenius.ai / cenius');

// Generates unique identifiers.
//
// NOTE: this uses the uuid@3 deep-import style `require('uuid/v4')`, which was
// REMOVED in uuid@7+. When the dependency is bumped, this line throws
// "Cannot find module 'uuid/v4'" and the test below fails — the exact kind of
// breaking API change Smart Dependency Updater is designed to repair.
const uuidv4 = require('uuid/v4');

/** @returns {string} a new random UUID v4 string */
function newId() {
  return uuidv4();
}

module.exports = { newId };

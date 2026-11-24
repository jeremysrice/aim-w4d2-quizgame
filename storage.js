// ===== Safe storage =====
// Every read and write of browser storage (localStorage) goes through here,
// so blocked or full storage can never crash the game.
// - Values are saved as JSON and read back already parsed.
// - If localStorage can't be used at all (some privacy modes, cookies off),
//   it falls back to an in-memory store that lasts until the page is closed.
// - If a write fails because storage is full, the value is still kept in
//   memory for this session, and set() returns false so callers can tell
//   the player it wasn't saved permanently.

// Creates a safe storage wrapper. getBackend is a function that returns the
// real storage object (normally localStorage); it's a function because in
// some browsers merely *accessing* localStorage throws when it's blocked.
function createSafeStorage(getBackend) {
  const memory = new Map(); // session-only copies (fallback, or failed writes)
  let backend = null;

  // Probe the real storage once: if we can write and remove a test key, use it.
  try {
    const candidate = getBackend();
    const probeKey = "__quizClashStorageProbe__";
    candidate.setItem(probeKey, "1");
    candidate.removeItem(probeKey);
    backend = candidate;
  } catch {
    backend = null;
  }

  // Reads a value. Returns fallback if it's missing, unreadable or corrupted.
  // A session-only copy (from a failed write) wins over the stored one,
  // because it's newer.
  function get(key, fallback = null) {
    try {
      const raw = memory.has(key) ? memory.get(key) : backend ? backend.getItem(key) : null;
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  // Saves a value. Returns true if it was saved permanently, or false if it
  // could only be kept in memory for this session (storage blocked or full).
  function set(key, value) {
    let raw;
    try {
      raw = JSON.stringify(value);
    } catch {
      return false; // value can't be saved as JSON
    }
    if (backend) {
      try {
        backend.setItem(key, raw);
        memory.delete(key);
        return true;
      } catch {
        // Full or blocked: fall through and keep it for this session.
      }
    }
    memory.set(key, raw);
    return false;
  }

  // Deletes a value from both permanent storage and the session copy.
  function remove(key) {
    memory.delete(key);
    if (backend) {
      try {
        backend.removeItem(key);
      } catch {
        // Nothing more we can do; the session copy is already gone.
      }
    }
  }

  return {
    get,
    set,
    remove,
    // true when values survive closing the page; false when memory-only.
    get persistent() {
      return backend !== null;
    },
  };
}

// The app's shared storage wrapper, backed by localStorage when available.
const safeStorage = createSafeStorage(() => globalThis.localStorage);

// Lets the Node unit tests load this file; ignored in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSafeStorage, safeStorage };
}

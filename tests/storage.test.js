// Unit tests for storage.js. Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSafeStorage } = require("../storage.js");

// A simple in-memory stand-in for localStorage.
function fakeLocalStorage({ failWrites = false } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWrites && !k.startsWith("__quizClash")) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
    raw: data,
  };
}

test("working storage: saves, reads back and removes values", () => {
  const ls = fakeLocalStorage();
  const s = createSafeStorage(() => ls);
  assert.equal(s.persistent, true);
  assert.equal(s.set("k", { a: [1, 2] }), true);
  assert.deepEqual(s.get("k"), { a: [1, 2] });
  assert.equal(ls.raw.get("k"), '{"a":[1,2]}');
  s.remove("k");
  assert.equal(s.get("k", "fallback"), "fallback");
});

test("blocked storage (even accessing it throws): falls back to memory, never crashes", () => {
  const s = createSafeStorage(() => {
    throw new Error("SecurityError: access denied");
  });
  assert.equal(s.persistent, false);
  assert.equal(s.set("k", 5), false); // not saved permanently...
  assert.equal(s.get("k"), 5); // ...but still usable this session
  s.remove("k");
  assert.equal(s.get("k"), null);
});

test("full storage: write reports failure but the value is kept for this session", () => {
  const ls = fakeLocalStorage({ failWrites: true });
  const s = createSafeStorage(() => ls);
  assert.equal(s.persistent, true);
  assert.doesNotThrow(() => s.set("k", [1]));
  assert.equal(s.set("k", [1, 2]), false);
  assert.deepEqual(s.get("k"), [1, 2]);
});

test("corrupted saved data returns the fallback instead of throwing", () => {
  const ls = fakeLocalStorage();
  ls.setItem("k", "{not json");
  const s = createSafeStorage(() => ls);
  assert.deepEqual(s.get("k", []), []);
});

test("getItem throwing at read time returns the fallback", () => {
  const ls = fakeLocalStorage();
  const s = createSafeStorage(() => ls);
  ls.getItem = () => {
    throw new Error("boom");
  };
  assert.equal(s.get("k", "fallback"), "fallback");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { LoginAttemptLimiter } = require("../login-attempt-limiter");

test("login limiter allows seven initial failures, then locks for three minutes", () => {
  const limiter = new LoginAttemptLimiter();
  const start = 1_000_000;

  for (let attempt = 1; attempt < 7; attempt += 1) {
    assert.equal(limiter.recordFailure("teacher", start + attempt), null);
  }
  assert.equal(limiter.recordFailure("teacher", start + 7), 180_000);
  assert.equal(limiter.getLockoutDuration("teacher", start + 8), 179_999);
  assert.equal(limiter.getLockoutDuration("teacher", start + 180_007), null);
});

test("after the first lockout, two failures trigger a five-minute lockout", () => {
  const limiter = new LoginAttemptLimiter();
  const start = 2_000_000;
  limiter.recordFailure("teacher", start + 1);
  for (let attempt = 2; attempt < 7; attempt += 1) {
    limiter.recordFailure("teacher", start + attempt);
  }
  limiter.recordFailure("teacher", start + 7);

  const afterFirstLockout = start + 180_007;
  assert.equal(limiter.getLockoutDuration("teacher", afterFirstLockout), null);
  assert.equal(limiter.recordFailure("teacher", afterFirstLockout), null);
  assert.equal(limiter.recordFailure("teacher", afterFirstLockout + 1), 300_000);
  assert.equal(limiter.getLockoutDuration("teacher", afterFirstLockout + 2), 299_999);

  const afterSecondLockout = afterFirstLockout + 300_001;
  assert.equal(limiter.getLockoutDuration("teacher", afterSecondLockout), null);
  assert.equal(limiter.recordFailure("teacher", afterSecondLockout), null);
  assert.equal(limiter.recordFailure("teacher", afterSecondLockout + 1), 300_000);
});

test("a successful login clears the escalation stage", () => {
  const limiter = new LoginAttemptLimiter();
  const start = 3_000_000;
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    limiter.recordFailure("teacher", start + attempt);
  }
  limiter.reset("teacher");

  for (let attempt = 1; attempt < 7; attempt += 1) {
    assert.equal(limiter.recordFailure("teacher", start + 200_000 + attempt), null);
  }
  assert.equal(limiter.recordFailure("teacher", start + 200_007), 180_000);
});

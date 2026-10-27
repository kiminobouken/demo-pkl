const initialMaxAttempts = 7;
const repeatMaxAttempts = 2;
const initialLockoutDuration = 3 * 60 * 1000;
const repeatLockoutDuration = 5 * 60 * 1000;

class LoginAttemptLimiter {
  constructor() {
    this.accounts = new Map();
  }

  getLockoutDuration(accountId, now = Date.now()) {
    const account = this.accounts.get(accountId);
    if (!account || account.lockedUntil <= now) return null;
    return account.lockedUntil - now;
  }

  recordFailure(accountId, now = Date.now()) {
    const account = this.accounts.get(accountId) || {
      failedAttempts: 0,
      hasBeenLocked: false,
      lockedUntil: 0,
    };
    account.failedAttempts += 1;
    const attemptLimit = account.hasBeenLocked ? repeatMaxAttempts : initialMaxAttempts;
    if (account.failedAttempts < attemptLimit) {
      this.accounts.set(accountId, account);
      return null;
    }

    const lockoutDuration = account.hasBeenLocked
      ? repeatLockoutDuration
      : initialLockoutDuration;
    account.failedAttempts = 0;
    account.hasBeenLocked = true;
    account.lockedUntil = now + lockoutDuration;
    this.accounts.set(accountId, account);
    return lockoutDuration;
  }

  reset(accountId) {
    this.accounts.delete(accountId);
  }
}

module.exports = { LoginAttemptLimiter };

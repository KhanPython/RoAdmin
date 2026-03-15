// Structured logger - gates output by level (debug suppressed in production)

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveLevel() {
  const explicit = process.env.LOG_LEVEL?.toLowerCase();
  if (explicit && LOG_LEVELS[explicit] !== undefined) return LOG_LEVELS[explicit];
  return process.env.NODE_ENV === "production" ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

const currentLevel = resolveLevel();

function formatArgs(args) {
  return args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
}

module.exports = {
  debug: (...args) => { if (currentLevel <= LOG_LEVELS.debug) console.log(`[DEBUG] ${formatArgs(args)}`); },
  info:  (...args) => { if (currentLevel <= LOG_LEVELS.info)  console.log(`[INFO] ${formatArgs(args)}`); },
  warn:  (...args) => { if (currentLevel <= LOG_LEVELS.warn)  console.error(`[WARN] ${formatArgs(args)}`); },
  error: (...args) => { if (currentLevel <= LOG_LEVELS.error) console.error(`[ERROR] ${formatArgs(args)}`); },
};

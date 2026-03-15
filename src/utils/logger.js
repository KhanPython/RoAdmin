// Structured logger - gates output by level (debug suppressed in production)

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveLevel() {
  const explicit = process.env.LOG_LEVEL?.toLowerCase();
  if (explicit && LOG_LEVELS[explicit] !== undefined) return LOG_LEVELS[explicit];
  return process.env.NODE_ENV === "production" ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

const currentLevel = resolveLevel();

function write(stream, prefix, args) {
  const line = `${prefix} ${args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}\n`;
  stream.write(line);
}

module.exports = {
  debug: (...args) => { if (currentLevel <= LOG_LEVELS.debug) write(process.stdout, "[DEBUG]", args); },
  info:  (...args) => { if (currentLevel <= LOG_LEVELS.info)  write(process.stdout, "[INFO]",  args); },
  warn:  (...args) => { if (currentLevel <= LOG_LEVELS.warn)  write(process.stderr, "[WARN]",  args); },
  error: (...args) => { if (currentLevel <= LOG_LEVELS.error) write(process.stderr, "[ERROR]", args); },
};

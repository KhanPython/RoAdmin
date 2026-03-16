// Encrypted keystore - AES-256-GCM persistence for API keys (memory-only if ENCRYPTION_KEY unset)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const log = require("./logger");

const KEYSTORE_DIR = path.join(__dirname, "..", "..", "data");
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, "keystore.enc");
const KEYSTORE_TMP = path.join(KEYSTORE_DIR, "keystore.enc.tmp");
const KEYSTORE_BAK = path.join(KEYSTORE_DIR, "keystore.enc.bak");
const KEYSTORE_SALT_PATH = path.join(KEYSTORE_DIR, "keystore.salt");

const HKDF_INFO = "voltbot-keystore-v1";
// Legacy static salt used before per-deployment salts were introduced — kept only for migration.
const LEGACY_HKDF_SALT = Buffer.from("voltbot-keystore-salt-v1");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _derivedKey = null;
let _enabled = false;

// Load the per-deployment salt from disk, or generate and persist a fresh one.
function _loadOrCreateSalt() {
  try {
    fs.mkdirSync(KEYSTORE_DIR, { recursive: true });
    if (fs.existsSync(KEYSTORE_SALT_PATH)) {
      const buf = fs.readFileSync(KEYSTORE_SALT_PATH);
      if (buf.length === 32) return { salt: buf, isNew: false };
      log.warn("keystore.salt has unexpected length — regenerating.");
    }
    const salt = crypto.randomBytes(32);
    fs.writeFileSync(KEYSTORE_SALT_PATH, salt, { mode: 0o600 });
    return { salt, isNew: true };
  } catch (err) {
    log.warn("Salt file I/O failed, using ephemeral salt:", err.message);
    return { salt: crypto.randomBytes(32), isNew: true };
  }
}

function _deriveKeyFromSalt(master, salt) {
  return Buffer.from(crypto.hkdfSync("sha256", master, salt, HKDF_INFO, 32));
}

// Derive the data encryption key from the master secret using HKDF (called once).
function deriveKey() {
  if (_derivedKey) return _derivedKey;

  const masterHex = process.env.ENCRYPTION_KEY;
  if (!masterHex || !/^[0-9a-fA-F]{64}$/.test(masterHex)) {
    if (masterHex) log.error("ENCRYPTION_KEY is not a valid 64-character hex string");
    _enabled = false;
    return null;
  }

  const master = Buffer.from(masterHex, "hex");
  const { salt } = _loadOrCreateSalt();
  _derivedKey = _deriveKeyFromSalt(master, salt);
  _enabled = true;
  return _derivedKey;
}

// Encrypt plaintext with AES-256-GCM → [12B IV][16B tag][ciphertext]
function encrypt(plaintext) {
  const key = deriveKey();
  if (!key) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

// Decrypt a buffer using an explicit key (supports both current and legacy keys).
function _decryptWithKey(buffer, key) {
  if (!key) return null;
  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

// Decrypt a buffer produced by encrypt(), or null on failure.
function decrypt(buffer) {
  return _decryptWithKey(buffer, deriveKey());
}

// Load and decrypt the keystore from disk (→ {} on first run / failure).
// On deployments upgrading from the legacy static salt, automatically migrates
// the keystore to the new per-deployment random salt.
function loadKeystore() {
  // Determine whether the salt file already existed before this call.
  const saltExistedBefore = fs.existsSync(KEYSTORE_SALT_PATH);

  deriveKey(); // ensures _enabled and _derivedKey are set

  if (!_enabled) {
    log.info("No ENCRYPTION_KEY configured - running in memory-only mode");
    return {};
  }

  if (!fs.existsSync(KEYSTORE_PATH)) {
    log.info("No existing keystore found - starting fresh");
    return {};
  }

  try {
    const raw = fs.readFileSync(KEYSTORE_PATH);
    let plaintext = decrypt(raw);

    // Migration path: salt file was just created (new random salt) but there is an
    // existing keystore that was encrypted with the legacy static salt.
    if (plaintext === null && !saltExistedBefore) {
      log.info("Attempting keystore migration from legacy static salt...");
      const masterHex = process.env.ENCRYPTION_KEY;
      const master = Buffer.from(masterHex, "hex");
      const legacyKey = _deriveKeyFromSalt(master, LEGACY_HKDF_SALT);
      plaintext = _decryptWithKey(raw, legacyKey);

      if (plaintext !== null) {
        log.info("Migration successful - re-encrypting keystore with per-deployment salt.");
        const data = JSON.parse(plaintext);
        saveKeystore(data); // persists with the new random salt
        const keyCount = data.apiKeys ? Object.keys(data.apiKeys).length : 0;
        log.info(`Loaded ${keyCount} API key(s) from encrypted storage (migrated from legacy salt).`);
        return data;
      }

      log.warn("Legacy salt migration failed - master key may have changed. Backing up and starting fresh.");
    }

    if (plaintext === null) {
      log.warn("Failed to decrypt keystore - master key may have changed. Backing up and starting fresh.");
      try {
        fs.renameSync(KEYSTORE_PATH, KEYSTORE_BAK);
      } catch {
        // Best-effort backup
      }
      return {};
    }

    const data = JSON.parse(plaintext);
    const keyCount = data.apiKeys ? Object.keys(data.apiKeys).length : 0;
    log.info(`Loaded ${keyCount} API key(s) from encrypted storage`);
    return data;
  } catch (err) {
    log.error("Error reading keystore:", err.message);
    return {};
  }
}

// Encrypt and atomically write keystore to disk (write → tmp → rename).
function saveKeystore(data) {
  deriveKey();
  if (!_enabled) return true; // not a failure - persistence just isn't configured

  try {
    fs.mkdirSync(KEYSTORE_DIR, { recursive: true });

    const plaintext = JSON.stringify(data);
    const encrypted = encrypt(plaintext);
    if (!encrypted) return false;

    fs.writeFileSync(KEYSTORE_TMP, encrypted, { mode: 0o600 });
    fs.renameSync(KEYSTORE_TMP, KEYSTORE_PATH);
    return true;
  } catch (err) {
    log.error("Error writing keystore:", err.message);
    return false;
  }
}

function isEnabled() {
  return _enabled;
}

module.exports = {
  loadKeystore,
  saveKeystore,
  isEnabled,
};

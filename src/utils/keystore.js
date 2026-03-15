// Encrypted keystore — AES-256-GCM persistence for API keys (memory-only if ENCRYPTION_KEY unset)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const log = require("./logger");

const KEYSTORE_DIR = path.join(__dirname, "..", "..", "data");
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, "keystore.enc");
const KEYSTORE_TMP = path.join(KEYSTORE_DIR, "keystore.enc.tmp");
const KEYSTORE_BAK = path.join(KEYSTORE_DIR, "keystore.enc.bak");

const HKDF_INFO = "voltbot-keystore-v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _derivedKey = null;
let _enabled = false;

// Derive the data encryption key from the master secret using HKDF (called once)
function deriveKey() {
  if (_derivedKey) return _derivedKey;

  const masterHex = process.env.ENCRYPTION_KEY;
  if (!masterHex || !/^[0-9a-fA-F]{64}$/.test(masterHex)) {
    if (masterHex) log.error("ENCRYPTION_KEY is not a valid 64-character hex string");
    _enabled = false;
    return null;
  }

  const master = Buffer.from(masterHex, "hex");
  _derivedKey = Buffer.from(
    crypto.hkdfSync("sha256", master, Buffer.alloc(0), HKDF_INFO, 32)
  );
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

// Decrypt a buffer produced by encrypt(), or null on failure
function decrypt(buffer) {
  const key = deriveKey();
  if (!key) return null;

  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    return null;
  }

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

// Load and decrypt the keystore from disk (→ {} on first run / failure)
function loadKeystore() {
  deriveKey();

  if (!_enabled) {
    log.info("No ENCRYPTION_KEY configured — running in memory-only mode");
    return {};
  }

  if (!fs.existsSync(KEYSTORE_PATH)) {
    log.info("No existing keystore found — starting fresh");
    return {};
  }

  try {
    const raw = fs.readFileSync(KEYSTORE_PATH);
    const plaintext = decrypt(raw);

    if (plaintext === null) {
      log.warn("Failed to decrypt keystore — master key may have changed. Backing up and starting fresh.");
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

// Encrypt and atomically write keystore to disk (write → tmp → rename)
function saveKeystore(data) {
  deriveKey();
  if (!_enabled) return true; // not a failure — persistence just isn't configured

  try {
    fs.mkdirSync(KEYSTORE_DIR, { recursive: true });

    const plaintext = JSON.stringify(data);
    const encrypted = encrypt(plaintext);
    if (!encrypted) return false;

    fs.writeFileSync(KEYSTORE_TMP, encrypted);
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

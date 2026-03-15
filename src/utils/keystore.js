/**
 * Encrypted Keystore
 * Handles AES-256-GCM encryption/decryption and atomic file I/O
 * for persisting API keys across bot restarts.
 *
 * If ENCRYPTION_KEY is not set, operates in memory-only mode (no persistence).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEYSTORE_DIR = path.join(__dirname, "..", "..", "data");
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, "keystore.enc");
const KEYSTORE_TMP = path.join(KEYSTORE_DIR, "keystore.enc.tmp");
const KEYSTORE_BAK = path.join(KEYSTORE_DIR, "keystore.enc.bak");

const HKDF_INFO = "voltbot-keystore-v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _derivedKey = null;
let _enabled = false;

/**
 * Derive the data encryption key from the master secret using HKDF.
 * Called once on first use.
 */
function deriveKey() {
  if (_derivedKey) return _derivedKey;

  const masterHex = process.env.ENCRYPTION_KEY;
  if (!masterHex || masterHex.length !== 64) {
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

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a Buffer: [12B IV][16B auth tag][ciphertext]
 */
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

/**
 * Decrypt a buffer produced by encrypt().
 * Returns the plaintext string, or null on failure.
 */
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

/**
 * Load and decrypt the keystore from disk.
 * Returns the parsed object, or {} on first run / failure.
 */
function loadKeystore() {
  deriveKey();

  if (!_enabled) {
    console.log(
      "[KEYSTORE] No ENCRYPTION_KEY configured — running in memory-only mode"
    );
    return {};
  }

  if (!fs.existsSync(KEYSTORE_PATH)) {
    console.log("[KEYSTORE] No existing keystore found — starting fresh");
    return {};
  }

  try {
    const raw = fs.readFileSync(KEYSTORE_PATH);
    const plaintext = decrypt(raw);

    if (plaintext === null) {
      console.warn(
        "[KEYSTORE] Failed to decrypt keystore — master key may have changed. Backing up and starting fresh."
      );
      try {
        fs.renameSync(KEYSTORE_PATH, KEYSTORE_BAK);
      } catch {
        // Best-effort backup
      }
      return {};
    }

    const data = JSON.parse(plaintext);
    const keyCount = data.apiKeys ? Object.keys(data.apiKeys).length : 0;
    console.log(
      `[KEYSTORE] Loaded ${keyCount} API key(s) from encrypted storage`
    );
    return data;
  } catch (err) {
    console.error("[KEYSTORE] Error reading keystore:", err.message);
    return {};
  }
}

/**
 * Encrypt and atomically write the keystore to disk.
 * Writes to a .tmp file first, then renames for crash safety.
 * @returns {boolean} true if saved successfully (or persistence is disabled), false on write failure
 */
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
    console.error("[KEYSTORE] Error writing keystore:", err.message);
    return false;
  }
}

/**
 * Whether encrypted persistence is active.
 */
function isEnabled() {
  return _enabled;
}

module.exports = {
  loadKeystore,
  saveKeystore,
  isEnabled,
};

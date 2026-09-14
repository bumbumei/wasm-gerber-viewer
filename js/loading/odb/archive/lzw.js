// Decoder for the UNIX `compress` format (LZW, magic 1F 9D), which ODB++ jobs
// use for `features.Z` and similar files. The layout follows ncompress and
// gzip's unlzw.c: codes are packed LSB-first, start 9 bits wide, grow up to
// `maxBits`, and the reader must realign to the next multiple of
// `width * 8` bits whenever the width changes or a CLEAR code is seen, because
// the encoder flushes whole groups of eight codes.

const LZW_MAGIC_0 = 0x1f;
const LZW_MAGIC_1 = 0x9d;
const INIT_BITS = 9;
const BLOCK_MODE_FLAG = 0x80;
const MAX_BITS_MASK = 0x1f;
const CLEAR_CODE = 256;

export function isLzwBytes(bytes) {
  return (
    Boolean(bytes) &&
    bytes.length >= 3 &&
    bytes[0] === LZW_MAGIC_0 &&
    bytes[1] === LZW_MAGIC_1
  );
}

export function decompressLzw(
  bytes,
  { maxOutputBytes = Number.POSITIVE_INFINITY, label = ".Z data" } = {},
) {
  if (!isLzwBytes(bytes)) {
    throw new Error(`${label} is not in UNIX compress (.Z) format`);
  }

  const flags = bytes[2];
  const maxBits = flags & MAX_BITS_MASK;
  const blockMode = (flags & BLOCK_MODE_FLAG) !== 0;
  if (maxBits < INIT_BITS || maxBits > 16) {
    throw new Error(`${label} declares an unsupported LZW code width (${maxBits})`);
  }

  const maxMaxCode = 1 << maxBits;
  const prefix = new Uint16Array(maxMaxCode);
  const suffix = new Uint8Array(maxMaxCode);
  for (let code = 0; code < 256; code++) {
    suffix[code] = code;
  }

  const firstFree = blockMode ? CLEAR_CODE + 1 : CLEAR_CODE;
  let freeEntry = firstFree;
  let width = INIT_BITS;
  let maxCode = (1 << width) - 1;
  let bitMask = maxCode;
  let bitPos = 3 * 8;
  // Code groups are aligned relative to the last realignment point (initially
  // the end of the header), exactly like ncompress's `boff`/`resetbuf`.
  let groupStart = bitPos;
  const totalBits = bytes.length * 8;

  let output = new Uint8Array(Math.min(Math.max(bytes.length * 4, 4096), 1 << 20));
  let outLength = 0;
  const stack = new Uint8Array(maxMaxCode + 1);

  let oldCode = -1;
  let finalChar = 0;

  const ensureCapacity = (extra) => {
    if (outLength + extra <= output.length) return;
    if (outLength + extra > maxOutputBytes) {
      throw new RangeError(`${label} expands beyond the ${maxOutputBytes}-byte limit`);
    }
    // Double the buffer (capped at the output limit) so growth stays amortised
    // O(n); growing to the exact size would copy the whole output per chunk.
    let next = output.length * 2;
    while (next < outLength + extra) next *= 2;
    if (Number.isFinite(maxOutputBytes)) next = Math.min(next, maxOutputBytes);
    const grown = new Uint8Array(next);
    grown.set(output.subarray(0, outLength));
    output = grown;
  };

  const realign = () => {
    const group = width * 8;
    const relative = bitPos - groupStart;
    bitPos = groupStart + Math.ceil(relative / group) * group;
    groupStart = bitPos;
  };

  while (bitPos + width <= totalBits) {
    if (freeEntry > maxCode) {
      realign();
      width += 1;
      maxCode = width === maxBits ? maxMaxCode : (1 << width) - 1;
      bitMask = (1 << width) - 1;
      continue;
    }

    const byteIndex = bitPos >>> 3;
    const word =
      bytes[byteIndex] |
      ((bytes[byteIndex + 1] ?? 0) << 8) |
      ((bytes[byteIndex + 2] ?? 0) << 16);
    let code = (word >>> (bitPos & 7)) & bitMask;
    bitPos += width;

    if (oldCode === -1) {
      if (code >= 256) {
        throw new Error(`${label} is corrupt (first LZW code is not a literal)`);
      }
      oldCode = code;
      finalChar = code;
      ensureCapacity(1);
      output[outLength++] = code;
      continue;
    }

    if (code === CLEAR_CODE && blockMode) {
      // Like ncompress: the table restarts one below the first free code and
      // the previous code is kept, so the next literal defines a throwaway
      // entry at 256 and the table grows in lockstep with the encoder.
      realign();
      freeEntry = firstFree - 1;
      width = INIT_BITS;
      maxCode = (1 << width) - 1;
      bitMask = maxCode;
      continue;
    }

    const inCode = code;
    let stackTop = 0;

    if (code >= freeEntry) {
      if (code > freeEntry) {
        throw new Error(`${label} is corrupt (LZW code ${code} is not yet defined)`);
      }
      // KwKwK: the code being defined right now.
      stack[stackTop++] = finalChar;
      code = oldCode;
    }

    while (code >= 256) {
      stack[stackTop++] = suffix[code];
      code = prefix[code];
    }
    finalChar = suffix[code];
    stack[stackTop++] = finalChar;

    ensureCapacity(stackTop);
    while (stackTop > 0) {
      output[outLength++] = stack[--stackTop];
    }

    if (freeEntry < maxMaxCode) {
      prefix[freeEntry] = oldCode;
      suffix[freeEntry] = finalChar;
      freeEntry += 1;
    }
    oldCode = inCode;
  }

  return output.subarray(0, outLength);
}

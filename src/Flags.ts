// Utility functions to help bit bitfield flags

export function setFlag(bitfield: number, mask: number, value: boolean = true) {
  bitfield = value ? (bitfield | mask) : (bitfield & ~mask);
  return bitfield;
}


export function setFlags(bitfield: number, mask: number) {
  bitfield |= mask;
  return bitfield;
}

export function clearFlags(bitfield: number, mask: number) {
  bitfield &= ~mask;
  return bitfield;
}

export function toggleFlags(bitfield: number, mask: number) {
  bitfield ^= mask;
  return bitfield;
}

export function setField(bitfield: number, mask: number, value: number) {
  const offset = bitScan(mask);
  bitfield &= ~mask;
  bitfield |= mask & (value << offset);
  return bitfield;
}

/**
 * Return the index of the first set bit. If no bit is set, 32 is returned.
 */
export function bitScan(bitfield: number) {
  return kMod37BitPosition[(-bitfield & bitfield) % 37];
}

// Map a bit value mod 37 to its position
const kMod37BitPosition = [
  32, 0, 1, 26, 2, 23, 27, 0, 3, 16, 24, 30, 28, 11, 0, 13, 4,
  7, 17, 0, 25, 22, 31, 15, 29, 10, 12, 6, 0, 21, 14, 9, 5,
  20, 8, 19, 18
];
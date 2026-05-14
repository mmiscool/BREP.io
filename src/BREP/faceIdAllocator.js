let nextFaceID = 1;

export function reserveFaceIDs(count = 1) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const start = nextFaceID;
  nextFaceID += n;
  return start;
}

export function reserveFaceID() {
  return reserveFaceIDs(1);
}

export function noteFaceID(id) {
  const value = Number(id);
  if (Number.isFinite(value) && value >= nextFaceID) {
    nextFaceID = Math.floor(value) + 1;
  }
}

// Fails on the first evaluation in a realm only: does a retry of the same URL evaluate again?
if (!globalThis.__onceTried) {
  globalThis.__onceTried = true;
  throw new Error('first evaluation fails');
}
export async function start() {
  return { second: true };
}

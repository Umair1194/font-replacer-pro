/** Host promises cannot be aborted. This bounds our wait and discards late results. */
export class Cancelled extends Error { constructor() { super('Operation cancelled'); } }
export interface Token { cancelled: boolean }
export async function bounded<T>(promise: Promise<T>, token: Token, timeoutMs: number, label: string): Promise<T> {
  if (token.cancelled) { void promise.catch(() => {}); throw new Cancelled(); }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out. Retry after checking Figma and font availability.`)), timeoutMs);
      const check = () => { if (token.cancelled) reject(new Cancelled()); else poll = setTimeout(check, 25); };
      check();
    })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (poll !== undefined) clearTimeout(poll);
  }
}
export const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

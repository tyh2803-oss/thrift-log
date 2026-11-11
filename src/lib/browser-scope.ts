/** Private drafts are tab-local, account-scoped, and cleared on explicit sign-in/out. */
export const browserScope = (demo: boolean, userId?: string) =>
  demo ? 'demo' : `private.${userId || 'unavailable'}`;
export function clearPrivateBrowserState(storage?: Storage) {
  try {
    const target = storage || sessionStorage;
    for (const key of Object.keys(target)) {
      const demo =
        key === 'thrift-log.draft.assistant.demo' ||
        key === 'thrift-log.draft.pipeline-metric.demo' ||
        key.startsWith('thrift-log.draft.demo.');
      if (
        (key.startsWith('thrift-log.draft.') && !demo) ||
        key.startsWith('thrift-log.marketplace.private')
      )
        target.removeItem(key);
    }
  } catch {
    /* Private records never depend on browser draft storage. */
  }
}

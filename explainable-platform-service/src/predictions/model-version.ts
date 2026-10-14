/**
 * A Prediction is pinned to the model version in Production when it was
 * submitted. These two helpers are the whole of how a job uses the pin: ask for
 * that version, then check the answer came from it.
 */

/**
 * The query string that pins an inference call to `version`.
 *
 * Empty for a Prediction made before versions were pinned, so it keeps
 * following Production exactly as it always did.
 */
export function pinnedVersionQuery(version?: string | null): string {
  return version ? `?version=${encodeURIComponent(version)}` : '';
}

/**
 * Why an answer cannot be accepted for a Prediction pinned to `pinned`, or null
 * when it can. An unpinned Prediction accepts whatever version answered.
 *
 * It should never fire, since the version is sent with every call; it is what
 * catches an inference service that ignored it.
 */
export function versionMismatch(
  pinned: string | null | undefined,
  answered: string | null | undefined,
  what: string,
): string | null {
  if (!pinned || answered === pinned) return null;
  return (
    `${what} came from model version ${answered ?? 'unknown'}, but this ` +
    `prediction is pinned to version ${pinned}. The inference service did not ` +
    `honour the pinned version.`
  );
}

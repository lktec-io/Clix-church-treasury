/**
 * Runs `job` after the current request has finished, fully isolated from it.
 *
 * - Deferred with setImmediate, so it starts only after the caller has
 *   returned (and, in a controller, after the response is on its way). No
 *   outcome of the job can change that response.
 * - Every failure — a thrown error or a rejected promise — is caught and
 *   logged under `label`. Nothing escapes as an unhandled rejection, which in
 *   Node would otherwise crash the worker and take every other request on it
 *   down too.
 *
 * Returns nothing on purpose: a caller that needs the job's result should not
 * be running it in the background.
 */
export function runInBackground(label, job) {
  setImmediate(() => {
    Promise.resolve()
      .then(job)
      .catch((error) => {
        console.error(`[background] ${label} failed: ${error?.message ?? error}`);
      });
  });
}

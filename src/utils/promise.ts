/**
 * @see https://advancedweb.hu/how-to-add-timeout-to-a-promise-in-javascript
 *
 * @param prom
 * @param time
 * @param exception
 */

import { PromiseTimeoutError } from "../errors/index.js";

export const timeout = <T>(prom: Promise<T>, time: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    prom,
    new Promise<never>(
      (_r, rej) => (timer = setTimeout(rej, time, new PromiseTimeoutError('Timeout before promise can resolve', time)))
    ),
  ]).finally(() => clearTimeout(timer));
};

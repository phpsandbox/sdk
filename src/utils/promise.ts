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

/**
 * Wraps an async function to ensure it only executes once. 
 * Subsequent calls return the memoized promise result.
 * 
 * @param fn The async function to execute once
 * @returns A wrapped function that memoizes the first execution
 */
export const once = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
  let result: Promise<T> | null = null;
  return () => result || (result = fn());
};

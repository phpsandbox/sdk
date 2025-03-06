/**
 * @see https://advancedweb.hu/how-to-add-timeout-to-a-promise-in-javascript
 *
 * @param prom
 * @param time
 * @param exception
 */

export class PromiseTimeoutError extends Error {
	public constructor(message: string, public time: number) {
		super(message);
	}
}

export const timeout = (prom: Promise<any>, time: number) => {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		prom,
		new Promise(
			(_r, rej) =>
				(timer = setTimeout(rej, time, new PromiseTimeoutError("Timeout before promise can resolve", time)))
		),
	]).finally(() => clearTimeout(timer));
};

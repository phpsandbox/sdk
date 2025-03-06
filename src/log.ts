import Okra, {Action} from "./";

export interface LogEvents {
	"notebook.log": string;
}

export interface LogActions {}

export default class Log {
	constructor(protected okra: Okra) {}

	public stream(fn: (data: string) => void) {
		return this.okra.listen("notebook.log", fn);
	}
	public listen<T extends keyof LogEvents>(event: T, handler: (data: LogEvents[T]) => void): void {
		this.okra.listen(event, handler);
	}
}

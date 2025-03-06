import Okra, {Action} from "./";

export interface TerminalEvents {
	"terminal.output": {
		output: string;
	};
}

export interface TerminalActions {
	"terminal.input": Action<{input: string}>;
	"terminal.start": Action;
}

export default class Composer {
	constructor(protected okra: Okra) {}

	public start() {
		return this.okra.invoke("terminal.start");
	}

	public input(input: string) {
		return this.okra.invoke("terminal.input", {input});
	}

	public listen<T extends keyof TerminalEvents>(event: T, handler: (data: TerminalEvents[T]) => void): void {
		this.okra.listen(event, handler);
	}
}

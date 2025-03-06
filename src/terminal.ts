import Okra, {Action} from "./";

export interface Task {
	id: string;
	command: string;
	kind: string;
	created: boolean;
}

export interface TerminalCreateInput {
	id: string;
	kind: string;
	size: [number, number];
}

export interface TerminalEvents {
	"terminal.output": {
		output: string;
	};
	"terminal.started": Task;
}

export interface TerminalActions {
	"terminal.input": Action<{id: string; input: string}>;
	"terminal.list": Action<{}, Task[]>;
	"terminal.start": Action;
	"terminal.create": Action<TerminalCreateInput, Task>;
	"terminal.resize": Action<{id: string; width: number; height: number}, boolean>;
}

export default class Terminal {
	constructor(protected okra: Okra) {}

	public list() {
		return this.okra.invoke("terminal.list");
	}

	public start() {
		return this.okra.invoke("terminal.start");
	}

	public create(input: TerminalCreateInput) {
		return this.okra.invoke("terminal.create", input);
	}

	public onStarted(handler: (t: Task) => void): void {
		this.okra.listen("terminal.started", handler);
	}

	public resize(id: string, size: [number, number]) {
		return this.okra.invoke("terminal.resize", {id, width: size[0], height: size[1]});
	}

	public onOutput(handler: (data: TerminalEvents["terminal.output"]) => void): void {
		this.okra.listen("terminal.output", handler);
	}

	public input(id: string, input: string) {
		return this.okra.invoke("terminal.input", {id, input});
	}

	public listen<T extends keyof TerminalEvents>(event: T, handler: (data: TerminalEvents[T]) => void): void {
		this.okra.listen(event, handler);
	}
}

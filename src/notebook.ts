import Okra, {Action} from "./";

interface Result<T extends object> {
	type: "success" | "error" | "running";
	message: string;
	data: T;
}

export interface NotebookActions {
	"notebook.init": Action<
		{force?: boolean; files: {[path: string]: string}},
		Result<{env: {name: string; value: string}[]; previewUrl: string}>
	>;
	"notebook.update": Action<null>;
}

export interface NotebookEvents {
	"lsp.response": object;
	"lsp.close": {code: number; reason: string};
	"init.event": {message: string};
	"notebook.initialized": null;
}

export default class Notebook {
	constructor(protected okra: Okra) {}

	public async init(files: {[path: string]: string} = {}) {
		const result = await this.okra.invoke("notebook.init", {files});
		this.okra.onDidConnect(this.init.bind(this));

		return result;
	}

	public update() {
		return this.okra.invoke("notebook.update");
	}

	public listen<T extends keyof NotebookEvents>(event: T, handler: (data: NotebookEvents[T]) => void): void {
		this.okra.listen(event, handler);
	}

	public onDidInitialize(handler: () => void) {
		this.okra.listen("notebook.initialized", handler);
	}
}

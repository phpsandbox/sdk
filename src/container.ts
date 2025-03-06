import Okra, {Action} from "./";

interface Stat {
	usage: number;
	limit: number;
}

export interface ContainerStats {
	cpu: Stat;
	memory: Stat;
	disk: Stat;
}

export enum NotebookState {
	RUNNING = "running",
	STOPPED = "stopped",
	STARTING = "starting",
	STOPPING = "stopping",
	KILLED = "killed",
	ERROR = "error",
	PROVISIONING = "provisioning",
}

export interface ContainerEvents {
	"container.stats": ContainerStats;
}

export interface PortInfo {
	subdomain: string;
	url: string;
	default: boolean;
	port: number | null;
}

export interface ContainerActions {
	"container.start": Action;
	"container.state": Action<{}, {state: NotebookState}>;
	"container.opened-ports": Action<{}, PortInfo[]>;
	"container.set-php": Action<{version: string}, {version: string}>;
}

export default class Container {
	constructor(protected okra: Okra) {}

	public start() {
		return this.okra.invoke("container.start");
	}

	public state() {
		return this.okra.invoke("container.state");
	}

	public openedPorts() {
		return this.okra.invoke("container.opened-ports");
	}

	public setPhp(version: string) {
		return this.okra.invoke("container.set-php", {version});
	}

	public listen<T extends keyof ContainerEvents>(event: T, handler: (data: ContainerEvents[T]) => void): void {
		this.okra.listen(event, handler);
	}
}

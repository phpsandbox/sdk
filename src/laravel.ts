import {Action, NotebookInstance} from "./index.js";

export interface Down {
	except: string[];
	redirect: string | null;
	retry: string | null;
	refresh: string | null;
	secret: string | null;
	status: number;
	template: string | null;
}

export interface LaravelEvents {}
export interface LaravelActions {
	"laravel.maintenance.info": Action<{}, Down>;
	"laravel.maintenance.toggle": Action<Down | {}, Down>;
}

export default class Lravel {
	constructor(protected okra: NotebookInstance) {}

	public maintenanceInfo() {
		return this.okra.invoke("laravel.maintenance.info", {});
	}

	public toggleMaintenance(down: Down | {}) {
		return this.okra.invoke("laravel.maintenance.toggle", down);
	}
}

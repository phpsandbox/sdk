import {Action, NotebookInstance} from "./";

export interface AuthActions {
	"auth.login": Action<{newConnectionData: string}, boolean>;
	"auth.logout": Action<null>;
}

export default class Auth {
	constructor(protected okra: NotebookInstance) {}

	public logout() {
		return this.okra.invoke("auth.logout");
	}

	public login(newConnectionData: string) {
		return this.okra.invoke("auth.login", {newConnectionData});
	}
}

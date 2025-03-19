import {Action, NotebookInstance} from "./";

export interface ComposerEvents {
	"composer.log": string;
}

export interface Result {
	exitCode: number;
	output: string;
}

export interface ComposerPackage {
	name: string;
	_installedVersion: string;
	installationMode: "require" | "require-dev";
	_installed: boolean;
}

export interface ComposerActions {
	"composer.invoke": Action<{command: ComposerCommand; args: Argument; options: Options}, Result>;
	"composer.dump-autoload": Action<undefined, {message: string; success: boolean}>;
	"composer.packages": Action<undefined, ComposerPackage[]>;
}

export type ComposerCommand = "install" | "update" | "require" | "remove" | "search" | "show";

export type Argument<Name extends string = string, Type extends string | string[] = string | string[]> = Record<
	Name,
	Type
>;

export type Options<
	Name extends string = string,
	Type extends string | string[] | boolean = string | string[] | boolean,
> = Record<Name, Type>;

export default class Composer {
	constructor(protected okra: NotebookInstance) {}

	public invoke(command: ComposerCommand, args: Argument = {}, options: Options = {}) {
		return this.okra.invoke("composer.invoke", {command, args, options});
	}

	public dumpAutoload() {
		return this.okra.invoke("composer.dump-autoload");
	}

	public install(options: Options = {}): Promise<Result> {
		return this.invoke("install", {}, options);
	}

	public update(args: Argument<"packages">, options: Options = {}): Promise<Result> {
		return this.invoke("update", args, options);
	}

	public require(packages: Argument<"packages">, options: Options = {}): Promise<Result> {
		return this.invoke("require", packages, options);
	}

	public remove(args: Argument<"packages">, options: Options = {}): Promise<Result> {
		return this.invoke("remove", args, options);
	}

	public stream(fn: (data: string) => void) {
		return this.okra.listen("composer.log", fn);
	}

	public packages() {
		return this.okra.invoke("composer.packages");
	}
}

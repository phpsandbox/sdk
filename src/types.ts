export class ErrorEvent {
	public constructor(
		public readonly code: number,
		public readonly message: string,
		public readonly raw: object = {}
	) {}
}

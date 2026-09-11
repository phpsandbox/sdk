import { Action, NotebookInstance } from './index.js';

export interface AuthActions {
  'auth.login': Action<{ runtimeTicket: string }, boolean>;
}

export default class Auth {
  constructor(protected okra: NotebookInstance) {}

  public login(runtimeUrl: string) {
    const runtimeTicket = new URL(runtimeUrl).searchParams.get('ticket');
    if (runtimeTicket === null || runtimeTicket === '') {
      throw new TypeError('The notebook connection does not contain a runtime ticket.');
    }

    return this.okra.invoke('auth.login', { runtimeTicket });
  }
}

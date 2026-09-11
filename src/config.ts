import { Action, NotebookInstance } from './index.js';

export interface ConfigPortMapping {
  localPort: number;
  externalPort?: number;
  primary?: boolean;
  exposeLocalhost?: boolean;
}

export interface ProjectConfig {
  ports?: ConfigPortMapping[];
  [key: string]: unknown;
}

export interface ConfigActions {
  'config.get': Action<{}, ProjectConfig>;
  'config.update': Action<{ config: ProjectConfig }, ProjectConfig>;
  'config.set-ports': Action<{ ports: ConfigPortMapping[] }, ProjectConfig>;
}

export default class Config {
  constructor(protected okra: NotebookInstance) {}

  public get() {
    return this.okra.invoke('config.get');
  }

  public update(config: ProjectConfig) {
    return this.okra.invoke('config.update', { config });
  }

  public setPorts(ports: ConfigPortMapping[]) {
    return this.okra.invoke('config.set-ports', { ports });
  }
}

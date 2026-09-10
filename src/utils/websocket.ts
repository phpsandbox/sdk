const getReadyStateLabel = (state: unknown): string | undefined => {
  if (typeof state !== 'number') {
    return undefined;
  }

  return {
    0: 'CONNECTING',
    1: 'OPEN',
    2: 'CLOSING',
    3: 'CLOSED',
  }[state] ?? `STATE_${state}`;
};

const sanitizeWebSocketUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
};

const extractNestedErrorMessage = (value: unknown): string | undefined => {
  if (value instanceof Error) {
    return value.message ? `${value.name}: ${value.message}` : value.name;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === 'string' && record.message
      ? record.message
      : typeof record.reason === 'string' && record.reason
        ? record.reason
        : undefined;

  if (!message) {
    return undefined;
  }

  const name = typeof record.name === 'string' && record.name ? record.name : undefined;
  return name ? `${name}: ${message}` : message;
};

export const describeWebSocketEvent = (event: unknown): string => {
  if (event instanceof Error) {
    return event.message ? `${event.name}: ${event.message}` : event.name;
  }

  if (typeof event === 'string') {
    return event;
  }

  if (!event || typeof event !== 'object') {
    return String(event);
  }

  const record = event as Record<string, unknown>;
  const parts: string[] = [];

  const topLevelMessage = extractNestedErrorMessage(record);
  if (topLevelMessage) {
    parts.push(topLevelMessage);
  }

  const nestedErrorMessage = extractNestedErrorMessage(record.error);
  if (nestedErrorMessage && nestedErrorMessage !== topLevelMessage) {
    parts.push(`error=${nestedErrorMessage}`);
  }

  if (typeof record.type === 'string' && record.type) {
    parts.push(`type=${record.type}`);
  }

  if (typeof record.code === 'number') {
    parts.push(`code=${record.code}`);
  }

  if (typeof record.reason === 'string' && record.reason && record.reason !== topLevelMessage) {
    parts.push(`reason=${record.reason}`);
  }

  if (typeof record.wasClean === 'boolean') {
    parts.push(`wasClean=${record.wasClean}`);
  }

  const target = (record.target ?? record.currentTarget) as Record<string, unknown> | undefined;
  if (target && typeof target === 'object') {
    if (typeof target.url === 'string' && target.url) {
      parts.push(`url=${sanitizeWebSocketUrl(target.url)}`);
    }

    const readyState = getReadyStateLabel(target.readyState);
    if (readyState) {
      parts.push(`readyState=${readyState}`);
    }
  }

  return parts.length > 0 ? parts.join(' | ') : 'Unknown websocket event';
};

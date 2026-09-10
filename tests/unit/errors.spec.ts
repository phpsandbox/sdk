import { describe, expect, it } from 'vitest';
import {
  PHPSandboxError,
  RemoteError,
  TransportError,
  remoteError,
} from '../../src/errors/index.js';

describe('SDK errors', () => {
  it('narrows canonical validation errors with structured details', () => {
    const error = remoteError('core', {
      status: 422,
      code: 'ValidationFailed',
      message: 'The input is invalid.',
      details: { errors: { provider: ['The provider field is required.'] } },
    });

    expect(error).toBeInstanceOf(PHPSandboxError);
    expect(RemoteError.isValidation(error)).toBe(true);
    if (RemoteError.isValidation(error)) {
      expect(error.details.errors.provider).toEqual(['The provider field is required.']);
    }
  });

  it('supports static and instance code guards', () => {
    const error = remoteError('runtime', {
      status: 404,
      code: 'FileNotFound',
      message: 'Missing file.',
    });

    expect(RemoteError.is(error, 'FileNotFound')).toBe(true);
    expect(error.is('FileNotFound')).toBe(true);
    expect(error.source).toBe('runtime');
  });

  it('rejects non-canonical error responses', () => {
    expect(() => remoteError('core', {
      message: 'The input is invalid.',
      errors: { name: ['The name field is required.'] },
    })).toThrow(expect.objectContaining({
      name: 'TransportError',
      code: 'InvalidResponse',
    }));
  });

  it('rejects unsupported error codes', () => {
    expect(() => remoteError('runtime', {
      status: 500,
      code: 'SomethingUnexpected',
      message: 'Unexpected failure.',
    })).toThrow(expect.objectContaining({
      name: 'TransportError',
      code: 'InvalidResponse',
    }));
  });

  it('preserves transport causes without exposing wire payloads', () => {
    const cause = new Error('socket closed');
    const error = new TransportError('Unable to reach the runtime.', 'ConnectionFailed', cause);

    expect(TransportError.is(error, 'ConnectionFailed')).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

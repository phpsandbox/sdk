import { access } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { capabilities, capabilityIds } from '../support/capabilities.js';
import {
  beaconRuntimeExports,
  clientSurface,
  filesystemSurface,
  notebookApiSurface,
  notebookSurface,
  publicationSurface,
  runtimeFacadeSurfaces,
  sdkRuntimeExports,
} from '../support/public-surface.js';

describe('production smoke capability catalogue', () => {
  test('catalogues every declared capability exactly once', () => {
    expect(Object.keys(capabilities).sort()).toEqual([...capabilityIds].sort());
  });

  test('points every executable capability at existing specs', async () => {
    const executable = Object.values(capabilities).filter((capability) => (
      capability.status === 'covered' || capability.status === 'known-broken'
    ));

    await Promise.all(executable.flatMap((capability) => (
      capability.specs.map((spec) => access(spec))
    )));
  });

  test('keeps all tracked runtime exports and public members mapped to capabilities', () => {
    const tracked = [
      ...Object.values(sdkRuntimeExports),
      ...Object.values(beaconRuntimeExports),
      ...Object.values(clientSurface),
      ...Object.values(notebookApiSurface),
      ...Object.values(notebookSurface),
      ...Object.values(publicationSurface),
      ...Object.values(filesystemSurface),
      ...Object.values(runtimeFacadeSurfaces).flatMap((surface) => Object.values(surface)),
    ];

    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every((capability) => capability in capabilities)).toBe(true);
  });

  test('reports progress toward complete automatable production coverage', () => {
    const automatable = Object.values(capabilities).filter((capability) => capability.status !== 'external');
    const covered = automatable.filter((capability) => capability.status === 'covered');
    const percentage = Math.round((covered.length / automatable.length) * 100);

    console.log(`Production capability coverage: ${covered.length}/${automatable.length} (${percentage}%).`);
    expect(covered.length).toBeGreaterThan(0);
  });

  test('reports known production defects separately from coverage', () => {
    const knownBroken = Object.entries(capabilities).filter(([, capability]) => capability.status === 'known-broken');

    console.log(`Known production defects: ${knownBroken.map(([id]) => id).join(', ') || 'none'}.`);
    expect(Object.values(capabilities).every((capability) => (
      capability.status !== 'known-broken' || capability.reason.length > 0
    ))).toBe(true);
  });
});

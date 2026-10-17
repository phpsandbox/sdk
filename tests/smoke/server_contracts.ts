import type { ServerInstance, ServerInvitationData, ServerMemberData, ShareServerInput } from '../../dist/index.js';

export async function serverShareContracts(server: ServerInstance, target: ShareServerInput) {
  const invitation: ServerInvitationData = await server.share({ email: 'person@example.com' });
  const recipientOrganizationId: string | null = invitation.recipientOrganizationId;
  const member: ServerMemberData = await server.share({ organizationId: 'workspace-id' });
  const result: ServerInvitationData | ServerMemberData = await server.share(target);

  // @ts-expect-error Sharing must select exactly one recipient kind.
  await server.share({ email: 'person@example.com', organizationId: 'workspace-id' });
  // @ts-expect-error Sharing requires an explicit recipient target.
  await server.share('person@example.com');
  // @ts-expect-error A recipient is required.
  await server.share({});

  return { invitation, recipientOrganizationId, member, result };
}

export type MemberStatus = 'PENDING' | 'APPROVED';

export interface Member {
  id: string;
  status: MemberStatus;
  isServiceAdmin: boolean;
}

export type AuthAction =
  | 'READ_OWN_STATUS'
  | 'LOGOUT'
  | 'LINK_PROVIDER'
  | 'CREATE_PROJECT'
  | 'READ_PROJECT'
  | 'LIST_PENDING_USERS'
  | 'APPROVE_USER'
  | 'GRANT_ADMIN';

export type ProviderLinkDecision =
  | { kind: 'CREATE' }
  | { kind: 'ALREADY_LINKED' }
  | { kind: 'CONFLICT' };

export function canPerform(
  member: Member | null,
  action: AuthAction | string,
  projectAssigned: boolean,
): boolean {
  if (!member?.id || (member.status !== 'PENDING' && member.status !== 'APPROVED')) {
    return false;
  }

  switch (action) {
    case 'READ_OWN_STATUS':
    case 'LOGOUT':
    case 'LINK_PROVIDER':
      return true;
    case 'CREATE_PROJECT':
      return member.status === 'APPROVED';
    case 'READ_PROJECT':
      return member.status === 'APPROVED' && projectAssigned;
    case 'LIST_PENDING_USERS':
    case 'APPROVE_USER':
    case 'GRANT_ADMIN':
      return member.status === 'APPROVED' && member.isServiceAdmin === true;
    default:
      return false;
  }
}

export function decideProviderLink(
  memberId: string,
  currentOwnerId: string | null,
): ProviderLinkDecision {
  if (!memberId) {
    return { kind: 'CONFLICT' };
  }
  if (currentOwnerId === null) {
    return { kind: 'CREATE' };
  }
  return currentOwnerId === memberId
    ? { kind: 'ALREADY_LINKED' }
    : { kind: 'CONFLICT' };
}

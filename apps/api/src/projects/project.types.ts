export type ProjectRole = 'MANAGER' | 'MEMBER';

export type ProjectView = {
  id: string;
  name: string;
  description: string | null;
  role: ProjectRole;
  createdAt: Date;
};

export type MemberView = {
  userId: string;
  displayName: string | null;
  role: ProjectRole;
  joinedAt: Date;
};

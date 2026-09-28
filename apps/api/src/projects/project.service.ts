import { Injectable } from '@nestjs/common';
import { ProjectRepository } from './project.repository.js';
import type { MemberView, ProjectView } from './project.types.js';

@Injectable()
export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}
  create(actorId: string, input: { name: string; description: string | null }): Promise<ProjectView> {
    return this.repository.createProject(actorId, input);
  }
  listMine(actorId: string): Promise<ProjectView[]> { return this.repository.listMine(actorId); }
  room(actorId: string, projectId: string): Promise<ProjectView & { members: MemberView[] }> {
    return this.repository.room(actorId, projectId);
  }
  members(actorId: string, projectId: string): Promise<MemberView[]> { return this.repository.members(actorId, projectId); }
  eligibleUsers(actorId: string, projectId: string, query: string): Promise<Array<{ id: string; displayName: string | null }>> {
    return this.repository.eligibleUsers(actorId, projectId, query);
  }
  addMember(actorId: string, projectId: string, targetId: string): Promise<'ADDED' | 'ALREADY_MEMBER'> {
    return this.repository.addMember(actorId, projectId, targetId);
  }
  removeMember(actorId: string, projectId: string, targetId: string): Promise<'REMOVED' | 'NOT_MEMBER'> {
    return this.repository.removeMember(actorId, projectId, targetId);
  }
  adminProjects(actorId: string): Promise<Array<{ id: string; name: string; description: string | null; memberCount: number }>> {
    return this.repository.adminProjects(actorId);
  }
}

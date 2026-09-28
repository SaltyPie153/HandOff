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
}

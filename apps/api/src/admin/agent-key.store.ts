import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const exec = promisify(execFile);
const fileName = 'agent-key.json';
const invalid = () => new Error('Server agent key is unavailable');
const keyPattern = /^sk-[A-Za-z0-9_-]{4,512}$/;

export type AgentKeyState = {
  configured: boolean;
  source: 'file' | 'environment' | 'disabled' | 'none';
  generation: string;
  key?: string;
};

export class AgentKeyStore {
  private queue: Promise<void> = Promise.resolve();
  private readonly dir: string;
  private readonly nodeEnv: string;

  constructor(config: { nodeEnv: string; secretDir?: string; workRoot?: string }) {
    this.nodeEnv = config.nodeEnv;
    const root = resolve(config.workRoot ?? process.cwd());
    this.dir = config.secretDir ?? join(root, 'work', 'server-secrets');
    if (!isAbsolute(this.dir)) throw invalid();
    const web = join(root, 'apps', 'web');
    const withinWeb = relative(web, resolve(this.dir));
    if (!withinWeb.startsWith('..') && !isAbsolute(withinWeb)) throw invalid();
    if (this.nodeEnv === 'production') {
      if (!config.secretDir) throw invalid();
      const withinRoot = relative(root, resolve(this.dir));
      if (!withinRoot.startsWith('..') && !isAbsolute(withinRoot)) throw invalid();
    }
  }

  private async guarded<T>(action: () => Promise<T>): Promise<T> {
    const prior = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolveNext => { release = resolveNext; });
    await prior;
    try { return await action(); }
    finally { release(); }
  }

  private async acl(path: string, directory: boolean, apply: boolean): Promise<void> {
    if (process.platform !== 'win32') {
      if (apply) {
        const { chmod } = await import('node:fs/promises');
        await chmod(path, directory ? 0o700 : 0o600);
      }
      const info = await lstat(path);
      if ((info.mode & 0o077) !== 0) throw invalid();
      return;
    }
    const setup = `$p=$env:HANDOFF_SECRET_TARGET;$d=$env:HANDOFF_SECRET_DIRECTORY -eq '1';$a=if($d){[System.IO.Directory]::GetAccessControl($p)}else{[System.IO.File]::GetAccessControl($p)};`;
    const script = apply
      ? `${setup}$a.SetAccessRuleProtection($true,$false);foreach($r in @($a.Access)){$a.RemoveAccessRuleSpecific($r)};$u=[Security.Principal.WindowsIdentity]::GetCurrent().User;$f=[Security.AccessControl.InheritanceFlags]::None;if($d){$f=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit};$r=[Security.AccessControl.FileSystemAccessRule]::new($u,[Security.AccessControl.FileSystemRights]::FullControl,$f,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$a.AddAccessRule($r);if($d){[System.IO.Directory]::SetAccessControl($p,$a)}else{[System.IO.File]::SetAccessControl($p,$a)}`
      : `${setup}$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$rules=@($a.Access);if(-not $a.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $u -or $rules[0].AccessControlType -ne 'Allow' -or ($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -eq 0){exit 1}`;
    try {
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, HANDOFF_SECRET_TARGET: path, HANDOFF_SECRET_DIRECTORY: directory ? '1' : '0' },
        windowsHide: true
      });
    } catch { throw invalid(); }
  }

  private async checkDirectory(create: boolean): Promise<boolean> {
    try {
      if (create && this.nodeEnv !== 'production') await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const info = await lstat(this.dir);
      if (!info.isDirectory()) throw invalid();
      await this.acl(this.dir, true, create);
      return true;
    } catch (error) {
      if (!create && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
      throw invalid();
    }
  }

  async read(): Promise<AgentKeyState> {
    const exists = await this.checkDirectory(false);
    if (exists) {
      try {
        const path = join(this.dir, fileName);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw invalid();
        await this.acl(path, false, false);
        const raw = await readFile(path, 'utf8');
        if (raw.length > 2048) throw invalid();
        const record: unknown = JSON.parse(raw);
        if (!record || typeof record !== 'object') throw invalid();
        const data = record as Record<string, unknown>;
        if (data.version !== 1 || typeof data.generation !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(data.generation)) throw invalid();
        if (data.disabled === true && data.key === undefined) return { configured: false, source: 'disabled', generation: data.generation };
        if (typeof data.key === 'string' && keyPattern.test(data.key) && data.disabled === undefined) {
          return { configured: true, source: 'file', generation: data.generation, key: data.key };
        }
        throw invalid();
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw invalid();
      }
    }
    const key = process.env.OPENAI_API_KEY;
    if (key && keyPattern.test(key)) return { configured: true, source: 'environment', generation: `env:${key}`, key };
    return { configured: false, source: 'none', generation: 'none' };
  }

  private async write(record: { version: 1; generation: string; key?: string; disabled?: true }): Promise<void> {
    await this.checkDirectory(true);
    const temp = join(this.dir, `${fileName}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        await this.acl(temp, false, true);
        await handle.writeFile(JSON.stringify(record), 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temp, join(this.dir, fileName));
      await this.acl(join(this.dir, fileName), false, false);
    } catch {
      throw invalid();
    } finally { await rm(temp, { force: true }).catch(() => undefined); }
  }

  async save(input: unknown): Promise<void> {
    if (typeof input !== 'string' || !keyPattern.test(input)) throw invalid();
    await this.guarded(() => this.write({ version: 1, generation: randomUUID(), key: input }));
  }

  async disable(): Promise<void> {
    await this.guarded(() => this.write({ version: 1, generation: randomUUID(), disabled: true }));
  }

  async withGeneration<T>(expected: string, action: () => Promise<T>): Promise<{ unchanged: boolean; value?: T }> {
    return this.guarded(async () => {
      const current = await this.read();
      if (!current.configured || current.generation !== expected) return { unchanged: false };
      return { unchanged: true, value: await action() };
    });
  }
}

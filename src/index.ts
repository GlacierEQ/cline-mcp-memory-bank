#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

interface MemoryBankFile {
  path: string;
  content: string;
}

interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  license: string;
  dependencies: string[];
  devDependencies: string[];
}

interface Decision {
  title: string;
  description: string;
  rationale: string;
  alternatives?: string[];
  date?: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  impact?: string;
  relatedDecisions?: string[];
}

interface TechStack {
  runtime: string;
  frameworks: string[];
  languages: Set<string>;
  configs: string[];
}

interface ProgressUpdate {
  completed?: unknown;
  inProgress?: unknown;
  blocked?: unknown;
  phase?: unknown;
}

interface McpSettings {
  mcpServers: {
    [key: string]: {
      command: string;
      args: string[];
      env?: { [key: string]: string };
      disabled?: boolean;
      autoApprove?: string[];
    };
  };
}

class MemoryBankServer {
  private server: Server;
  private memoryBankPath: string;
  private lastInitializedProject?: string;
  private static readonly MEMORY_BANK_DIR = 'memory-bank';
  private static readonly SERVER_VERSION = '0.2.0';
  private static readonly MCP_SETTINGS_CANDIDATES = {
    linux: [
      '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      '.config/Code - Insiders/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      '.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      '.config/Windsurf/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    ],
    darwin: [
      'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'Library/Application Support/Code - Insiders/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'Library/Application Support/Windsurf/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    ],
    win32: [
      'AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'AppData/Roaming/Code - Insiders/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'AppData/Roaming/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      'AppData/Roaming/Windsurf/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    ],
  };

  constructor() {
    this.server = new Server(
      {
        name: 'memory-bank-server',
        version: MemoryBankServer.SERVER_VERSION,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.memoryBankPath = MemoryBankServer.MEMORY_BANK_DIR;
    this.setupToolHandlers();
    this.setupResourceHandlers();

    // Error handling
    this.server.onerror = (error: unknown) => {
      if (error instanceof Error) {
        console.error('[MCP Error]', error.message, error.stack);
      } else {
        console.error('[MCP Error]', error);
      }
    };
    const shutdown = async () => {
      await this.server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'initialize_memory_bank',
          description: 'Initialize Memory Bank structure for a project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to project root directory',
              },
              force: {
                type: 'boolean',
                description: 'Overwrite existing memory bank files instead of preserving them',
                default: false,
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'update_context',
          description: 'Update active context with current session information',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to project root directory',
              },
              content: {
                type: 'object',
                description: 'Current session context to update',
                properties: {
                  currentSession: {
                    type: 'object',
                    properties: {
                      date: { type: 'string' },
                      mode: { type: 'string' },
                      task: { type: 'string' },
                    },
                    required: ['date', 'mode', 'task'],
                  },
                },
                required: ['currentSession'],
              },
            },
            required: ['projectPath', 'content'],
          },
        },
        {
          name: 'record_decision',
          description: 'Add a new technical decision with rationale and metadata',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to project root directory',
              },
              decision: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Title of the decision' },
                  description: { type: 'string', description: 'What was decided' },
                  rationale: { type: 'string', description: 'Why this decision was made' },
                  status: { 
                    type: 'string',
                    description: 'Current status of the decision',
                    enum: ['proposed', 'accepted', 'rejected', 'superseded'],
                    default: 'accepted'
                  },
                  impact: { 
                    type: 'string',
                    description: 'Areas of the project affected by this decision'
                  },
                  alternatives: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Alternative options that were considered'
                  },
                  relatedDecisions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Titles of related decisions'
                  },
                  date: {
                    type: 'string',
                    description: 'Optional decision date (defaults to current date)',
                    pattern: '^\\d{4}-\\d{2}-\\d{2}$'
                  }
                },
                required: ['title', 'description', 'rationale', 'status'],
              },
            },
            required: ['projectPath', 'decision'],
          },
        },
        {
          name: 'track_progress',
          description: 'Update project progress and milestones',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to project root directory',
              },
              progress: {
                type: 'object',
                properties: {
                  completed: { type: 'array', items: { type: 'string' } },
                  inProgress: { type: 'array', items: { type: 'string' } },
                  blocked: { type: 'array', items: { type: 'string' } },
                  phase: { type: 'string', description: 'Optional current project phase' },
                },
                required: ['completed', 'inProgress'],
              },
            },
            required: ['projectPath', 'progress'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'initialize_memory_bank':
            return await this.handleInitializeMemoryBank(request.params.arguments);
          case 'update_context':
            return await this.handleUpdateContext(request.params.arguments);
          case 'record_decision':
            return await this.handleRecordDecision(request.params.arguments);
          case 'track_progress':
            return await this.handleTrackProgress(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'memory://project/context',
          name: 'Project Context',
          description: 'Project overview, technical stack, and guidelines',
          mimeType: 'text/markdown',
        },
        {
          uri: 'memory://active/context',
          name: 'Active Context',
          description: 'Current session state and tasks',
          mimeType: 'text/markdown',
        },
        {
          uri: 'memory://progress',
          name: 'Progress Log',
          description: 'Project milestones and task tracking',
          mimeType: 'text/markdown',
        },
        {
          uri: 'memory://decisions',
          name: 'Decision Log',
          description: 'Technical decisions and rationale',
          mimeType: 'text/markdown',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const projectPath = this.resolveResourceProjectPath();

      try {
        const content = await this.readMemoryBankFile(
          projectPath,
          this.getFileNameFromUri(request.params.uri)
        );

        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'text/markdown',
              text: content,
            },
          ],
        };
      } catch (error: unknown) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async getProjectInfo(projectPath: string): Promise<ProjectInfo> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      return {
        name: packageJson.name || 'Unknown',
        version: packageJson.version || '0.1.0',
        description: packageJson.description || 'No description provided',
        license: packageJson.license || 'Not specified',
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {})
      };
    } catch (error) {
      return {
        name: path.basename(projectPath) || 'Unknown',
        version: '0.1.0',
        description: 'No description provided',
        license: 'Not specified',
        dependencies: [],
        devDependencies: []
      };
    }
  }

  private async detectTechStack(projectPath: string): Promise<TechStack> {
    const stack: TechStack = {
      runtime: 'Node.js',
      frameworks: [],
      languages: new Set<string>(),
      configs: []
    };

    // Define valid programming language extensions
    const validLanguages = new Map([
      ['js', 'JavaScript'],
      ['mjs', 'JavaScript'],
      ['jsx', 'JavaScript (React)'],
      ['ts', 'TypeScript'],
      ['tsx', 'TypeScript (React)'],
      ['py', 'Python'],
      ['rb', 'Ruby'],
      ['php', 'PHP'],
      ['java', 'Java'],
      ['go', 'Go'],
      ['rs', 'Rust'],
      ['c', 'C'],
      ['cpp', 'C++'],
      ['h', 'C/C++ Header'],
      ['cs', 'C#'],
      ['swift', 'Swift'],
      ['kt', 'Kotlin'],
      ['dart', 'Dart']
    ]);

    // Define relevant config files
    const relevantConfigs = new Set([
      'package.json',
      'tsconfig.json',
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.prettierrc',
      '.babelrc',
      '.env',
      'webpack.config.js',
      'vite.config.js',
      'vite.config.ts',
      'next.config.js',
      'next.config.mjs',
      '.gitignore',
      'jest.config.js',
      'rollup.config.js',
      'pnpm-workspace.yaml',
      'Cargo.toml',
      'go.mod',
      'pyproject.toml',
      'requirements.txt',
      'Gemfile',
      'composer.json',
      'Dockerfile',
      'docker-compose.yml',
      '.editorconfig'
    ]);

    // Directories that never contribute useful project metadata and can be huge.
    const ignoredDirectories = new Set([
      'node_modules', '.git', '.hg', '.svn', 'build', 'dist', 'out', 'coverage',
      '.next', '.nuxt', '.svelte-kit', '.cache', '.turbo', '.output', 'vendor',
      'target', 'obj', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache',
      '.mypy_cache', '.ruff_cache', '.gradle', '.idea', '.terraform'
    ]);

    let scannedFiles = 0;
    const maxScannedFiles = 20000;

    const scan = async (directory: string, depth: number): Promise<void> => {
      if (depth > 12 || scannedFiles >= maxScannedFiles) return;

      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (scannedFiles >= maxScannedFiles) return;
        if (entry.isSymbolicLink()) continue;

        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) {
            await scan(entryPath, depth + 1);
          }
          continue;
        }

        if (!entry.isFile()) continue;
        scannedFiles++;

        const ext = path.extname(entry.name).toLowerCase().substring(1);
        const language = validLanguages.get(ext);
        if (language) {
          stack.languages.add(language);
        }

        if (relevantConfigs.has(entry.name)) {
          stack.configs.push(entry.name);
        }
      }
    };

    await scan(projectPath, 0);
    stack.configs = [...new Set(stack.configs)];

    // Detect frameworks from package.json (projects without one are still valid).
    try {
      const packageJson = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8');
      const { dependencies = {}, devDependencies = {} } = JSON.parse(packageJson);

      const allDeps = { ...dependencies, ...devDependencies };
      const frameworkDetection: Record<string, string> = {
        'react': 'React',
        'next': 'Next.js',
        'express': 'Express',
        'vue': 'Vue.js',
        'angular': 'Angular',
        'svelte': 'Svelte',
        'nestjs': 'NestJS',
        '@nestjs/core': 'NestJS',
        'fastify': 'Fastify',
        'koa': 'Koa',
        'gatsby': 'Gatsby',
        'nuxt': 'Nuxt.js',
        'hono': 'Hono'
      };

      for (const [dep, framework] of Object.entries(frameworkDetection)) {
        if (allDeps[dep] && !stack.frameworks.includes(framework)) {
          stack.frameworks.push(framework);
        }
      }
    } catch {
      // No package.json, or it is not valid JSON.
    }

    const languages = Array.from(stack.languages);
    if (languages.includes('TypeScript') || languages.includes('JavaScript')) {
      stack.runtime = 'Node.js';
    } else if (languages.length > 0) {
      stack.runtime = languages[0];
    }

    return stack;
  }

  private generateInitialDecisions(info: ProjectInfo, stack: TechStack): Decision[] {
    const decisions: Decision[] = [
      {
        title: 'Initial Project Structure',
        description: `Initialized ${info.name} with a modular architecture using ${stack.runtime}`,
        rationale: 'Established foundation for scalable and maintainable development',
        status: 'accepted',
        impact: 'Project-wide',
        date: new Date().toISOString().split('T')[0]
      }
    ];

    // Add framework-specific decisions
    if (stack.frameworks.length > 0) {
      decisions.push({
        title: 'Framework Selection',
        description: `Selected ${stack.frameworks.join(', ')} as primary framework(s)`,
        rationale: 'Chosen based on project requirements and team expertise',
        status: 'accepted',
        impact: 'Technical architecture',
        date: new Date().toISOString().split('T')[0]
      });
    }

    return decisions;
  }

  private formatDecisionLog(decisions: Decision[]): string {
    return `# Decision Log

## Technical Decisions

${decisions.map(d => `### ${d.title} (${d.date || 'No date'})
${d.description}

**Status:** ${d.status}
${d.impact ? `**Impact:** ${d.impact}\n` : ''}
Rationale:
${d.rationale}

${d.alternatives ? `Alternatives Considered:\n${d.alternatives.map(alt => `- ${alt}`).join('\n')}\n` : ''}
${d.relatedDecisions ? `Related Decisions:\n${d.relatedDecisions.map(rd => `- ${rd}`).join('\n')}` : ''}`).join('\n\n')}

## Pending Decisions
`;
  }

  private formatProjectContext(info: ProjectInfo, stack: TechStack): string {
    // Filter out core dependencies
    const corePackages = new Set(['@types/node', 'typescript', 'ts-node', 'nodemon']);
    const keyDeps = info.dependencies.filter(d => !corePackages.has(d));
    const keyDevDeps = info.devDependencies.filter(d => !corePackages.has(d));

    const formatDeps = (deps: string[]) => 
      deps.length ? deps.map(d => `- ${d}`).join('\n') : 'None';

    return `# Project Context

## Overview
${info.name} - ${info.description}
Version: ${info.version}
License: ${info.license}

## Technical Stack
Runtime: ${stack.runtime}
${stack.languages.size ? `Languages: ${Array.from(stack.languages).sort().join(', ')}` : ''}
${stack.frameworks.length ? `Frameworks: ${stack.frameworks.join(', ')}` : ''}

## Dependencies
Core:
${formatDeps(keyDeps)}

Development:
${formatDeps(keyDevDeps)}

## Configuration
${stack.configs.length ? stack.configs.sort().map(c => `- ${c}`).join('\n') : 'None'}

## Architecture
- Type: ${stack.frameworks.length ? `Framework-based (${stack.frameworks.join(', ')})` : 'Modular'}
- Language: ${Array.from(stack.languages).sort()[0] || 'Not detected'}
- Environment: ${stack.runtime}
${info.dependencies.includes('@modelcontextprotocol/sdk') ? '- MCP Server Implementation' : ''}
`;
  }

  /**
   * Resolve a user supplied project path to an absolute, existing directory.
   */
  private async resolveProjectPath(projectPath: unknown): Promise<string> {
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Project path is required');
    }

    let expanded = projectPath.trim();
    if (expanded === '~') {
      expanded = os.homedir();
    } else if (expanded.startsWith(`~${path.sep}`) || expanded.startsWith('~/')) {
      expanded = path.join(os.homedir(), expanded.slice(2));
    }

    const absoluteProjectPath = path.resolve(expanded);

    let stats;
    try {
      stats = await fs.stat(absoluteProjectPath);
    } catch {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Project path does not exist: ${absoluteProjectPath}`
      );
    }

    if (!stats.isDirectory()) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Project path is not a directory: ${absoluteProjectPath}`
      );
    }

    return absoluteProjectPath;
  }

  /**
   * Resolve a project path and ensure that its memory bank has been initialized.
   */
  private async resolveMemoryBankPath(projectPath: unknown): Promise<{
    projectPath: string;
    memoryBankPath: string;
  }> {
    const absoluteProjectPath = await this.resolveProjectPath(projectPath);
    const memoryBankPath = path.join(absoluteProjectPath, this.memoryBankPath);

    try {
      const stats = await fs.stat(memoryBankPath);
      if (!stats.isDirectory()) {
        throw new Error('not a directory');
      }
    } catch {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Memory Bank is not initialized at ${memoryBankPath}. Run initialize_memory_bank first.`
      );
    }

    return { projectPath: absoluteProjectPath, memoryBankPath };
  }

  /**
   * Determine which project resources should be read. Prefer the project that
   * was initialized by this process, then PROJECT_PATH, then the cwd.
   */
  private resolveResourceProjectPath(): string {
    return this.lastInitializedProject || process.env.PROJECT_PATH || process.cwd();
  }


  public async handleInitializeMemoryBank(args: any) {
    const absoluteProjectPath = await this.resolveProjectPath(args?.projectPath);
    const force = args?.force === true;

    this.lastInitializedProject = absoluteProjectPath;

    try {
      const memoryBankPath = path.join(absoluteProjectPath, this.memoryBankPath);
      await fs.mkdir(memoryBankPath, { recursive: true });

      // Gather project information
      const projectInfo = await this.getProjectInfo(absoluteProjectPath);
      const techStack = await this.detectTechStack(absoluteProjectPath);
      const projectContext = this.formatProjectContext(projectInfo, techStack);

      // Generate initial decisions
      const initialDecisions = this.generateInitialDecisions(projectInfo, techStack);
      
      const currentDate = new Date().toISOString().split('T')[0];
      const currentTime = new Date().toLocaleTimeString();
      
      const files: MemoryBankFile[] = [
        {
          path: 'projectContext.md',
          content: projectContext,
        },
        {
          path: 'activeContext.md',
          content: `# Active Context

## Current Session
Started: ${currentDate} ${currentTime}
Mode: Development
Current Task: Initial Setup

## Tasks
### In Progress
- [ ] Project initialization
- [ ] Environment setup

## Open Questions
- What are the primary project goals?
- What are the key technical requirements?

## Recent Updates
- ${currentDate}: Project initialized`,
        },
        {
          path: 'progress.md',
          content: `# Progress Log

## Current Phase
Initialization

## Completed Tasks
- Repository setup (${currentDate})
- Basic project structure (${currentDate})

## In Progress
- Development environment configuration
- Initial documentation

## Upcoming
- Code implementation
- Testing setup

## Blockers
[None currently identified]`,
        },
        {
          path: 'decisionLog.md',
          content: this.formatDecisionLog([
            ...initialDecisions,
            {
              title: 'Development Workflow',
              description: 'Established initial development workflow and practices',
              rationale: 'Ensure consistent development process and code quality',
              status: 'accepted',
              impact: 'Development process',
              date: currentDate,
              alternatives: [
                'Ad-hoc development process',
                'Waterfall methodology'
              ]
            },
            {
              title: 'Documentation Strategy',
              description: 'Implemented automated documentation with memory bank',
              rationale: 'Maintain up-to-date project context and decision history',
              status: 'accepted',
              impact: 'Project documentation',
              date: currentDate
            }
          ]),
        },
      ];

      const created: string[] = [];
      const preserved: string[] = [];

      for (const file of files) {
        const filePath = path.join(memoryBankPath, file.path);
        const exists = await this.fileExists(filePath);

        // Never destroy an existing memory bank unless the caller explicitly
        // asks for it. This makes initialization safe to run repeatedly.
        if (exists && !force) {
          preserved.push(file.path);
          continue;
        }

        await fs.writeFile(filePath, file.content, 'utf8');
        created.push(file.path);
      }

      // Configure Cline's MCP settings on a best-effort basis. A missing or
      // read-only configuration file must not invalidate the memory bank.
      let settingsStatus: string;
      try {
        const settingsPath = await this.updateMcpSettings(absoluteProjectPath);
        settingsStatus = `configured at ${settingsPath}`;
      } catch (error: unknown) {
        settingsStatus = `not updated (${error instanceof Error ? error.message : String(error)})`;
      }

      const summary = [
        `Memory Bank initialized at ${memoryBankPath}`,
        `Created: ${created.length ? created.join(', ') : 'none'}`,
        `Preserved: ${preserved.length ? preserved.join(', ') : 'none'}`,
        `MCP settings: ${settingsStatus}`,
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize Memory Bank: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async handleUpdateContext(args: any) {
    const session = args?.content?.currentSession;
    if (!session || typeof session !== 'object') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'content.currentSession is required'
      );
    }
    if (typeof session.mode !== 'string' || typeof session.task !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'currentSession.mode and currentSession.task must be strings'
      );
    }

    const { memoryBankPath } = await this.resolveMemoryBankPath(args?.projectPath);

    try {
      const filePath = path.join(memoryBankPath, 'activeContext.md');
      const currentContent = await fs.readFile(filePath, 'utf8');
      const updatedContent = this.mergeContext(currentContent, args.content);
      await fs.writeFile(filePath, updatedContent, 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: 'Active context updated successfully',
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update context: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleRecordDecision(args: any) {
    const decision = args?.decision;
    if (!decision || typeof decision !== 'object') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project path and decision are required'
      );
    }

    for (const field of ['title', 'description', 'rationale'] as const) {
      if (typeof decision[field] !== 'string' || decision[field].trim().length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `decision.${field} is required and must be a non-empty string`
        );
      }
    }

    const statuses = ['proposed', 'accepted', 'rejected', 'superseded'] as const;
    const status = statuses.includes(decision.status) ? decision.status : 'accepted';
    const normalizedDecision: Decision = { ...decision, status };

    const { memoryBankPath } = await this.resolveMemoryBankPath(args?.projectPath);

    try {
      const filePath = path.join(memoryBankPath, 'decisionLog.md');
      const currentContent = await fs.readFile(filePath, 'utf8');
      const updatedContent = this.addDecision(currentContent, normalizedDecision);
      await fs.writeFile(filePath, updatedContent, 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: `Decision recorded successfully in the ${status === 'proposed' ? 'pending' : 'technical'} decisions section`,
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to record decision: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleTrackProgress(args: any) {
    const progress = args?.progress;
    if (!progress || typeof progress !== 'object') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project path and progress are required'
      );
    }

    const readTaskList = (value: unknown, field: string): string[] => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `progress.${field} must be an array of strings`
        );
      }
      return value.map(item => item.trim()).filter(item => item.length > 0);
    };

    const normalized: { completed: string[]; inProgress: string[]; blocked: string[]; phase?: string } = {
      completed: readTaskList(progress.completed, 'completed'),
      inProgress: readTaskList(progress.inProgress, 'inProgress'),
      blocked: readTaskList(progress.blocked, 'blocked'),
      phase: typeof progress.phase === 'string' ? progress.phase : undefined,
    };

    const { memoryBankPath } = await this.resolveMemoryBankPath(args?.projectPath);

    try {
      const filePath = path.join(memoryBankPath, 'progress.md');
      const currentContent = await fs.readFile(filePath, 'utf8');
      const updatedContent = this.updateProgress(currentContent, normalized);
      await fs.writeFile(filePath, updatedContent, 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: 'Progress updated successfully',
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update progress: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async updateMcpSettings(projectPath: string): Promise<string> {
    try {
      const settingsPath = await this.getMcpSettingsPath();
      const settings = await this.readMcpSettings(settingsPath);

      // Update the memory-bank server configuration while preserving any
      // user-managed options (for example autoApprove entries).
      settings.mcpServers = settings.mcpServers || {};
      const existing = settings.mcpServers['memory-bank'];
      settings.mcpServers['memory-bank'] = {
        ...existing,
        command: process.execPath,
        args: [this.getServerEntryPath()],
        env: {
          ...(existing?.env || {}),
          PROJECT_PATH: projectPath,
        },
        disabled: false,
        autoApprove: existing?.autoApprove || [],
      };

      await this.writeMcpSettings(settingsPath, settings);
      return settingsPath;
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update MCP settings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * The entry point of this server, used when writing the MCP settings. This
   * must be this package's build output, not a file inside the target project.
   */
  private getServerEntryPath(): string {
    try {
      return fileURLToPath(import.meta.url);
    } catch {
      return path.resolve(process.argv[1] || path.join('build', 'index.js'));
    }
  }

  private async getMcpSettingsPath(): Promise<string> {
    const override = process.env.CLINE_MCP_SETTINGS_PATH;
    if (override && override.trim().length > 0) {
      return path.resolve(override.trim());
    }

    let homedir: string;
    try {
      homedir = os.homedir();
    } catch (error) {
      console.error('Error getting home directory:', error);
      throw new Error(`Could not determine user home directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    const candidates = (MemoryBankServer.MCP_SETTINGS_CANDIDATES as Record<string, string[]>)[process.platform];
    if (!candidates || candidates.length === 0) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    // Prefer an existing Cline settings file (Stable, Insiders, Cursor,
    // Windsurf). If none exists yet, fall back to VS Code Stable.
    for (const relativePath of candidates) {
      const candidatePath = path.join(homedir, relativePath);
      if (await this.fileExists(candidatePath)) {
        return candidatePath;
      }
    }

    return path.join(homedir, candidates[0]);
  }

  private async readMcpSettings(settingsPath: string): Promise<McpSettings> {
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Return default settings if file doesn't exist
        return { mcpServers: {} };
      }
      throw error;
    }
  }

  private async writeMcpSettings(settingsPath: string, settings: McpSettings): Promise<void> {
    // Ensure settings directory exists
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });

    // Write atomically so a crash cannot leave Cline with a truncated file.
    const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      await fs.rename(temporaryPath, settingsPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readMemoryBankFile(projectPath: string, fileName: string): Promise<string> {
    const filePath = path.join(projectPath, this.memoryBankPath, fileName);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error: unknown) {
      throw new Error(`Failed to read file ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getFileNameFromUri(uri: string): string {
    const mapping: { [key: string]: string } = {
      'memory://project/context': 'projectContext.md',
      'memory://active/context': 'activeContext.md',
      'memory://progress': 'progress.md',
      'memory://decisions': 'decisionLog.md',
    };

    const fileName = mapping[uri];
    if (!fileName) {
      throw new Error(`Invalid URI: ${uri}`);
    }

    return fileName;
  }

  private mergeContext(current: string, update: any): string {
    const session = update?.currentSession || {};
    const date = typeof session.date === 'string' && session.date.trim().length > 0
      ? session.date
      : new Date().toISOString().split('T')[0];
    const mode = typeof session.mode === 'string' && session.mode.trim().length > 0
      ? session.mode
      : 'Development';
    const task = typeof session.task === 'string' && session.task.trim().length > 0
      ? session.task
      : 'Not specified';

    return `${current.trimEnd()}\n\n## Session Update (${date})\n- Mode: ${mode}\n- Task: ${task}`;
  }

  private addDecision(current: string, decision: Decision): string {
    const date = decision.date || new Date().toISOString().split('T')[0];
    const alternatives = decision.alternatives?.length
      ? `\n\nAlternatives Considered:\n${decision.alternatives.map((alt: string) => `- ${alt}`).join('\n')}`
      : '';
    const impact = decision.impact ? `\n**Impact:** ${decision.impact}` : '';
    const related = decision.relatedDecisions?.length
      ? `\n\nRelated Decisions:\n${decision.relatedDecisions.map((rd: string) => `- ${rd}`).join('\n')}`
      : '';

    // Proposed decisions belong in the pending section; every other status
    // belongs in the technical decisions section.
    const sectionHeading = decision.status === 'proposed' ? 'Pending Decisions' : 'Technical Decisions';

    const newDecision = `### ${decision.title} (${date})
${decision.description}

**Status:** ${decision.status}${impact}

Rationale:
${decision.rationale}${alternatives}${related}`;

    const sections = current.trimEnd().split('\n\n## ');
    const targetSectionIndex = sections.findIndex(section => section.startsWith(sectionHeading));

    if (targetSectionIndex === -1) {
      sections.push(`${sectionHeading}\n\n${newDecision}`);
    } else {
      sections[targetSectionIndex] = `${sections[targetSectionIndex].trimEnd()}\n\n${newDecision}`;
    }

    return `${sections.join('\n\n## ')}\n`;
  }

  private updateProgress(
    current: string,
    progress: { completed: string[]; inProgress: string[]; blocked: string[]; phase?: string }
  ): string {
    const date = new Date().toISOString().split('T')[0];
    const formatTasks = (tasks: string[], marker: string): string =>
      tasks.length ? tasks.map(task => `- ${marker} ${task}`).join('\n') : '- None';

    const completed = formatTasks(progress.completed, '✓');
    const inProgress = formatTasks(progress.inProgress, '→');
    const blocked = progress.blocked.length
      ? `\n\nBlocked:\n${formatTasks(progress.blocked, '⚠')}`
      : '';
    const phase = progress.phase?.trim() || 'Development';

    return `${current.trimEnd()}\n\n## Update (${date})\nPhase: ${phase}\n\nCompleted:\n${completed}\n\nIn Progress:\n${inProgress}${blocked}\n`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Memory Bank MCP server running on stdio');
  }
}

export { MemoryBankServer };

async function handleCliCommand() {
  const command = process.argv[2];

  if (command === 'initialize_memory_bank') {
    const projectPath = process.argv[3];
    const force = process.argv.includes('--force');
    if (!projectPath) {
      console.error('Error: Project path is required');
      process.exit(1);
    }

    const server = new MemoryBankServer();
    try {
      const result = await server.handleInitializeMemoryBank({ projectPath, force });
      console.log(result.content[0].text);
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Memory Bank MCP server

Usage:
  memory-bank-server                        Run as an MCP server over stdio
  memory-bank-server initialize_memory_bank <projectPath> [--force]
  memory-bank-server --help

Environment:
  PROJECT_PATH              Project used for MCP resource reads
  CLINE_MCP_SETTINGS_PATH   Override the Cline MCP settings file path`);
    process.exit(0);
  } else {
    // Run as MCP server
    const server = new MemoryBankServer();
    server.run().catch(error => {
      console.error('Failed to start Memory Bank MCP server:', error);
      process.exit(1);
    });
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;

  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(modulePath);
  }
}

if (isMainModule()) {
  handleCliCommand();
}

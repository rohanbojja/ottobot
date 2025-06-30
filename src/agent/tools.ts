import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { createLogger } from '@/shared/logger';

const execAsync = promisify(exec);
const logger = createLogger('agent-tools');

const WORKSPACE_DIR = '/home/developer/workspace';
const ARTIFACTS_DIR = '/app/session-data/artifacts';

// Tool interfaces
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

// Bash execute tool
export async function bashExecute(params: {
  command: string;
  cwd?: string;
  timeout?: number;
}): Promise<ToolResult> {
  const { command, cwd = WORKSPACE_DIR, timeout = 30000 } = params;
  
  logger.info(`Executing command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    
    return {
      success: true,
      output: stdout || stderr,
    };
  } catch (error: any) {
    logger.error('Bash execution error:', error);
    return {
      success: false,
      error: error.message,
      output: error.stdout || error.stderr,
    };
  }
}

// File write tool
export async function fileWrite(params: {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}): Promise<ToolResult> {
  const { path: filePath, content, encoding = 'utf8' } = params;
  const fullPath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(WORKSPACE_DIR, filePath);
  
  logger.info(`Writing file: ${fullPath}`);
  
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    
    // Write file
    await fs.writeFile(fullPath, content, encoding);
    
    return {
      success: true,
      output: `File written successfully: ${filePath}`,
    };
  } catch (error: any) {
    logger.error('File write error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// File read tool
export async function fileRead(params: {
  path: string;
  encoding?: BufferEncoding;
}): Promise<ToolResult> {
  const { path: filePath, encoding = 'utf8' } = params;
  const fullPath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(WORKSPACE_DIR, filePath);
  
  logger.info(`Reading file: ${fullPath}`);
  
  try {
    const content = await fs.readFile(fullPath, encoding);
    
    return {
      success: true,
      output: content,
    };
  } catch (error: any) {
    logger.error('File read error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// File list tool
export async function fileList(params: {
  path?: string;
  recursive?: boolean;
  pattern?: string;
}): Promise<ToolResult> {
  const { path: dirPath = '.', recursive = false, pattern } = params;
  const fullPath = path.isAbsolute(dirPath) 
    ? dirPath 
    : path.join(WORKSPACE_DIR, dirPath);
  
  logger.info(`Listing files in: ${fullPath}`);
  
  try {
    const files: string[] = [];
    
    async function scanDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const relativePath = path.relative(fullPath, entryPath);
        
        if (pattern && !relativePath.match(new RegExp(pattern))) {
          continue;
        }
        
        if (entry.isDirectory()) {
          files.push(`${relativePath}/`);
          if (recursive) {
            await scanDir(entryPath);
          }
        } else {
          files.push(relativePath);
        }
      }
    }
    
    await scanDir(fullPath);
    
    return {
      success: true,
      output: files.join('\n'),
      metadata: { count: files.length },
    };
  } catch (error: any) {
    logger.error('File list error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Project structure tool
export async function projectStructure(params: {
  maxDepth?: number;
}): Promise<ToolResult> {
  const { maxDepth = 3 } = params;
  
  logger.info('Analyzing project structure');
  
  try {
    const structure: any = {};
    
    async function buildStructure(dir: string, depth: number): Promise<any> {
      if (depth > maxDepth) return null;
      
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const result: any = {};
      
      for (const entry of entries) {
        // Skip hidden files and common ignore patterns
        if (entry.name.startsWith('.') || 
            entry.name === 'node_modules' ||
            entry.name === '__pycache__') {
          continue;
        }
        
        const entryPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          result[entry.name] = await buildStructure(entryPath, depth + 1);
        } else {
          result[entry.name] = 'file';
        }
      }
      
      return result;
    }
    
    structure.workspace = await buildStructure(WORKSPACE_DIR, 0);
    
    return {
      success: true,
      output: JSON.stringify(structure, null, 2),
    };
  } catch (error: any) {
    logger.error('Project structure error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Git operations tool
export async function gitOperations(params: {
  operation: 'init' | 'add' | 'commit' | 'status' | 'log' | 'branch' | 'checkout';
  args?: string[];
}): Promise<ToolResult> {
  const { operation, args = [] } = params;
  
  const gitCommands: Record<string, string> = {
    init: 'git init',
    add: `git add ${args.join(' ') || '.'}`,
    commit: `git commit -m "${args[0] || 'Update'}"`,
    status: 'git status',
    log: 'git log --oneline -10',
    branch: `git branch ${args.join(' ')}`,
    checkout: `git checkout ${args[0]}`,
  };
  
  const command = gitCommands[operation];
  if (!command) {
    return {
      success: false,
      error: `Unknown git operation: ${operation}`,
    };
  }
  
  return bashExecute({ command });
}

// Package install tool
export async function packageInstall(params: {
  packages: string[];
  manager?: 'npm' | 'pip' | 'bun';
  dev?: boolean;
}): Promise<ToolResult> {
  const { packages, manager = 'npm', dev = false } = params;
  
  let command: string;
  switch (manager) {
    case 'npm':
      command = `npm install ${dev ? '--save-dev' : ''} ${packages.join(' ')}`;
      break;
    case 'pip':
      command = `pip install ${packages.join(' ')}`;
      break;
    case 'bun':
      command = `bun add ${dev ? '--dev' : ''} ${packages.join(' ')}`;
      break;
    default:
      return {
        success: false,
        error: `Unknown package manager: ${manager}`,
      };
  }
  
  return bashExecute({ command });
}

// Create artifact tool
export async function createArtifact(params: {
  name: string;
  include?: string[];
  exclude?: string[];
}): Promise<ToolResult> {
  const { name, include = ['*'], exclude = ['node_modules', '.git', '__pycache__'] } = params;
  const artifactPath = path.join(ARTIFACTS_DIR, `${name}.zip`);
  
  logger.info(`Creating artifact: ${name}`);
  
  try {
    // Ensure artifacts directory exists
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    
    // Create archive
    const output = createWriteStream(artifactPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    return new Promise((resolve) => {
      output.on('close', () => {
        resolve({
          success: true,
          output: `Artifact created: ${name}.zip (${archive.pointer()} bytes)`,
          metadata: {
            path: artifactPath,
            size: archive.pointer(),
            download_url: `/download/${name}.zip`,
          },
        });
      });
      
      archive.on('error', (err) => {
        resolve({
          success: false,
          error: err.message,
        });
      });
      
      archive.pipe(output);
      
      // Add files
      for (const pattern of include) {
        archive.glob(pattern, {
          cwd: WORKSPACE_DIR,
          ignore: exclude,
        });
      }
      
      archive.finalize();
    });
  } catch (error: any) {
    logger.error('Create artifact error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Browser open tool
export async function browserOpen(params: {
  url: string;
}): Promise<ToolResult> {
  const { url } = params;
  
  // In container, open with firefox
  return bashExecute({
    command: `firefox "${url}" &`,
  });
}

// Process monitor tool
export async function processMonitor(params: {
  action?: 'list' | 'kill';
  pid?: number;
}): Promise<ToolResult> {
  const { action = 'list', pid } = params;
  
  if (action === 'kill' && pid) {
    return bashExecute({
      command: `kill ${pid}`,
    });
  }
  
  // List processes
  return bashExecute({
    command: 'ps aux | grep -v grep | head -20',
  });
}
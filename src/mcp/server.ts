import { Elysia } from 'elysia';
import { mcp } from 'elysia-mcp';
import { z } from 'zod';
import { execSync, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const PORT = process.env['MCP_PORT'] || 8080;
const WORKSPACE_DIR = '/home/developer/workspace';

// Helper function to resolve paths safely within workspace
function resolvePath(filePath: string): string {
  // Convert relative paths to absolute paths within workspace
  if (path.isAbsolute(filePath)) {
    // Ensure absolute paths are within workspace for security
    if (!filePath.startsWith(WORKSPACE_DIR)) {
      return path.join(WORKSPACE_DIR, path.basename(filePath));
    }
    return filePath;
  }

  return path.resolve(WORKSPACE_DIR, filePath);
}

// Tool implementations
async function readFile(filePath: string): Promise<string> {
  const fullPath = resolvePath(filePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    return `File content of ${filePath}:\n\n${content}`;
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function writeFile(filePath: string, content: string): Promise<string> {
  const fullPath = resolvePath(filePath);

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return `Successfully wrote ${content.length} characters to ${filePath}`;
  } catch (error) {
    throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function listFiles(dirPath: string = '.'): Promise<string> {
  const fullPath = resolvePath(dirPath);

  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const files = entries.map(entry => {
      const type = entry.isDirectory() ? 'DIR' : 'FILE';
      return `${type.padEnd(4)} ${entry.name}`;
    });

    return `Contents of ${dirPath}:\n\n${files.join('\n')}`;
  } catch (error) {
    throw new Error(`Failed to list directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function executeCommand(command: string, cwd?: string): Promise<string> {
  const workingDir = cwd ? resolvePath(cwd) : WORKSPACE_DIR;

  try {
    console.log(`Executing command: ${command} in ${workingDir}`);

    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', command], {
        cwd: workingDir,
        stdio: 'pipe',
        env: { ...process.env, DISPLAY: ':1' } // Ensure DISPLAY is set for GUI apps
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const output = [
          `Command: ${command}`,
          `Working directory: ${workingDir}`,
          `Exit code: ${code}`,
          '',
          'STDOUT:',
          stdout || '(no output)',
          '',
          'STDERR:',
          stderr || '(no errors)',
        ].join('\n');

        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command failed with exit code ${code}:\n${output}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });

      // Set timeout for long-running commands
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Command timeout after 30 seconds'));
      }, 30000);
    });
  } catch (error) {
    throw new Error(`Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function createDirectory(dirPath: string): Promise<string> {
  const fullPath = resolvePath(dirPath);

  try {
    await fs.mkdir(fullPath, { recursive: true });
    return `Successfully created directory ${dirPath}`;
  } catch (error) {
    throw new Error(`Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function deleteFile(filePath: string): Promise<string> {
  const fullPath = resolvePath(filePath);

  try {
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      await fs.rmdir(fullPath, { recursive: true });
      return `Successfully deleted directory ${filePath}`;
    } else {
      await fs.unlink(fullPath);
      return `Successfully deleted file ${filePath}`;
    }
  } catch (error) {
    throw new Error(`Failed to delete ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function openVSCode(targetPath: string): Promise<string> {
  const fullPath = resolvePath(targetPath);

  try {
    // Use execSync to open VS Code and return immediately
    execSync(`code "${fullPath}"`, {
      cwd: WORKSPACE_DIR,
      stdio: 'ignore',
      env: { ...process.env, DISPLAY: ':1' }
    });

    return `Opened ${targetPath} in VS Code`;
  } catch (error) {
    throw new Error(`Failed to open VS Code: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Create and start the server using elysia-mcp plugin
const app = new Elysia()
  // Add a health check endpoint for debugging
  .get('/', () => ({ status: 'MCP Server running', port: PORT }))
  .get('/health', () => ({ status: 'healthy', timestamp: new Date().toISOString() }))
  
  // Use the MCP plugin with basePath
  .use(mcp({
    basePath: '/mcp',
    serverInfo: {
      name: 'ottobot-dev-tools',
      version: '1.0.0'
    },
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    enableLogging: true,
    stateless: true,
    enableJsonResponse: true,
    setupServer: async (server) => {
      // Register tools using the MCP Server API (without description parameter)
      server.tool('read_file', {
        path: z.string().describe('Path to the file to read')
      }, async (args) => {
        const result = await readFile(args.path);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('write_file', {
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file')
      }, async (args) => {
        const result = await writeFile(args.path, args.content);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('list_files', {
        path: z.string().optional().describe('Path to list (defaults to current directory)')
      }, async (args) => {
        const result = await listFiles(args.path);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('execute_command', {
        command: z.string().describe('Command to execute'),
        cwd: z.string().optional().describe('Working directory for the command')
      }, async (args) => {
        const result = await executeCommand(args.command, args.cwd);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('create_directory', {
        path: z.string().describe('Path of the directory to create')
      }, async (args) => {
        const result = await createDirectory(args.path);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('delete_file', {
        path: z.string().describe('Path of the file or directory to delete')
      }, async (args) => {
        const result = await deleteFile(args.path);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('open_vscode', {
        path: z.string().describe('Path to open in VS Code')
      }, async (args) => {
        const result = await openVSCode(args.path);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      console.log('MCP Server tools registered');
    }
  }))
  .listen(PORT);

console.log(`MCP Server listening on port ${PORT}`);

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  app.stop();
  console.log('Server shutdown complete');
  process.exit(0);
});
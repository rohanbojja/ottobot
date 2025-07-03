import { Elysia } from 'elysia';
import { mcp } from 'elysia-mcp';
import { z } from 'zod';
import { execSync, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';

const PORT = process.env['MCP_PORT'] || 8080;
const WORKSPACE_DIR = '/home/developer/workspace';
const SESSION_ID = process.env['SESSION_ID'] || 'unknown';

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

async function executeCommandAsync(command: string, cwd?: string): Promise<string> {
  const workingDir = cwd ? resolvePath(cwd) : WORKSPACE_DIR;

  try {
    console.log(`Executing async command: ${command} in ${workingDir}`);

    // Launch command in background without waiting for completion
    const child = spawn('bash', ['-c', command], {
      cwd: workingDir,
      stdio: 'ignore', // Detach from stdio to prevent blocking
      detached: true, // Allow process to continue running independently
      env: { ...process.env, DISPLAY: ':1' }
    });

    // Don't wait for the process to complete
    child.unref(); // Allow Node.js to exit even if this process is still running

    const pid = child.pid;
    console.log(`Async command launched with PID: ${pid}`);

    return [
      `Command launched asynchronously: ${command}`,
      `Working directory: ${workingDir}`,
      `Process ID: ${pid}`,
      `Note: Command is running in background and will not block further operations`,
    ].join('\n');
  } catch (error) {
    throw new Error(`Async command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

// GUI Automation Functions using xdotool
async function guiClick(x: number, y: number): Promise<string> {
  try {
    execSync(`xdotool mousemove ${x} ${y} click 1`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Clicked at coordinates (${x}, ${y})`;
  } catch (error) {
    throw new Error(`Failed to click at (${x}, ${y}): ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiType(text: string): Promise<string> {
  try {
    // Escape special characters for shell safety
    const escapedText = text.replace(/'/g, "'\"'\"'");
    execSync(`xdotool type '${escapedText}'`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Typed text: ${text}`;
  } catch (error) {
    throw new Error(`Failed to type text: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiKey(key: string): Promise<string> {
  try {
    // Support common key combinations and special keys
    const validKeys = ['Return', 'Tab', 'Escape', 'BackSpace', 'Delete', 'Home', 'End', 'Page_Up', 'Page_Down', 
                      'Left', 'Right', 'Up', 'Down', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
                      'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+a', 'ctrl+s', 'alt+Tab'];
    
    execSync(`xdotool key ${key}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Sent key: ${key}`;
  } catch (error) {
    throw new Error(`Failed to send key ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiScreenshot(): Promise<string> {
  try {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const screenshotPath = path.join(WORKSPACE_DIR, `screenshot-${timestamp}.png`);
    
    execSync(`scrot '${screenshotPath}'`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    
    return `Screenshot saved to ${screenshotPath}`;
  } catch (error) {
    throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiGetWindowInfo(): Promise<string> {
  try {
    // Get active window information
    const activeWindowId = execSync('xdotool getactivewindow', {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    }).trim();
    
    const windowName = execSync(`xdotool getwindowname ${activeWindowId}`, {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    }).trim();
    
    const windowGeometry = execSync(`xdotool getwindowgeometry ${activeWindowId}`, {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    }).trim();
    
    return `Active Window Info:\nID: ${activeWindowId}\nName: ${windowName}\nGeometry: ${windowGeometry}`;
  } catch (error) {
    throw new Error(`Failed to get window info: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiFindWindow(namePattern: string): Promise<string> {
  try {
    const windowIds = execSync(`xdotool search --name "${namePattern}"`, {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    }).trim().split('\n').filter(id => id.length > 0);
    
    if (windowIds.length === 0) {
      return `No windows found matching pattern: ${namePattern}`;
    }
    
    let result = `Found ${windowIds.length} window(s) matching "${namePattern}":\n`;
    for (const id of windowIds) {
      try {
        const name = execSync(`xdotool getwindowname ${id}`, {
          env: { ...process.env, DISPLAY: ':1' },
          encoding: 'utf8'
        }).trim();
        result += `- ID: ${id}, Name: ${name}\n`;
      } catch (e) {
        result += `- ID: ${id}, Name: <unknown>\n`;
      }
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to find windows: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function guiActivateWindow(windowId: string): Promise<string> {
  try {
    execSync(`xdotool windowactivate ${windowId}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Activated window with ID: ${windowId}`;
  } catch (error) {
    throw new Error(`Failed to activate window ${windowId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function listProcesses(): Promise<string> {
  try {
    const output = execSync('ps aux --no-headers', {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    });
    
    // Filter to show only interesting processes (exclude kernel threads and system processes)
    const lines = output.split('\n').filter(line => {
      if (!line.trim()) return false;
      // Show GUI apps, user processes, and development tools
      return line.includes('code') || 
             line.includes('terminal') || 
             line.includes('xfce') ||
             line.includes('xterm') ||
             line.includes('browser') ||
             line.includes('node') ||
             line.includes('python') ||
             line.includes('/bin/bash') ||
             line.includes('developer');
    });
    
    if (lines.length === 0) {
      return 'No user processes found';
    }
    
    let result = 'Running User Processes:\n';
    result += 'PID     CPU% MEM% COMMAND\n';
    result += '------- ---- ---- -------\n';
    
    for (const line of lines.slice(0, 20)) { // Limit to 20 processes
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const pid = parts[1];
        const cpu = parts[2];
        const mem = parts[3];
        const command = parts.slice(10).join(' ').substring(0, 50); // Truncate long commands
        result += `${pid.padEnd(7)} ${cpu.padEnd(4)} ${mem.padEnd(4)} ${command}\n`;
      }
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to list processes: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function killProcess(pid: string): Promise<string> {
  try {
    // First verify the process exists and belongs to developer user
    try {
      const checkOutput = execSync(`ps -p ${pid} -o user=`, {
        encoding: 'utf8'
      }).trim();
      
      if (checkOutput !== 'developer') {
        throw new Error(`Process ${pid} does not belong to developer user or does not exist`);
      }
    } catch (checkError) {
      throw new Error(`Process ${pid} not found or not accessible`);
    }
    
    // Kill the process
    execSync(`kill ${pid}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    
    return `Process ${pid} terminated successfully`;
  } catch (error) {
    throw new Error(`Failed to kill process ${pid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Window Tiling and Management Functions
async function getScreenResolution(): Promise<{ width: number; height: number }> {
  try {
    const output = execSync('xdpyinfo | grep dimensions', {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    });
    
    // Parse output like "dimensions:    1920x1080 pixels"
    const match = output.match(/(\d+)x(\d+)/);
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2])
      };
    }
    
    // Fallback to common resolution
    return { width: 1920, height: 1080 };
  } catch (error) {
    // Fallback resolution
    return { width: 1920, height: 1080 };
  }
}

async function moveWindow(windowId: string, x: number, y: number): Promise<string> {
  try {
    execSync(`xdotool windowmove ${windowId} ${x} ${y}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Moved window ${windowId} to position (${x}, ${y})`;
  } catch (error) {
    throw new Error(`Failed to move window: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function resizeWindow(windowId: string, width: number, height: number): Promise<string> {
  try {
    execSync(`xdotool windowsize ${windowId} ${width} ${height}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Resized window ${windowId} to ${width}x${height}`;
  } catch (error) {
    throw new Error(`Failed to resize window: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowLeft(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = screen.height;
    
    // Move to left half
    await moveWindow(windowId, 0, 0);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to left half of screen (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window left: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowRight(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = screen.height;
    const x = screen.width - width;
    
    // Move to right half
    await moveWindow(windowId, x, 0);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to right half of screen (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window right: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowTopLeft(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = Math.floor(screen.height / 2);
    
    await moveWindow(windowId, 0, 0);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to top-left quarter (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window top-left: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowTopRight(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = Math.floor(screen.height / 2);
    const x = screen.width - width;
    
    await moveWindow(windowId, x, 0);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to top-right quarter (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window top-right: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowBottomLeft(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = Math.floor(screen.height / 2);
    const y = screen.height - height;
    
    await moveWindow(windowId, 0, y);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to bottom-left quarter (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window bottom-left: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function tileWindowBottomRight(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    const width = Math.floor(screen.width / 2);
    const height = Math.floor(screen.height / 2);
    const x = screen.width - width;
    const y = screen.height - height;
    
    await moveWindow(windowId, x, y);
    await resizeWindow(windowId, width, height);
    
    return `Tiled window ${windowId} to bottom-right quarter (${width}x${height})`;
  } catch (error) {
    throw new Error(`Failed to tile window bottom-right: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}


async function minimizeWindow(windowId: string): Promise<string> {
  try {
    execSync(`xdotool windowminimize ${windowId}`, {
      env: { ...process.env, DISPLAY: ':1' }
    });
    return `Minimized window ${windowId}`;
  } catch (error) {
    throw new Error(`Failed to minimize window: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function centerWindow(windowId: string): Promise<string> {
  try {
    const screen = await getScreenResolution();
    
    // Get current window size
    const sizeOutput = execSync(`xdotool getwindowgeometry ${windowId}`, {
      env: { ...process.env, DISPLAY: ':1' },
      encoding: 'utf8'
    });
    
    // Parse geometry like "Geometry: 800x600"
    const match = sizeOutput.match(/Geometry: (\d+)x(\d+)/);
    let windowWidth = 800;
    let windowHeight = 600;
    
    if (match) {
      windowWidth = parseInt(match[1]);
      windowHeight = parseInt(match[2]);
    }
    
    // Center the window
    const x = Math.floor((screen.width - windowWidth) / 2);
    const y = Math.floor((screen.height - windowHeight) / 2);
    
    await moveWindow(windowId, x, y);
    
    return `Centered window ${windowId} at (${x}, ${y})`;
  } catch (error) {
    throw new Error(`Failed to center window: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Create and start the server using elysia-mcp plugin
const app = new Elysia()
  // Add a health check endpoint for debugging
  .get('/', () => ({ status: 'MCP Server running', port: PORT }))
  .get('/health', () => ({ status: 'healthy', timestamp: new Date().toISOString() }))
  .get("/download", async ({ set }) => {
    try {
      console.log('Creating zip archive of workspace...');
      console.log('Workspace directory:', WORKSPACE_DIR);
      console.log('Session ID:', SESSION_ID);
      
      // Generate a descriptive filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
      const filename = `ottobot-session-${SESSION_ID}-${timestamp}.zip`;
      
      // Debug: Check home directory
      try {
        const homeFiles = await fs.readdir('/home/developer');
        console.log('Files in /home/developer:', homeFiles);
      } catch (err) {
        console.error('Error reading home directory:', err);
      }
      
      // Check if workspace directory exists, create if it doesn't
      try {
        const stats = await fs.stat(WORKSPACE_DIR);
        console.log('Workspace exists:', stats.isDirectory());
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          console.log('Workspace directory does not exist, creating it...');
          try {
            await fs.mkdir(WORKSPACE_DIR, { recursive: true });
            console.log('Workspace directory created successfully');
          } catch (createErr) {
            console.error('Error creating workspace directory:', createErr);
            throw new Error('Failed to create workspace directory');
          }
        } else {
          console.error('Error checking workspace:', err);
          throw new Error('Workspace directory not accessible');
        }
      }
      
      // List files in workspace
      let fileCount = 0;
      try {
        const files = await fs.readdir(WORKSPACE_DIR);
        fileCount = files.length;
        console.log('Files in workspace:', files);
        
        if (files.length === 0) {
          console.log('Workspace is empty, creating empty zip');
        }
      } catch (err) {
        console.error('Error reading workspace directory:', err);
        // Continue anyway, we'll create an empty zip
      }
      
      // Set proper headers for download
      set.headers['Content-Type'] = 'application/zip';
      set.headers['Content-Disposition'] = `attachment; filename="${filename}"`;
      set.headers['X-File-Count'] = fileCount.toString();
      set.headers['X-Session-ID'] = SESSION_ID;
      
      // Create zip in memory using Node.js archiver
      return new Promise((resolve, reject) => {
        const archive = archiver('zip', {
          zlib: { level: 9 } // Sets the compression level
        });

        const chunks: Buffer[] = [];
        let hasError = false;

        archive.on('data', (chunk) => {
          chunks.push(chunk);
        });

        archive.on('end', () => {
          if (hasError) return; // Don't proceed if there was an error
          
          console.log(`Archive created: ${archive.pointer()} total bytes`);
          console.log(`Filename: ${filename}`);
          const buffer = Buffer.concat(chunks);
          console.log(`Final buffer size: ${buffer.length} bytes`);
          
          // Set final content length
          set.headers['Content-Length'] = buffer.length.toString();
          
          resolve(buffer);
        });

        archive.on('error', (err) => {
          hasError = true;
          console.error('Archive error:', err);
          reject(err);
        });

        archive.on('warning', (err) => {
          console.warn('Archive warning:', err);
        });

        // Add all files from workspace directory
        archive.glob('**/*', {
          cwd: WORKSPACE_DIR,
          dot: true // Include hidden files
        });

        console.log('Finalizing archive...');
        archive.finalize().catch((err) => {
          hasError = true;
          console.error('Error finalizing archive:', err);
          reject(err);
        });
      });
    } catch (error) {
      console.error('Download endpoint error:', error);
      throw error;
    }
  }, {
    response: {
      'application/octet-stream': 'File'
    }
  })
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

      server.tool('execute_command_async', {
        command: z.string().describe('Command to execute asynchronously (non-blocking), e.g, xterm (GUI applications)'),
        cwd: z.string().optional().describe('Working directory for the command')
      }, async (args) => {
        const result = await executeCommandAsync(args.command, args.cwd);
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

      // GUI Automation Tools
      server.tool('gui_click', {
        x: z.number().describe('X coordinate to click'),
        y: z.number().describe('Y coordinate to click')
      }, async (args) => {
        const result = await guiClick(args.x, args.y);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_type', {
        text: z.string().describe('Text to type')
      }, async (args) => {
        const result = await guiType(args.text);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_key', {
        key: z.string().describe('Key or key combination to send (e.g., "Return", "ctrl+c", "alt+Tab")')
      }, async (args) => {
        const result = await guiKey(args.key);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_screenshot', {}, async () => {
        const result = await guiScreenshot();
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_get_window_info', {}, async () => {
        const result = await guiGetWindowInfo();
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_find_window', {
        namePattern: z.string().describe('Pattern to search for in window names')
      }, async (args) => {
        const result = await guiFindWindow(args.namePattern);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('gui_activate_window', {
        windowId: z.string().describe('Window ID to activate')
      }, async (args) => {
        const result = await guiActivateWindow(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      // Process Management Tools
      server.tool('list_processes', {}, async () => {
        const result = await listProcesses();
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('kill_process', {
        pid: z.string().describe('Process ID to terminate')
      }, async (args) => {
        const result = await killProcess(args.pid);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      // Window Tiling Tools
      server.tool('move_window', {
        windowId: z.string().describe('Window ID to move'),
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate')
      }, async (args) => {
        const result = await moveWindow(args.windowId, args.x, args.y);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('resize_window', {
        windowId: z.string().describe('Window ID to resize'),
        width: z.number().describe('Window width'),
        height: z.number().describe('Window height')
      }, async (args) => {
        const result = await resizeWindow(args.windowId, args.width, args.height);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_left', {
        windowId: z.string().describe('Window ID to tile to left half')
      }, async (args) => {
        const result = await tileWindowLeft(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_right', {
        windowId: z.string().describe('Window ID to tile to right half')
      }, async (args) => {
        const result = await tileWindowRight(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_top_left', {
        windowId: z.string().describe('Window ID to tile to top-left quarter')
      }, async (args) => {
        const result = await tileWindowTopLeft(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_top_right', {
        windowId: z.string().describe('Window ID to tile to top-right quarter')
      }, async (args) => {
        const result = await tileWindowTopRight(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_bottom_left', {
        windowId: z.string().describe('Window ID to tile to bottom-left quarter')
      }, async (args) => {
        const result = await tileWindowBottomLeft(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('tile_window_bottom_right', {
        windowId: z.string().describe('Window ID to tile to bottom-right quarter')
      }, async (args) => {
        const result = await tileWindowBottomRight(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('minimize_window', {
        windowId: z.string().describe('Window ID to minimize')
      }, async (args) => {
        const result = await minimizeWindow(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      server.tool('center_window', {
        windowId: z.string().describe('Window ID to center on screen')
      }, async (args) => {
        const result = await centerWindow(args.windowId);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      console.log('MCP Server tools registered (including GUI automation, process management, and window tiling)');
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
/// <reference lib="dom" />

import { Elysia } from 'elysia';
import { mcp } from 'elysia-mcp';
import { z } from 'zod/v3';
import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { ToolServer } from '@/application/ports';

const PORT = process.env['MCP_PORT'] || 8080;
const WORKSPACE_DIR = '/home/developer/workspace';
const SESSION_ID = process.env['SESSION_ID'] || 'unknown';
const DISPLAY = process.env['DISPLAY'] || ':1';
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TOOL_OUTPUT_CHARS = 24000;
const MAX_PROCESS_LOG_CHARS = 200000;
const ARTIFACT_DIR = path.join(WORKSPACE_DIR, '.ottobot');
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, 'screenshots');

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; data: string; mimeType: string };
type ToolContent = TextContent | ImageContent;

type ManagedProcess = {
  id: string;
  name: string;
  command: string;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  startedAt: string;
  status: 'running' | 'exited';
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

const managedProcesses = new Map<string, ManagedProcess>();

function toolInputSchema<T extends Record<string, unknown>>(schema: T): any {
  return schema;
}

function textResult(text: string): { content: TextContent[] } {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function imageResult(text: string, data: string, mimeType = 'image/png'): { content: ToolContent[] } {
  return {
    content: [
      {
        type: 'text',
        text,
      },
      {
        type: 'image',
        data,
        mimeType,
      },
    ],
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function truncateText(value: string, maxLength = MAX_TOOL_OUTPUT_CHARS): string {
  if (value.length <= maxLength) return value;
  const omitted = value.length - maxLength;
  return `${value.slice(0, maxLength)}\n\n[truncated ${omitted} characters]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function displayEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY };
}

async function ensureArtifactDir(dirPath = ARTIFACT_DIR): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

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

async function readFileRange(filePath: string, startLine = 1, endLine?: number): Promise<string> {
  const fullPath = resolvePath(filePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    const start = clampNumber(Math.floor(startLine), 1, lines.length || 1);
    const end = clampNumber(Math.floor(endLine ?? start + 199), start, lines.length || start);
    const selected = lines
      .slice(start - 1, end)
      .map((line, index) => `${String(start + index).padStart(5, ' ')} | ${line}`)
      .join('\n');

    return `File content of ${filePath} lines ${start}-${end} of ${lines.length}:\n\n${selected}`;
  } catch (error) {
    throw new Error(`Failed to read file range ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function listTree(dirPath = '.', maxDepth = 3): Promise<string> {
  const fullPath = resolvePath(dirPath);
  const depth = clampNumber(Math.floor(maxDepth), 1, 8);

  try {
    const output = execFileSync('find', [
      fullPath,
      '-maxdepth',
      String(depth),
      '-not',
      '-path',
      '*/node_modules/*',
      '-not',
      '-path',
      '*/.git/*',
      '-print',
    ], {
      encoding: 'utf8',
      env: displayEnv(),
    });

    const normalized = output
      .split('\n')
      .filter(Boolean)
      .map((entry) => path.relative(WORKSPACE_DIR, entry) || '.')
      .sort()
      .slice(0, 500)
      .join('\n');

    return `Tree for ${dirPath} (max depth ${depth}):\n\n${normalized || '(empty)'}`;
  } catch (error) {
    throw new Error(`Failed to list tree ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function searchFiles(
  pattern: string,
  dirPath = '.',
  options: {
    glob?: string;
    contextLines?: number;
    maxResults?: number;
    fixedStrings?: boolean;
    ignoreCase?: boolean;
  } = {},
): Promise<string> {
  const fullPath = resolvePath(dirPath);
  const maxResults = clampNumber(Math.floor(options.maxResults ?? 100), 1, 500);
  const args = [
    '--line-number',
    '--color',
    'never',
    '--hidden',
    '--glob',
    '!node_modules',
    '--glob',
    '!dist',
    '--glob',
    '!.git',
    '--max-count',
    String(maxResults),
  ];

  if (options.fixedStrings) args.push('--fixed-strings');
  if (options.ignoreCase) args.push('--ignore-case');
  if (options.glob) args.push('--glob', options.glob);
  if (options.contextLines && options.contextLines > 0) {
    args.push('--context', String(clampNumber(Math.floor(options.contextLines), 0, 20)));
  }
  args.push(pattern, fullPath);

  try {
    const output = execFileSync('rg', args, {
      encoding: 'utf8',
      env: displayEnv(),
      maxBuffer: 1024 * 1024,
    });
    return `Search results for ${JSON.stringify(pattern)} in ${dirPath}:\n\n${truncateText(output)}`;
  } catch (error: any) {
    if (typeof error?.status === 'number' && error.status === 1) {
      return `No matches for ${JSON.stringify(pattern)} in ${dirPath}`;
    }
    throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function replaceInFile(
  filePath: string,
  oldText: string,
  newText: string,
  expectedOccurrences?: number,
): Promise<string> {
  if (!oldText) {
    throw new Error('oldText must not be empty');
  }

  const fullPath = resolvePath(filePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const occurrences = content.split(oldText).length - 1;

    if (occurrences === 0) {
      throw new Error('oldText was not found');
    }

    if (expectedOccurrences !== undefined && occurrences !== expectedOccurrences) {
      throw new Error(`expected ${expectedOccurrences} occurrence(s), found ${occurrences}`);
    }

    await fs.writeFile(fullPath, content.split(oldText).join(newText), 'utf-8');
    return `Replaced ${occurrences} occurrence(s) in ${filePath}`;
  } catch (error) {
    throw new Error(`Failed to replace text in ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function appendFile(filePath: string, content: string): Promise<string> {
  const fullPath = resolvePath(filePath);

  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.appendFile(fullPath, content, 'utf-8');
    return `Appended ${content.length} characters to ${filePath}`;
  } catch (error) {
    throw new Error(`Failed to append to file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function workspaceStatus(): Promise<string> {
  const checks: string[] = [];

  try {
    checks.push(`Workspace: ${WORKSPACE_DIR}`);
    checks.push(`Display: ${DISPLAY}`);
    checks.push(`Screen: ${safeJson(await getScreenResolution())}`);
  } catch {
    checks.push('Screen: unavailable');
  }

  for (const [label, command] of [
    ['Git', 'git status --short --branch'],
    ['Files', 'find . -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" | sort | sed -n "1,80p"'],
    ['Processes', 'ps -u developer -o pid,stat,pcpu,pmem,comm --no-headers | sed -n "1,40p"'],
  ] as const) {
    try {
      const output = execSync(command, {
        cwd: WORKSPACE_DIR,
        encoding: 'utf8',
        env: displayEnv(),
      }).trim();
      checks.push(`${label}:\n${output || '(none)'}`);
    } catch (error) {
      checks.push(`${label}: unavailable (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  return checks.join('\n\n');
}

async function executeCommand(command: string, cwd?: string, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<string> {
  const workingDir = cwd ? resolvePath(cwd) : WORKSPACE_DIR;
  const effectiveTimeoutMs = clampNumber(Math.floor(timeoutMs), 1000, MAX_COMMAND_TIMEOUT_MS);

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
        clearTimeout(timeout);
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
          resolve(truncateText(output));
        } else {
          reject(new Error(`Command failed with exit code ${code}:\n${truncateText(output)}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to execute command: ${error.message}`));
      });

      // Set timeout for long-running commands
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timeout after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);
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

function appendProcessOutput(processInfo: ManagedProcess, stream: 'stdout' | 'stderr', chunk: string): void {
  processInfo[stream] += chunk;
  if (processInfo[stream].length > MAX_PROCESS_LOG_CHARS) {
    processInfo[stream] = processInfo[stream].slice(-MAX_PROCESS_LOG_CHARS);
  }
}

async function startManagedProcess(command: string, cwd?: string, name?: string): Promise<string> {
  const workingDir = cwd ? resolvePath(cwd) : WORKSPACE_DIR;
  const id = `proc-${crypto.randomUUID()}`;
  const processName = name?.trim() || command.slice(0, 60);
  const child = spawn('bash', ['-lc', command], {
    cwd: workingDir,
    stdio: 'pipe',
    env: displayEnv(),
  });

  const processInfo: ManagedProcess = {
    id,
    name: processName,
    command,
    cwd: workingDir,
    child,
    stdout: '',
    stderr: '',
    startedAt: new Date().toISOString(),
    status: 'running',
  };

  child.stdout.on('data', (data) => appendProcessOutput(processInfo, 'stdout', data.toString()));
  child.stderr.on('data', (data) => appendProcessOutput(processInfo, 'stderr', data.toString()));
  child.on('close', (code, signal) => {
    processInfo.status = 'exited';
    processInfo.exitCode = code;
    processInfo.signal = signal;
  });
  child.on('error', (error) => {
    appendProcessOutput(processInfo, 'stderr', `\n[process error] ${error.message}\n`);
  });

  managedProcesses.set(id, processInfo);

  return [
    `Started process ${id}`,
    `Name: ${processName}`,
    `PID: ${child.pid ?? 'unknown'}`,
    `Command: ${command}`,
    `Working directory: ${workingDir}`,
  ].join('\n');
}

async function listManagedProcesses(): Promise<string> {
  if (managedProcesses.size === 0) {
    return 'No managed background processes';
  }

  const rows = Array.from(managedProcesses.values()).map((processInfo) => [
    processInfo.id,
    processInfo.status,
    String(processInfo.child.pid ?? ''),
    processInfo.name,
    processInfo.command,
  ].join('\t'));

  return `Managed processes:\nID\tSTATUS\tPID\tNAME\tCOMMAND\n${rows.join('\n')}`;
}

async function readManagedProcess(processId: string, maxChars = 12000): Promise<string> {
  const processInfo = managedProcesses.get(processId);
  if (!processInfo) {
    throw new Error(`Unknown managed process: ${processId}`);
  }

  const limit = clampNumber(Math.floor(maxChars), 1000, MAX_TOOL_OUTPUT_CHARS);
  const output = [
    `Process: ${processInfo.id}`,
    `Name: ${processInfo.name}`,
    `Status: ${processInfo.status}`,
    `PID: ${processInfo.child.pid ?? 'unknown'}`,
    `Started: ${processInfo.startedAt}`,
    `Exit: ${processInfo.exitCode ?? ''}${processInfo.signal ? ` signal=${processInfo.signal}` : ''}`,
    '',
    'STDOUT:',
    processInfo.stdout.slice(-limit) || '(no stdout yet)',
    '',
    'STDERR:',
    processInfo.stderr.slice(-limit) || '(no stderr yet)',
  ].join('\n');

  return truncateText(output);
}

async function stopManagedProcess(processId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<string> {
  const processInfo = managedProcesses.get(processId);
  if (!processInfo) {
    throw new Error(`Unknown managed process: ${processId}`);
  }

  if (processInfo.status === 'exited') {
    return `Process ${processId} already exited with code ${processInfo.exitCode ?? 'unknown'}`;
  }

  processInfo.child.kill(signal);
  return `Sent ${signal} to process ${processId}`;
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

async function computerScreenshot(name?: string): Promise<{ path: string; data: string }> {
  try {
    await ensureArtifactDir(SCREENSHOT_DIR);
    const safeName = name ? name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) : `screen-${Date.now()}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${safeName.endsWith('.png') ? safeName : `${safeName}.png`}`);

    execFileSync('scrot', [screenshotPath], {
      env: displayEnv(),
    });

    const image = await fs.readFile(screenshotPath);
    return {
      path: screenshotPath,
      data: image.toString('base64'),
    };
  } catch (error) {
    throw new Error(`Failed to capture computer screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerClick(
  x: number,
  y: number,
  options: { button?: 'left' | 'middle' | 'right'; double?: boolean } = {},
): Promise<string> {
  const button = options.button === 'right' ? '3' : options.button === 'middle' ? '2' : '1';
  try {
    execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))], { env: displayEnv() });
    execFileSync('xdotool', ['click', ...(options.double ? ['--repeat', '2', '--delay', '120'] : []), button], {
      env: displayEnv(),
    });
    return `${options.double ? 'Double-clicked' : 'Clicked'} ${options.button ?? 'left'} at (${x}, ${y})`;
  } catch (error) {
    throw new Error(`Computer click failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerMove(x: number, y: number): Promise<string> {
  try {
    execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))], { env: displayEnv() });
    return `Moved pointer to (${x}, ${y})`;
  } catch (error) {
    throw new Error(`Computer move failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<string> {
  try {
    execFileSync('xdotool', ['mousemove', String(Math.round(fromX)), String(Math.round(fromY)), 'mousedown', '1'], {
      env: displayEnv(),
    });
    execFileSync('xdotool', ['mousemove', '--sync', String(Math.round(toX)), String(Math.round(toY)), 'mouseup', '1'], {
      env: displayEnv(),
    });
    return `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`;
  } catch (error) {
    throw new Error(`Computer drag failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerScroll(deltaY: number, deltaX = 0): Promise<string> {
  try {
    const verticalClicks = deltaY === 0 ? 0 : clampNumber(Math.ceil(Math.abs(deltaY) / 400), 1, 30);
    const horizontalClicks = deltaX === 0 ? 0 : clampNumber(Math.ceil(Math.abs(deltaX) / 400), 1, 30);
    const verticalButton = deltaY >= 0 ? '5' : '4';
    const horizontalButton = deltaX >= 0 ? '7' : '6';

    for (let i = 0; i < verticalClicks; i += 1) {
      execFileSync('xdotool', ['click', verticalButton], { env: displayEnv() });
    }

    for (let i = 0; i < horizontalClicks; i += 1) {
      execFileSync('xdotool', ['click', horizontalButton], { env: displayEnv() });
    }

    return `Scrolled deltaY=${deltaY}, deltaX=${deltaX}`;
  } catch (error) {
    throw new Error(`Computer scroll failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerType(text: string, delayMs = 0): Promise<string> {
  try {
    execFileSync('xdotool', ['type', '--delay', String(clampNumber(Math.floor(delayMs), 0, 1000)), text], {
      env: displayEnv(),
    });
    return `Typed ${text.length} characters`;
  } catch (error) {
    throw new Error(`Computer type failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerKey(key: string): Promise<string> {
  try {
    execFileSync('xdotool', ['key', key], {
      env: displayEnv(),
    });
    return `Pressed key: ${key}`;
  } catch (error) {
    throw new Error(`Computer key failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function computerWait(ms = 1000): Promise<string> {
  const waitMs = clampNumber(Math.floor(ms), 100, 30000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return `Waited ${waitMs}ms`;
}

async function computerListWindows(): Promise<string> {
  try {
    const output = execFileSync('wmctrl', ['-lG'], {
      env: displayEnv(),
      encoding: 'utf8',
    }).trim();

    return `Visible windows:\n${output || '(none)'}`;
  } catch (error) {
    try {
      const output = execSync('xdotool search --onlyvisible --name ".*" 2>/dev/null | while read id; do echo "$id $(xdotool getwindowname "$id")"; done', {
        env: displayEnv(),
        encoding: 'utf8',
      }).trim();
      return `Visible windows:\n${output || '(none)'}`;
    } catch {
      throw new Error(`Failed to list windows: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

async function computerScreenState(): Promise<string> {
  const screen = await getScreenResolution();
  let activeWindow = '(unavailable)';
  let windows = '(unavailable)';

  try {
    activeWindow = await guiGetWindowInfo();
  } catch {
    // Keep best-effort screen state useful even without an active window.
  }

  try {
    windows = await computerListWindows();
  } catch {
    // Keep best-effort screen state useful even if wmctrl is absent.
  }

  return [
    `Display: ${DISPLAY}`,
    `Resolution: ${screen.width}x${screen.height}`,
    '',
    activeWindow,
    '',
    windows,
  ].join('\n');
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
        const pid = parts[1] ?? '';
        const cpu = parts[2] ?? '';
        const mem = parts[3] ?? '';
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
        width: parseInt(match[1] ?? '1920', 10),
        height: parseInt(match[2] ?? '1080', 10)
      };
    }
    
    // Fallback to the default sandbox desktop resolution.
    return { width: 1440, height: 900 };
  } catch (error) {
    // Fallback resolution
    return { width: 1440, height: 900 };
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
      windowWidth = parseInt(match[1] ?? '800', 10);
      windowHeight = parseInt(match[2] ?? '600', 10);
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

function createMcpApp() {
  return new Elysia()
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
      const registerTool = (
        name: string,
        schema: Record<string, unknown>,
        handler: (args: any) => unknown | Promise<unknown>,
        description?: string,
      ) => {
        if (description) {
          (server.tool as any)(name, description, schema, handler);
          return;
        }

        (server.tool as any)(name, schema, handler);
      };

      // Register tools using the MCP Server API (without description parameter)
      registerTool('read_file', toolInputSchema({
        path: z.string().describe('Path to the file to read')
      }), async (args) => {
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

      registerTool('write_file', toolInputSchema({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file')
      }), async (args) => {
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

      registerTool('list_files', toolInputSchema({
        path: z.string().optional().describe('Path to list (defaults to current directory)')
      }), async (args) => {
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

      registerTool('read_file_range', toolInputSchema({
        path: z.string().describe('Path to the file to read'),
        startLine: z.number().optional().describe('1-based start line'),
        endLine: z.number().optional().describe('1-based end line')
      }), async (args) => {
        return textResult(await readFileRange(args.path, args.startLine, args.endLine));
      });

      registerTool('list_tree', toolInputSchema({
        path: z.string().optional().describe('Path to list recursively (defaults to current directory)'),
        maxDepth: z.number().optional().describe('Maximum directory depth, clamped to 1-8')
      }), async (args) => {
        return textResult(await listTree(args.path, args.maxDepth));
      });

      registerTool('search_files', toolInputSchema({
        pattern: z.string().describe('Search pattern for ripgrep'),
        path: z.string().optional().describe('Directory to search (defaults to current directory)'),
        glob: z.string().optional().describe('Optional ripgrep glob, for example *.ts'),
        contextLines: z.number().optional().describe('Context lines around each match'),
        maxResults: z.number().optional().describe('Maximum results, clamped to 1-500'),
        fixedStrings: z.boolean().optional().describe('Treat the pattern as a literal string'),
        ignoreCase: z.boolean().optional().describe('Case-insensitive search')
      }), async (args) => {
        return textResult(await searchFiles(args.pattern, args.path, {
          glob: args.glob,
          contextLines: args.contextLines,
          maxResults: args.maxResults,
          fixedStrings: args.fixedStrings,
          ignoreCase: args.ignoreCase,
        }));
      });

      registerTool('replace_in_file', toolInputSchema({
        path: z.string().describe('Path to the file to edit'),
        oldText: z.string().describe('Exact text to replace'),
        newText: z.string().describe('Replacement text'),
        expectedOccurrences: z.number().optional().describe('Optional exact occurrence count guard')
      }), async (args) => {
        return textResult(await replaceInFile(args.path, args.oldText, args.newText, args.expectedOccurrences));
      });

      registerTool('append_file', toolInputSchema({
        path: z.string().describe('Path to the file to append'),
        content: z.string().describe('Content to append')
      }), async (args) => {
        return textResult(await appendFile(args.path, args.content));
      });

      registerTool('workspace_status', {}, async () => {
        return textResult(await workspaceStatus());
      });

      registerTool('execute_command', toolInputSchema({
        command: z.string().describe('Command to execute'),
        cwd: z.string().optional().describe('Working directory for the command'),
        timeoutMs: z.number().optional().describe('Timeout in milliseconds, clamped to 1s-10m')
      }), async (args) => {
        const result = await executeCommand(args.command, args.cwd, args.timeoutMs);
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      });

      registerTool('execute_command_async', toolInputSchema({
        command: z.string().describe('Command to execute asynchronously (non-blocking), e.g, xterm (GUI applications)'),
        cwd: z.string().optional().describe('Working directory for the command')
      }), async (args) => {
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

      registerTool('start_process', toolInputSchema({
        command: z.string().describe('Command to run as a managed background process'),
        cwd: z.string().optional().describe('Working directory for the command'),
        name: z.string().optional().describe('Human-readable process name')
      }), async (args) => {
        return textResult(await startManagedProcess(args.command, args.cwd, args.name));
      });

      registerTool('list_managed_processes', {}, async () => {
        return textResult(await listManagedProcesses());
      });

      registerTool('read_process', toolInputSchema({
        processId: z.string().describe('Managed process id returned by start_process'),
        maxChars: z.number().optional().describe('Maximum stdout/stderr characters to return')
      }), async (args) => {
        return textResult(await readManagedProcess(args.processId, args.maxChars));
      });

      registerTool('stop_process', toolInputSchema({
        processId: z.string().describe('Managed process id returned by start_process'),
        signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).optional().describe('Signal to send')
      }), async (args) => {
        return textResult(await stopManagedProcess(args.processId, args.signal));
      });

      registerTool('create_directory', toolInputSchema({
        path: z.string().describe('Path of the directory to create')
      }), async (args) => {
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

      registerTool('delete_file', toolInputSchema({
        path: z.string().describe('Path of the file or directory to delete')
      }), async (args) => {
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

      registerTool('open_vscode', toolInputSchema({
        path: z.string().describe('Path to open in VS Code')
      }), async (args) => {
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
      registerTool('gui_click', toolInputSchema({
        x: z.number().describe('X coordinate to click'),
        y: z.number().describe('Y coordinate to click')
      }), async (args) => {
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

      registerTool('gui_type', toolInputSchema({
        text: z.string().describe('Text to type')
      }), async (args) => {
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

      registerTool('gui_key', toolInputSchema({
        key: z.string().describe('Key or key combination to send (e.g., "Return", "ctrl+c", "alt+Tab")')
      }), async (args) => {
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

      registerTool('gui_screenshot', {}, async () => {
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

      registerTool('computer_screenshot', toolInputSchema({
        name: z.string().optional().describe('Optional screenshot filename')
      }), async (args) => {
        const result = await computerScreenshot(args.name);
        return imageResult(`Screenshot saved to ${result.path}`, result.data);
      });

      registerTool('computer_click', toolInputSchema({
        x: z.number().describe('X coordinate to click'),
        y: z.number().describe('Y coordinate to click'),
        button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button'),
        double: z.boolean().optional().describe('Double-click when true')
      }), async (args) => {
        return textResult(await computerClick(args.x, args.y, {
          button: args.button,
          double: args.double,
        }));
      });

      registerTool('computer_move', toolInputSchema({
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate')
      }), async (args) => {
        return textResult(await computerMove(args.x, args.y));
      });

      registerTool('computer_drag', toolInputSchema({
        fromX: z.number().describe('Start X coordinate'),
        fromY: z.number().describe('Start Y coordinate'),
        toX: z.number().describe('End X coordinate'),
        toY: z.number().describe('End Y coordinate')
      }), async (args) => {
        return textResult(await computerDrag(args.fromX, args.fromY, args.toX, args.toY));
      });

      registerTool('computer_scroll', toolInputSchema({
        deltaY: z.number().describe('Vertical scroll delta'),
        deltaX: z.number().optional().describe('Horizontal scroll delta')
      }), async (args) => {
        return textResult(await computerScroll(args.deltaY, args.deltaX));
      });

      registerTool('computer_type', toolInputSchema({
        text: z.string().describe('Text to type'),
        delayMs: z.number().optional().describe('Delay between key events')
      }), async (args) => {
        return textResult(await computerType(args.text, args.delayMs));
      });

      registerTool('computer_key', toolInputSchema({
        key: z.string().describe('Key or key combination to send')
      }), async (args) => {
        return textResult(await computerKey(args.key));
      });

      registerTool('computer_wait', toolInputSchema({
        ms: z.number().optional().describe('Milliseconds to wait')
      }), async (args) => {
        return textResult(await computerWait(args.ms));
      });

      registerTool('computer_screen_state', {}, async () => {
        return textResult(await computerScreenState());
      });

      registerTool('gui_get_window_info', {}, async () => {
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

      registerTool('gui_find_window', toolInputSchema({
        namePattern: z.string().describe('Pattern to search for in window names')
      }), async (args) => {
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

      registerTool('gui_activate_window', toolInputSchema({
        windowId: z.string().describe('Window ID to activate')
      }), async (args) => {
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
      registerTool('list_processes', {}, async () => {
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

      registerTool('kill_process', toolInputSchema({
        pid: z.string().describe('Process ID to terminate')
      }), async (args) => {
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
      registerTool('move_window', toolInputSchema({
        windowId: z.string().describe('Window ID to move'),
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate')
      }), async (args) => {
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

      registerTool('resize_window', toolInputSchema({
        windowId: z.string().describe('Window ID to resize'),
        width: z.number().describe('Window width'),
        height: z.number().describe('Window height')
      }), async (args) => {
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

      registerTool('tile_window_left', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to left half')
      }), async (args) => {
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

      registerTool('tile_window_right', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to right half')
      }), async (args) => {
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

      registerTool('tile_window_top_left', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to top-left quarter')
      }), async (args) => {
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

      registerTool('tile_window_top_right', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to top-right quarter')
      }), async (args) => {
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

      registerTool('tile_window_bottom_left', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to bottom-left quarter')
      }), async (args) => {
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

      registerTool('tile_window_bottom_right', toolInputSchema({
        windowId: z.string().describe('Window ID to tile to bottom-right quarter')
      }), async (args) => {
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

      registerTool('minimize_window', toolInputSchema({
        windowId: z.string().describe('Window ID to minimize')
      }), async (args) => {
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

      registerTool('center_window', toolInputSchema({
        windowId: z.string().describe('Window ID to center on screen')
      }), async (args) => {
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

      registerTool('computer_list_windows', {}, async () => {
        return textResult(await computerListWindows());
      }, 'List visible windows in the sandbox desktop.');

      console.log('MCP Server tools registered (filesystem, shell, managed processes, computer, and window tools)');
    }
  }));
}

export class ElysiaMcpToolServer implements ToolServer {
  private app?: ReturnType<ReturnType<typeof createMcpApp>['listen']>;
  private registered = false;

  registerTools(): void {
    this.registered = true;
  }

  listen(port: number): void {
    if (!this.registered) {
      this.registerTools();
    }

    this.app = createMcpApp().listen(port);
  }

  async shutdown(): Promise<void> {
    this.app?.stop();
  }
}

const toolServer = new ElysiaMcpToolServer();
toolServer.registerTools();
toolServer.listen(Number(PORT));

console.log(`MCP Server listening on port ${PORT}`);

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await toolServer.shutdown();
  console.log('Server shutdown complete');
  process.exit(0);
});

/// <reference lib="dom" />

import { promises as fs } from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const WORKSPACE_DIR = '/home/developer/workspace';
const DISPLAY = process.env['DISPLAY'] || ':1';
const ARTIFACT_DIR = path.join(WORKSPACE_DIR, '.ottobot');
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, 'screenshots');
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_LOG_EVENTS = 200;
const MAX_STATE_TEXT_CHARS = 6000;

type BrowserRuntime = {
  browser: Browser;
  context: BrowserContext;
  pages: Page[];
  activeIndex: number;
};

type BrowserElement = {
  index: number;
  selector: string;
  tag: string;
  role: string | null;
  label: string;
  text: string;
  value: string;
  href: string | null;
  visible: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
};

type ConsoleEvent = {
  type: string;
  text: string;
  location: string;
  timestamp: string;
};

type NetworkEvent = {
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  failure?: string;
  timestamp: string;
};

let runtime: BrowserRuntime | undefined;
let consoleEvents: ConsoleEvent[] = [];
let networkEvents: NetworkEvent[] = [];

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function truncateText(value: string, maxLength = MAX_STATE_TEXT_CHARS): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} characters]`;
}

function pushBounded<T>(events: T[], event: T): T[] {
  const next = [...events, event];
  return next.length > MAX_LOG_EVENTS ? next.slice(next.length - MAX_LOG_EVENTS) : next;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function displayEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DISPLAY };
}

async function ensureScreenshotDir(): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

function pageRuntimePages(context: BrowserContext): Page[] {
  const pages = context.pages();
  return pages.length > 0 ? pages : [];
}

function trackPage(page: Page): void {
  page.on('console', (message) => {
    consoleEvents = pushBounded(consoleEvents, {
      type: message.type(),
      text: message.text(),
      location: `${message.location().url || 'unknown'}:${message.location().lineNumber || 0}`,
      timestamp: new Date().toISOString(),
    });
  });

  page.on('request', (request) => {
    networkEvents = pushBounded(networkEvents, {
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('response', (response) => {
    const request = response.request();
    networkEvents = pushBounded(networkEvents, {
      method: request.method(),
      url: response.url(),
      resourceType: request.resourceType(),
      status: response.status(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('requestfailed', (request) => {
    networkEvents = pushBounded(networkEvents, {
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || 'request failed',
      timestamp: new Date().toISOString(),
    });
  });
}

async function getRuntime(): Promise<BrowserRuntime> {
  if (runtime?.browser.isConnected()) {
    runtime.pages = pageRuntimePages(runtime.context);
    if (runtime.pages.length === 0) {
      const page = await runtime.context.newPage();
      trackPage(page);
      runtime.pages = [page];
      runtime.activeIndex = 0;
    }
    runtime.activeIndex = clampNumber(runtime.activeIndex, 0, runtime.pages.length - 1);
    return runtime;
  }

  const browser = await chromium.launch({
    headless: process.env['PLAYWRIGHT_HEADLESS'] === '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: displayEnv(),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  trackPage(page);

  runtime = {
    browser,
    context,
    pages: [page],
    activeIndex: 0,
  };

  return runtime;
}

export async function getActiveBrowserPage(): Promise<Page> {
  const current = await getRuntime();
  current.pages = pageRuntimePages(current.context);
  if (current.pages.length === 0) {
    const page = await current.context.newPage();
    trackPage(page);
    current.pages = [page];
    current.activeIndex = 0;
  }

  current.activeIndex = clampNumber(current.activeIndex, 0, current.pages.length - 1);
  const page = current.pages[current.activeIndex];
  if (!page) throw new Error('No active browser page');
  return page;
}

async function getElements(page: Page, limit = 80): Promise<BrowserElement[]> {
  return page.evaluate((maxElements) => {
    const selectorParts = (element: Element): string => {
      const cssEscape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
      if (element.id) return `#${cssEscape(element.id)}`;

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }

        const currentTag = current.tagName;
        const siblings = (Array.from(parent.children) as Element[])
          .filter((sibling: Element) => sibling.tagName === currentTag);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }

      return parts.join(' > ');
    };

    const candidates = Array.from(document.querySelectorAll([
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[contenteditable="true"]',
      '[onclick]',
    ].join(',')));

    return candidates
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visible = rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number(style.opacity || '1') > 0;
        const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const anchor = element as HTMLAnchorElement;
        const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.placeholder
          : '';
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        const label = [
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          input.name || '',
          placeholder,
        ].filter(Boolean).join(' | ');

        return {
          index,
          selector: selectorParts(element),
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          label,
          text: text.slice(0, 160),
          value: input.value || '',
          href: anchor.href || null,
          visible,
          box: visible
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null,
        };
      })
      .filter((element) => element.visible)
      .slice(0, maxElements);
  }, limit);
}

function formatElements(elements: BrowserElement[]): string {
  if (elements.length === 0) return '(no visible interactive elements found)';
  return elements
    .map((element) => {
      const label = element.label || element.text || element.value || element.href || '(unlabeled)';
      const box = element.box
        ? ` @ ${element.box.x},${element.box.y} ${element.box.width}x${element.box.height}`
        : '';
      return `[${element.index}] ${element.tag}${element.role ? ` role=${element.role}` : ''} ${label}${box}`;
    })
    .join('\n');
}

async function resolveLocator(page: Page, target: {
  selector?: string;
  index?: number;
  text?: string;
  label?: string;
}) {
  if (target.selector) return page.locator(target.selector).first();
  if (typeof target.index === 'number') {
    const elements = await getElements(page);
    const element = elements.find((candidate) => candidate.index === target.index);
    if (!element) throw new Error(`No visible browser element with index ${target.index}`);
    return page.locator(element.selector).first();
  }
  if (target.label) return page.getByLabel(target.label).first();
  if (target.text) return page.getByText(target.text, { exact: false }).first();
  throw new Error('Provide selector, index, text, or label');
}

export async function browserNavigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded'): Promise<string> {
  const page = await getActiveBrowserPage();
  await page.goto(url, { waitUntil, timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserBack(): Promise<string> {
  const page = await getActiveBrowserPage();
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserForward(): Promise<string> {
  const page = await getActiveBrowserPage();
  await page.goForward({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserGetState(): Promise<string> {
  const page = await getActiveBrowserPage();
  const [title, url, elements, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    Promise.resolve(page.url()),
    getElements(page).catch(() => []),
    page.locator('body').innerText({ timeout: 1500 }).catch(() => ''),
  ]);

  return [
    `URL: ${url}`,
    `Title: ${title || '(untitled)'}`,
    '',
    'Visible interactive elements:',
    formatElements(elements),
    '',
    'Page text excerpt:',
    truncateText(bodyText || '(no body text)'),
  ].join('\n');
}

export async function browserClick(options: {
  selector?: string;
  index?: number;
  text?: string;
  label?: string;
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const locator = await resolveLocator(page, options);
  const timeout = clampNumber(Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1000, 120000);
  if (options.double) {
    await locator.dblclick({ button: options.button ?? 'left', timeout });
  } else {
    await locator.click({ button: options.button ?? 'left', timeout });
  }
  return browserGetState();
}

export async function browserHover(options: {
  selector?: string;
  index?: number;
  text?: string;
  label?: string;
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const locator = await resolveLocator(page, options);
  await locator.hover({ timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserDrag(options: {
  fromSelector?: string;
  fromIndex?: number;
  toSelector?: string;
  toIndex?: number;
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const from = await resolveLocator(page, { selector: options.fromSelector, index: options.fromIndex });
  const to = await resolveLocator(page, { selector: options.toSelector, index: options.toIndex });
  await from.dragTo(to, { timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserType(options: {
  text: string;
  selector?: string;
  index?: number;
  label?: string;
  clear?: boolean;
  delayMs?: number;
  submit?: boolean;
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const locator = await resolveLocator(page, options);
  if (options.clear) {
    await locator.fill(options.text, { timeout: DEFAULT_TIMEOUT_MS });
  } else {
    await locator.click({ timeout: DEFAULT_TIMEOUT_MS });
    await locator.type(options.text, { delay: clampNumber(options.delayMs ?? 0, 0, 1000) });
  }
  if (options.submit) await page.keyboard.press('Enter');
  return browserGetState();
}

export async function browserFillForm(fields: Array<{
  selector?: string;
  index?: number;
  label?: string;
  value: string;
}>): Promise<string> {
  const page = await getActiveBrowserPage();
  for (const field of fields) {
    const locator = await resolveLocator(page, field);
    await locator.fill(field.value, { timeout: DEFAULT_TIMEOUT_MS });
  }
  return browserGetState();
}

export async function browserSelectOption(options: {
  selector?: string;
  index?: number;
  label?: string;
  value: string | string[];
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const locator = await resolveLocator(page, options);
  await locator.selectOption(options.value, { timeout: DEFAULT_TIMEOUT_MS });
  return browserGetState();
}

export async function browserPressKey(key: string): Promise<string> {
  const page = await getActiveBrowserPage();
  await page.keyboard.press(key);
  return browserGetState();
}

export async function browserWaitFor(options: {
  selector?: string;
  text?: string;
  url?: string;
  timeMs?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeoutMs?: number;
}): Promise<string> {
  const page = await getActiveBrowserPage();
  const timeout = clampNumber(Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1000, 120000);
  if (options.timeMs) await page.waitForTimeout(clampNumber(Math.floor(options.timeMs), 1, 120000));
  if (options.selector) await page.locator(options.selector).waitFor({ state: options.state ?? 'visible', timeout });
  if (options.text) await page.getByText(options.text, { exact: false }).waitFor({ timeout });
  if (options.url) await page.waitForURL(options.url, { timeout });
  return browserGetState();
}

export async function browserScreenshot(name?: string, fullPage = true): Promise<{ path: string; data: string }> {
  await ensureScreenshotDir();
  const page = await getActiveBrowserPage();
  const filename = name?.endsWith('.png') ? name : `${name || `browser-${Date.now()}`}.png`;
  const screenshotPath = path.join(SCREENSHOT_DIR, path.basename(filename));
  const buffer = await page.screenshot({ path: screenshotPath, fullPage });
  return {
    path: screenshotPath,
    data: buffer.toString('base64'),
  };
}

export async function browserExtractContent(options: {
  selector?: string;
  maxChars?: number;
} = {}): Promise<string> {
  const page = await getActiveBrowserPage();
  const text = options.selector
    ? await page.locator(options.selector).innerText({ timeout: DEFAULT_TIMEOUT_MS })
    : await page.locator('body').innerText({ timeout: DEFAULT_TIMEOUT_MS });
  return truncateText(text, clampNumber(Math.floor(options.maxChars ?? 12000), 100, 50000));
}

export async function browserEvaluate(script: string): Promise<string> {
  const page = await getActiveBrowserPage();
  const result = await page.evaluate((source) => {
    const evaluator = new Function(`return (${source})`);
    return evaluator();
  }, script);
  return JSON.stringify(result, null, 2);
}

export async function browserRunPlaywright(script: string): Promise<string> {
  const current = await getRuntime();
  const page = await getActiveBrowserPage();
  const runner = new Function(
    'page',
    'context',
    'browser',
    `return (async () => {\n${script}\n})()`,
  ) as (page: Page, context: BrowserContext, browser: Browser) => Promise<unknown>;

  try {
    const result = await runner(page, current.context, current.browser);
    return typeof result === 'undefined' ? 'Playwright script completed.' : JSON.stringify(result, null, 2);
  } catch (error) {
    throw new Error(`Playwright script failed: ${describeError(error)}`);
  }
}

export async function browserConsoleMessages(limit = 50): Promise<string> {
  const count = clampNumber(Math.floor(limit), 1, MAX_LOG_EVENTS);
  const events = consoleEvents.slice(-count);
  return events.length === 0 ? '(no console messages)' : JSON.stringify(events, null, 2);
}

export async function browserNetworkRequests(limit = 80): Promise<string> {
  const count = clampNumber(Math.floor(limit), 1, MAX_LOG_EVENTS);
  const events = networkEvents.slice(-count);
  return events.length === 0 ? '(no network events)' : JSON.stringify(events, null, 2);
}

export async function browserTabs(options: {
  action: 'list' | 'new' | 'select' | 'close';
  index?: number;
  url?: string;
}): Promise<string> {
  const current = await getRuntime();
  current.pages = pageRuntimePages(current.context);

  if (options.action === 'new') {
    const page = await current.context.newPage();
    trackPage(page);
    current.pages = pageRuntimePages(current.context);
    current.activeIndex = current.pages.indexOf(page);
    if (options.url) await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    return browserGetState();
  }

  if (options.action === 'select') {
    if (typeof options.index !== 'number') throw new Error('index is required for tab selection');
    current.activeIndex = clampNumber(Math.floor(options.index), 0, current.pages.length - 1);
    return browserGetState();
  }

  if (options.action === 'close') {
    if (typeof options.index !== 'number') throw new Error('index is required for tab close');
    const page = current.pages[options.index];
    if (!page) throw new Error(`No browser tab at index ${options.index}`);
    await page.close();
    current.pages = pageRuntimePages(current.context);
    current.activeIndex = clampNumber(current.activeIndex, 0, Math.max(0, current.pages.length - 1));
    return browserTabs({ action: 'list' });
  }

  const tabLines = current.pages.map((page, index) => {
    const marker = index === current.activeIndex ? '*' : ' ';
    return `${marker} [${index}] ${page.url()}`;
  });
  return tabLines.length === 0 ? '(no browser tabs)' : tabLines.join('\n');
}

export async function browserResize(width: number, height: number): Promise<string> {
  const page = await getActiveBrowserPage();
  const safeWidth = clampNumber(Math.floor(width), 320, 3840);
  const safeHeight = clampNumber(Math.floor(height), 240, 2160);
  await page.setViewportSize({ width: safeWidth, height: safeHeight });
  return browserGetState();
}

export async function browserClose(): Promise<string> {
  if (!runtime) return 'Browser is not running.';
  await runtime.browser.close();
  runtime = undefined;
  consoleEvents = [];
  networkEvents = [];
  return 'Browser closed.';
}

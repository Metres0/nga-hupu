import { chromium, Browser, Page } from "playwright";

const UA_DEFAULTS = [
  "Nga_Official/9.9.9 (iPhone; iOS 18.0; Scale/3.00)",
  "Nga_Official/9.9.9 (iPhone; iOS 17.5; Scale/3.00)",
  "Nga_Official/9.9.9 (iPad; OS 18.0; Scale/2.00)",
];

function getUA(): string {
  const envUA = process.env.NGA_MOBILE_UA;
  if (envUA) return envUA;
  return UA_DEFAULTS[Math.floor(Math.random() * UA_DEFAULTS.length)];
}

let browser: Browser | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT = 5 * 60 * 1000;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return browser;
}

export function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    console.log("[Browser] 5 minute idle timeout, closing...");
    await closeBrowser();
  }, IDLE_TIMEOUT);
}

export async function newPage(cookieStr?: string): Promise<Page> {
  resetIdleTimer();
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: getUA(),
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  if (cookieStr) {
    await ctx.addCookies(
      cookieStr.split("; ").filter(Boolean).map((pair) => {
        const [name, ...rest] = pair.split("=");
        return { name, value: rest.join("="), domain: ".nga.cn", path: "/" };
      })
    );
  }

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await ctx.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "font" || type === "media" || type === "websocket" || type === "manifest") route.abort();
    else route.continue();
  });

  return ctx.newPage();
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function newDesktopPage(cookieStr?: string): Promise<import("playwright").Page> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: DESKTOP_UA,
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });

  if (cookieStr) {
    await ctx.addCookies(
      cookieStr.split("; ").filter(Boolean).map((pair) => {
        const [name, ...rest] = pair.split("=");
        return { name, value: rest.join("="), domain: ".nga.cn", path: "/" };
      })
    );
  }

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await ctx.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "font" || type === "media" || type === "websocket" || type === "manifest") route.abort();
    else route.continue();
  });

  return ctx.newPage();
}

export async function closeBrowser() {
  if (idleTimer) clearTimeout(idleTimer);
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function skipAdIfPresent(page: Page): Promise<boolean> {
  try {
    const skipLink = page.locator('a:has-text("跳过")').first();
    if ((await skipLink.count()) > 0) {
      const href = await skipLink.getAttribute("href");
      if (href) {
        console.log(`[AdSkip] 跳过广告 -> ${href}`);
        await page.goto(href, { waitUntil: "networkidle", timeout: 15000 });
        return true;
      }
    }
    const skipBtn = page.locator('a:has-text("此链接")').first();
    if ((await skipBtn.count()) > 0) {
      const href = await skipBtn.getAttribute("href");
      if (href) {
        console.log(`[AdSkip] 跳过广告 -> ${href}`);
        await page.goto(href, { waitUntil: "networkidle", timeout: 15000 });
        return true;
      }
    }
  } catch {}
  return false;
}

if (typeof process !== "undefined") {
  const cleanup = async () => {
    if (browser) {
      try { await browser.close(); } catch {}
      browser = null;
    }
  };
  process.on("exit", () => { if (browser) { try { browser.close(); } catch {} } });
  process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
  process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
  process.on("uncaughtException", async () => { await cleanup(); process.exit(1); });
}

export { getUA };

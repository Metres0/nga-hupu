import { BrowserContext, Page } from "playwright";
import { newPage, newDesktopPage } from "@/lib/scraper/browser";
import { resetIdleTimer } from "@/lib/scraper/browser";
import { createSession } from "./session-store";
import { storeCredential } from "./credential-store";

interface LoginResult {
  success: boolean;
  username?: string;
  captcha?: string;
  sessionId?: string;
  error?: string;
  captchaRefreshed?: boolean;
}

interface PendingLogin {
  page: Page;
  ctx: BrowserContext;
  username: string;
  password: string;
  saveCredential: boolean;
  method: "xpath" | "legacy" | "main" | "rsa";
  checkCodeId?: string;
  encryptedPW?: string;
}

const pendingLogins = new Map<string, PendingLogin>();

const NGA_LOGIN_PAGE = "https://bbs.nga.cn/nuke/account_copy.html?login";
const NGA_LOGIN_NUKE = "https://bbs.nga.cn/nuke.php?__lib=login&__act=account&login";
const NGA_LOGIN_API = "https://bbs.nga.cn/nuke.php?__lib=login&__act=login&login&__output=14";
const NGA_CAPTCHA_URL = "https://bbs.nga.cn/login_check_code.php";
const NGA_RSA_PUBKEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyKzZWDimCN1OCprqWUhF
UPhcwxDE62/BFVP6LtQHJu+65dm4YNmDvzitmcfaXW9YbhXnd4oP7j+6vpcgJQ+p
3ucySo1ZnqO0Bb2JKEtxpCmxe7IYXhFEkJqHpFYBTiAxQz2n2mX4JZy/ehBUSMjz
gzd0NdG6Ai1C42oCzYltUOjNWZUNHn1nqpElSWHnUWqkdN8+5ISP/ZMKiQdFANkE
qDGw3/34qyF+E/hVgrGF4/CcWNP/LJCdB6DYtx7VPlQZF0tP1s+q/++rC4rQ2wmV
l2V8zGh1j7ojZbt62hVjy6byK1E/2XYo97ZtL4KDW7F5jJMvSDRFR7901UR8hCdf
4wIDAQAB
-----END PUBLIC KEY-----`;

async function finishLogin(sessionId: string, username: string, saveCredential: boolean, password: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "会话丢失" };

  const cookies = await session.ctx.cookies();
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  console.log(`[Login] ${username} 登录成功 (${cookies.length} cookies, method=${session.method})`);
  pendingLogins.delete(sessionId);
  try { await session.ctx.close(); } catch {}

  if (cookies.length === 0) return { success: false, error: "登录失败：未获取到 Cookie" };
  createSession(username, cookieStr);
  if (saveCredential && password) storeCredential(username, password);
  return { success: true, username };
}

// ─── XPath-based login (primary method) ───

async function detectCaptchaXPath(page: Page, sessionId: string, username: string): Promise<LoginResult> {
  // Search all frames for captcha
  for (const f of page.frames()) {
    try {
      const el = f.locator('img[src*="captcha"], img[src*="verify"], img[src*="rand"], img[src*="check_code"]').first();
      if ((await el.count()) > 0) {
        const buf = await el.screenshot({ type: "png" });
        if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
      }
    } catch {}
  }

  // Try the login iframe (#iff)
  try {
    const captchaImg = page.frameLocator("#iff").locator("img").last();
    if ((await captchaImg.count()) > 0) {
      const buf = await captchaImg.screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  // Try account_copy.html captcha XPath
  try {
    const captchaImg = page.locator("xpath=/html/body/div[4]/img").first();
    if ((await captchaImg.count()) > 0) {
      const buf = await captchaImg.screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  // Last resort: last img on page
  try {
    const imgs = page.locator("img");
    const cnt = await imgs.count();
    if (cnt > 0) {
      const buf = await imgs.nth(cnt - 1).screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  return { success: false, error: "无法获取验证码，请刷新页面后重试" };
}

export async function startLoginWithXPath(username: string, password: string, saveCredential: boolean): Promise<LoginResult> {
  const page = await newPage();
  const ctx = page.context();
  const sessionId = `login_${Date.now()}`;
  pendingLogins.set(sessionId, { page, ctx, username, password, saveCredential, method: "xpath" });

  try {
    await page.goto(NGA_LOGIN_NUKE, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(2000);

    // Target the login iframe (#iff) which embeds account_copy.html
    const loginFrame = page.frameLocator("#iff");
    try {
      await loginFrame.locator("input").first().waitFor({ state: "visible", timeout: 10000 });
    } catch {
      // If #iff not ready, try any iframe with password input
      for (const f of page.frames()) {
        try {
          const pwInFrame = await f.locator('input[type="password"]').count();
          if (pwInFrame > 0) { break; }
        } catch {}
      }
    }

    // Click "密码" tab to switch to password login modal
    try {
      const pwTabs = loginFrame.locator("text=密码");
      if ((await pwTabs.count()) > 0) {
        await pwTabs.first().click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Fill username — composite selector with fallbacks
    const usernameInput = loginFrame.locator([
      '#name', 'input[name="name"]', 'input[name*="user"]',
      'input:not([type="submit"]):not([type="password"]):not([readonly])',
    ].join(", ")).first();

    try {
      await usernameInput.waitFor({ state: "visible", timeout: 8000 });
      await usernameInput.fill(username);
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到用户名输入框，请刷新后重试" };
    }

    // Fill password
    const passwordInput = loginFrame.locator([
      '#password', 'input[name="password"]', 'input[type="password"]',
    ].join(", ")).first();

    try {
      await passwordInput.waitFor({ state: "visible", timeout: 5000 });
      await passwordInput.fill(password);
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到密码输入框" };
    }

    // Click login button
    const loginBtn = loginFrame.locator([
      'button:has-text("登")', 'input[type="submit"]', 'button[type="submit"]',
      'a:has-text("登")', '[onclick*="login"]',
    ].join(", ")).first();

    try {
      if ((await loginBtn.count()) === 0) throw new Error("no button");
      await loginBtn.click();
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录按钮，请刷新重试" };
    }

    await page.waitForTimeout(5000);

    const url = page.url();
    if (!url.includes("login") && !url.includes("nuke")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }

    return await detectCaptchaXPath(page, sessionId, username);
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    const msg = (err as Error).message;
    if (msg.includes("Timeout")) return { success: false, error: "登录超时，请重试" };
    return { success: false, error: msg };
  }
}

export async function verifyCaptchaWithXPath(sessionId: string, captchaCode: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "登录会话已过期" };
  const { page, ctx, username, saveCredential, password } = session;

  try {
    // Search for captcha input in the login iframe first, then page
    let captchaInput = page.locator("xpath=//*[@id=\"name\"]").first();
    try {
      if ((await captchaInput.count()) === 0) {
        const loginFrame = page.frameLocator("#iff");
        captchaInput = loginFrame.locator([
          '#name', 'input[name*="captcha"]', 'input[name*="verify"]', 'input[name*="code"]',
          'input:not([type="submit"]):not([type="password"])',
        ].join(", ")).first();
        if ((await captchaInput.count()) === 0) {
          // Fallback: scan frames
          for (const f of page.frames()) {
            captchaInput = f.locator([
              'input[name*="captcha"]', 'input[name*="verify"]', 'input[name*="code"]',
              '#name',
            ].join(", ")).first();
            if ((await captchaInput.count()) > 0) break;
          }
        }
      }
    } catch {}

    if ((await captchaInput.count()) > 0) {
      await captchaInput.fill(captchaCode);
    }

    // Click continue — search in iframe first, then page
    let continueBtn = page.frameLocator("#iff").locator([
      'button:has-text("继续")', 'button:has-text("确")', 'button:has-text("提交")',
      'input[type="submit"]', 'button[type="submit"]', 'a:has-text("继续")',
    ].join(", ")).first();
    try {
      if ((await continueBtn.count()) === 0) {
        continueBtn = page.locator("xpath=/html/body/div[4]/a[1]").first();
        if ((await continueBtn.count()) === 0) {
          for (const f of page.frames()) {
            continueBtn = f.locator([
              'button:has-text("继续")', 'button:has-text("确")', 'button:has-text("提交")',
              'input[type="submit"]', 'button[type="submit"]',
            ].join(", ")).first();
            if ((await continueBtn.count()) > 0) break;
          }
        }
      }
    } catch {}

    if ((await continueBtn.count()) > 0) {
      await continueBtn.click();
      await page.waitForTimeout(5000);
    }

    const url = page.url();
    if (!url.includes("login") && !url.includes("nuke")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }

    return await detectCaptchaXPath(page, sessionId, username);
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    return { success: false, error: (err as Error).message };
  }
}

// ─── Main-site login (desktop homepage modal) ───

async function clickLoginLink(page: Page): Promise<boolean> {
  const selectors = [
    'a:has-text("登录")',
    'a[href*="login"]',
    'xpath=/html/body/div[2]/div[2]/div[1]/div/div/div[1]/div[2]/a',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

async function findLoginModal(page: Page) {
  // L1: CSS selectors that likely identify the modal container
  const cssCandidates = [
    '[role="dialog"]',
    '.modal',
    '.login-dialog',
    '.login-modal',
    '.popup',
    'div[style*="position:fixed"]',
    'div[style*="position: fixed"]',
  ];
  for (const sel of cssCandidates) {
    try {
      const modal = page.locator(sel).first();
      if ((await modal.count()) > 0) {
        const hasPw = await modal.locator('input[type="password"]').count();
        if (hasPw > 0) return modal;
      }
    } catch {}
  }

  // L2: User-provided XPath
  try {
    const modal = page.locator("xpath=/html/body/div[6]/div").first();
    if ((await modal.count()) > 0) return modal;
  } catch {}

  // L3: Walk up from any password input to find modal container
  try {
    const pwInput = page.locator('input[type="password"]').first();
    if ((await pwInput.count()) > 0) {
      for (let i = 0; i < 5; i++) {
        const parent = pwInput.locator("xpath=..");
        const tag = await parent.evaluate((el) => el.tagName.toLowerCase());
        if (tag === "body" || tag === "html") break;
        return parent;
      }
    }
  } catch {}

  return null;
}

async function detectCaptchaFromMain(page: Page, sessionId: string, username: string, modal: ReturnType<typeof page.locator>): Promise<LoginResult> {
  // L1: captcha images inside the modal
  try {
    const captchaEl = modal.locator('img[src*="captcha"], img[src*="verify"], img[src*="rand"], img[src*="check_code"]').first();
    if ((await captchaEl.count()) > 0) {
      const buf = await captchaEl.screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  // L2: User-provided XPath (/html/body/div[2]/img ← relative to page, not modal)
  try {
    const captchaEl = page.locator("xpath=/html/body/div[2]/img").first();
    if ((await captchaEl.count()) > 0) {
      const buf = await captchaEl.screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  // L3: any image in modal larger than 5px
  try {
    const imgs = modal.locator("img");
    const cnt = await imgs.count();
    for (let i = 0; i < cnt; i++) {
      const buf = await imgs.nth(i).screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  // L4: any img on page
  try {
    const imgs = page.locator("img");
    const cnt = await imgs.count();
    if (cnt > 0) {
      const buf = await imgs.nth(cnt - 1).screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}

  return { success: false, error: "无法获取验证码，请刷新页面后重试" };
}

export async function startLoginFromMain(username: string, password: string, saveCredential: boolean): Promise<LoginResult> {
  const page = await newDesktopPage();
  const ctx = page.context();
  const sessionId = `login_${Date.now()}`;
  pendingLogins.set(sessionId, { page, ctx, username, password, saveCredential, method: "main" });

  try {
    await page.goto("https://bbs.nga.cn/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    // Step 1: Click login link on homepage
    const clicked = await clickLoginLink(page);
    if (!clicked) {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到首页登录入口" };
    }
    await page.waitForTimeout(1500);

    // Step 2: Find the login modal
    const modal = await findLoginModal(page);
    if (!modal) {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录弹窗" };
    }

    // Step 3: Fill username — L1: first text input in modal, L2: user XPath
    let usernameInput = modal.locator('input[type="text"]:visible, input:not([type="submit"]):not([type="password"]):not([readonly]):visible').first();
    try {
      if ((await usernameInput.count()) === 0) {
        usernameInput = page.locator("xpath=/html/body/div/div/input[1]").first();
      }
      if ((await usernameInput.count()) === 0) {
        usernameInput = modal.locator("input").first();
      }
    } catch {}
    try {
      await usernameInput.waitFor({ state: "visible", timeout: 5000 });
      await usernameInput.fill(username);
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到用户名输入框" };
    }

    // Step 4: Fill password — L1: password input in modal, L2: user XPath
    let passwordInput = modal.locator('input[type="password"]:visible').first();
    try {
      if ((await passwordInput.count()) === 0) {
        passwordInput = page.locator("xpath=/html/body/div/div/input[2]").first();
      }
      if ((await passwordInput.count()) === 0) {
        passwordInput = modal.locator("input").nth(1);
      }
    } catch {}
    try {
      await passwordInput.waitFor({ state: "visible", timeout: 5000 });
      await passwordInput.fill(password);
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到密码输入框" };
    }

    // Step 5: Click login button — L1: button in modal, L2: user XPath
    let loginBtn = modal.locator([
      'button:has-text("登")', 'button:has-text("登录")', 'input[type="submit"]',
      'button[type="submit"]', 'a:has-text("登")', 'a:has-text("登录")',
    ].join(", ")).first();
    try {
      if ((await loginBtn.count()) === 0) {
        loginBtn = page.locator("xpath=/html/body/div/div/a[1]").first();
      }
      if ((await loginBtn.count()) > 0) {
        await loginBtn.click();
      } else {
        throw new Error("no button");
      }
    } catch {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录按钮" };
    }

    await page.waitForTimeout(5000);

    const url = page.url();
    if (!url.includes("login")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }

    return await detectCaptchaFromMain(page, sessionId, username, modal);
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    const msg = (err as Error).message;
    if (msg.includes("Timeout")) return { success: false, error: "登录超时，请重试" };
    return { success: false, error: msg };
  }
}

export async function verifyCaptchaFromMain(sessionId: string, captchaCode: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "登录会话已过期" };
  const { page, ctx, username, saveCredential, password } = session;

  try {
    const modal = await findLoginModal(page);

    // Fill captcha — L1: text input after img, L2: user XPath
    let captchaInput = (modal || page).locator('input:not([type="submit"]):not([type="password"])').first();
    try {
      if ((await captchaInput.count()) === 0) {
        captchaInput = page.locator("xpath=/html/body/div[2]/input").first();
      }
    } catch {}
    if ((await captchaInput.count()) > 0) {
      await captchaInput.fill(captchaCode);
    }

    // Click continue — L1: button in modal, L2: user XPath
    let continueBtn = (modal || page).locator([
      'button:has-text("继续")', 'button:has-text("确")', 'button:has-text("提交")',
      'a:has-text("继续")', 'input[type="submit"]', 'button[type="submit"]',
    ].join(", ")).first();
    try {
      if ((await continueBtn.count()) === 0) {
        continueBtn = page.locator("xpath=/html/body/div[2]/a[1]").first();
      }
    } catch {}
    if ((await continueBtn.count()) > 0) {
      await continueBtn.click();
      await page.waitForTimeout(5000);
    }

    const url = page.url();
    if (!url.includes("login")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }

    return await detectCaptchaFromMain(page, sessionId, username, modal || page.locator("body"));
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    return { success: false, error: (err as Error).message };
  }
}

// ─── Legacy login (iframe-based fallback) ───

import type { Frame } from "playwright";

async function getLoginFrame(page: Page): Promise<Frame | Page | null> {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator('input[type="password"]').count()) > 0) return frame;
      if ((await frame.locator('text=密码').count()) > 0) return frame;
    } catch {}
  }
  return null;
}

async function detectCaptchaLegacy(page: Page, sessionId: string, username: string): Promise<LoginResult> {
  for (const f of page.frames()) {
    try {
      const el = f.locator('img[src*="captcha"], img[src*="verify"], img[src*="rand"], canvas[id*="captcha"], canvas[class*="captcha"], img[id*="captcha"], img[class*="captcha"]').first();
      if ((await el.count()) > 0) {
        const buf = await el.screenshot({ type: "png" });
        if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
      }
    } catch {}
  }
  try {
    const imgs = page.locator("img");
    const cnt = await imgs.count();
    if (cnt > 0) {
      const buf = await imgs.nth(cnt - 1).screenshot({ type: "png" });
      if (buf.length > 500) return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
    }
  } catch {}
  return { success: false, error: "登录失败：无法获取验证码" };
}

export async function startLoginLegacy(username: string, password: string, saveCredential: boolean): Promise<LoginResult> {
  const page = await newPage();
  const ctx = page.context();
  const sessionId = `login_${Date.now()}`;
  pendingLogins.set(sessionId, { page, ctx, username, password, saveCredential, method: "legacy" });

  try {
    await page.goto("https://bbs.nga.cn/nuke.php?__lib=login&__act=account&login", {
      waitUntil: "load", timeout: 20000,
    });

    try {
      await page.waitForSelector("iframe", { timeout: 8000 });
      const iframeEl = page.frameLocator("iframe");
      await iframeEl.locator("input").first().waitFor({ timeout: 8000 });
    } catch {}

    const loginFrame = await getLoginFrame(page);
    if (!loginFrame) {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录表单，请刷新重试" };
    }

    const pwTab = loginFrame.locator('text=密码').first();
    if ((await pwTab.count()) > 0) {
      await pwTab.click();
      try { await loginFrame.locator('input[type="password"]').first().waitFor({ timeout: 5000 }); } catch {}
    }

    const usernameInput = loginFrame.locator('input:not([type="submit"]):not([readonly])').first();
    const passwordInput = loginFrame.locator('input[type="password"]').first();
    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const loginBtn = loginFrame.locator([
      'button:has-text("登")', 'input[type="submit"]', 'button[type="submit"]',
      'a:has-text("登")', '[onclick*="login"]',
    ].join(", ")).first();

    if ((await loginBtn.count()) === 0) {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录按钮" };
    }

    await loginBtn.click();
    await page.waitForTimeout(5000);

    const url = page.url();
    if (!url.includes("login") && !url.includes("nuke.php")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }

    return await detectCaptchaLegacy(page, sessionId, username);
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    const msg = (err as Error).message;
    if (msg.includes("Timeout")) return { success: false, error: "登录超时" };
    return { success: false, error: msg };
  }
}

export async function verifyCaptchaLegacy(sessionId: string, captchaCode: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "登录会话已过期" };
  const { page, ctx, username, saveCredential, password } = session;

  try {
    let targetFrame: Frame | Page = page;
    for (const f of page.frames()) {
      try {
        if ((await f.locator('button:has-text("继续"), button:has-text("确"), input[type="submit"]').count()) > 0) {
          targetFrame = f;
          break;
        }
      } catch {}
    }

    const captchaInput = targetFrame.locator([
      'input[name*="captcha"]', 'input[name*="verify"]', 'input[name*="code"]',
      'input[name*="rand"]', 'input:not([type="submit"]):not([type="password"])',
    ].join(", ")).first();
    if ((await captchaInput.count()) > 0) {
      await captchaInput.fill(captchaCode);
    }

    const continueBtn = targetFrame.locator([
      'button:has-text("继续")', 'button:has-text("确")',
      'button:has-text("提交")', 'input[type="submit"]', 'button[type="submit"]',
    ].join(", ")).first();
    if ((await continueBtn.count()) > 0) {
      await continueBtn.click();
      await page.waitForTimeout(5000);
    }

    const url = page.url();
    if (!url.includes("login") && !url.includes("nuke.php")) {
      return await finishLogin(sessionId, username, saveCredential, password);
    }
    return await detectCaptchaLegacy(page, sessionId, username);
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    return { success: false, error: (err as Error).message };
  }
}

// ─── RSA-based login (browser form submit with RSA-encrypted password) ───

async function rsaEncryptPassword(pw: string): Promise<string> {
  const crypto = await import("crypto");
  const encrypted = crypto.publicEncrypt(
    { key: NGA_RSA_PUBKEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(pw, "utf8")
  );
  return encrypted.toString("base64");
}

function getAccountFrame(page: Page) {
  for (const f of page.frames()) {
    if (f.url().includes("account_copy")) return f;
  }
  return null;
}

async function captureCaptchaInFrame(frame: import("playwright").Frame | import("playwright").Page, page: Page): Promise<string | null> {
  // Search for captcha image in the frame
  try {
    const captchaEl = frame.locator('img[src*="check_code"], img[src*="captcha"]').first();
    if ((await captchaEl.count()) > 0) {
      await page.waitForTimeout(500);
      const buf = await captchaEl.screenshot({ type: "png" });
      if (buf.length > 500) return buf.toString("base64");
    }
  } catch {}

  // Search all frames for any loaded captcha image
  for (const f of page.frames()) {
    try {
      const el = f.locator('img[src*="check_code"], img[src*="captcha"], img[src*="verify"]').first();
      if ((await el.count()) > 0) {
        const buf = await el.screenshot({ type: "png" });
        if (buf.length > 500) return buf.toString("base64");
      }
    } catch {}
  }

  return null;
}

export async function startLoginRSA(username: string, password: string, saveCredential: boolean): Promise<LoginResult> {
  const page = await newPage();
  const ctx = page.context();
  const sessionId = `login_${Date.now()}`;
  pendingLogins.set(sessionId, { page, ctx, username, password, saveCredential, method: "rsa" });

  try {
    await page.goto(NGA_LOGIN_NUKE, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(2000);

    const frame = getAccountFrame(page);
    if (!frame) {
      pendingLogins.delete(sessionId);
      await ctx.close();
      return { success: false, error: "无法找到登录表单" };
    }

    // Handle dialogs
    page.on("dialog", async (d) => { console.log(`[RSA] Dialog:`, d.message()); await d.accept(); });

    // Single evaluate: override, fill form, call _checkCodeInput, return status
    const captchaReady = await frame.evaluate((opts: { pw: string; user: string }) => {
      const w = window as any;

      // Override _checkCodeInput
      if (typeof w.__client !== "undefined") w.__client |= 4;
      if (typeof w._checkCodeInput === "function") {
        const orig = w._checkCodeInput;
        w._checkCodeInput = function (o: any, frm: string) {
          if (frm === "login" || (frm && frm.indexOf("login") !== -1)) {
            orig.call(window, o, frm);
            if (w.__checkCode && String(w.__checkCode).length > 0) return true;
            return undefined;
          }
          return orig.call(window, o, frm);
        };
      }

      // Fill form
      const nameEl = document.getElementById("name") as HTMLInputElement;
      const passEl = document.getElementById("password") as HTMLInputElement;
      if (nameEl) nameEl.value = opts.user;
      if (passEl) passEl.value = opts.pw;
      const cb = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }

      // Find login button and call _checkCodeInput directly
      const as = document.querySelectorAll("a");
      let loginBtn: HTMLAnchorElement | null = null;
      for (let i = 0; i < as.length; i++) {
        if ((as[i].textContent || "").replace(/\s/g, "") === "登录") {
          loginBtn = as[i] as HTMLAnchorElement;
          break;
        }
      }
      if (loginBtn && typeof w._checkCodeInput === "function") {
        w._checkCodeInput(loginBtn, "login");
      }

      // Wait for captcha image to appear
      return { hasCaptcha: false }; // We'll check via Playwright
    }, { pw: password, user: username });

    // Wait for captcha image to load - poll with longer waits
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2000);
      // Check if captcha image exists AND has loaded
      const captchaReady = await frame.evaluate(() => {
        const imgs = document.querySelectorAll('img[src*="check_code"], img[src*="captcha"]');
        for (let j = 0; j < imgs.length; j++) {
          const img = imgs[j] as HTMLImageElement;
          if (img.complete && img.naturalWidth > 10) {
            return { ready: true, src: img.src.substring(img.src.length - 60) };
          }
        }
        return { ready: false };
      });
      if (captchaReady.ready) {
        console.log(`[RSA Login] Captcha image ready after ${(i + 1) * 2}s:`, captchaReady.src);
        const captchaEl = frame.locator('img[src*="check_code"], img[src*="captcha"]').first();
        const buf = await captchaEl.screenshot({ type: "png" });
        if (buf.length > 500) {
          return { success: false, captcha: buf.toString("base64"), sessionId, error: "请输入验证码" };
        }
      }
    }

    return { success: false, error: "验证码加载失败，请刷新后重试" };
  } catch (err) {
    pendingLogins.delete(sessionId);
    try { await ctx.close(); } catch {}
    return { success: false, error: (err as Error).message };
  }
}

async function finishLoginHelper(sessionId: string, username: string, password: string, saveCredential: boolean): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "会话丢失" };

  const cookies = await session.ctx.cookies();
  console.log(`[RSA Login] All cookies (${cookies.length}):`,
    cookies.map((c) => `${c.name}=${c.value.substring(0, 20)}`).join(", "));

  // Build cookie string from ALL cookies (NGA needs multiple for auth)
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  
  // Check if we have a real auth UID (non-guest)
  const hasRealAuth = cookies.some(
    (c) => c.name === "ngaPassportUid" && !c.value.startsWith("guest") && c.value.length > 5
  );
  
  console.log(`[RSA Login] ${username} - hasRealAuth:`, hasRealAuth, `cookieStr:`, cookieStr.substring(0, 100));
  pendingLogins.delete(sessionId);
  try { await session.ctx.close(); } catch {}

  if (!hasRealAuth) {
    // Try one last time: if we have loginData, set UID directly
    return { success: false, error: "登录未返回有效用户凭据，请重试" };
  }

  createSession(username, cookieStr);
  if (saveCredential && password) storeCredential(username, password);
  console.log(`[RSA Login] Session saved for ${username}`);
  return { success: true, username };
}

// Collect POST requests from login flow for debugging
function collectLoginPosts(page: Page): Array<{ url: string; body: string }> {
  const posts: Array<{ url: string; body: string }> = [];
  const handler = (r: any) => {
    if (r.method() === "POST") {
      const u = r.url();
      if (u.includes("login") || u.includes("nuke")) {
        posts.push({ url: u.substring(0, 200), body: r.postData()?.substring(0, 300) || "" });
      }
    }
  };
  page.on("request", handler);
  // Return cleanup + get
  return new Proxy(posts, {
    get(target, prop) {
      if (prop === "__cleanup") {
        return () => page.off("request", handler);
      }
      return (target as any)[prop];
    },
  });
}

export async function verifyCaptchaRSA(sessionId: string, captchaCode: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "登录会话已过期" };
  const { page, ctx, username, password, saveCredential } = session;

  try {
    resetIdleTimer();

    // Re-acquire frame (might be stale)
    let frame = getAccountFrame(page);
    if (!frame) {
      // Try recovering
      await page.goto(NGA_LOGIN_NUKE, { waitUntil: "load", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
      frame = getAccountFrame(page);
      if (!frame) return { success: false, error: "登录会话已过期，请关闭弹窗后重新打开" };
    }

    // Refresh mode
    if (!captchaCode || captchaCode.trim() === "") {
      try {
        await frame.evaluate(() => {
          const w = window as any;
          const img = document.querySelector('img[src*="check_code"]') as HTMLImageElement;
          if (img) {
            const newId = "login" + Date.now();
            w.__checkCodeId = (w.__checkCodeFrom || "login") + Math.random().toString().substr(2);
            img.src = img.src.replace(/id=[^&]*/, "id=" + w.__checkCodeId);
          }
        });
      } catch {
        return { success: false, error: "无法刷新验证码，请关闭弹窗后重试" };
      }
      await page.waitForTimeout(2000);
      const captchaB64 = await captureCaptchaInFrame(frame, page);
      if (captchaB64) {
        return { success: false, captcha: captchaB64, sessionId, error: "请输入验证码", captchaRefreshed: true };
      }
      return { success: false, error: "无法刷新验证码" };
    }

    // Submit mode: one-shot _submit call (no post-submit frame access)
    console.log(`[RSA] Submitting captcha:`, captchaCode);
    try {
      await frame.evaluate((opts: { code: string; user: string; pw: string }) => {
        const w = window as any;
        w.__checkCode = opts.code;

        const as = document.querySelectorAll("a");
        let loginBtn: HTMLAnchorElement | null = null;
        for (let i = 0; i < as.length; i++) {
          if ((as[i].textContent || "").replace(/\s/g, "") === "登录") {
            loginBtn = as[i] as HTMLAnchorElement;
            break;
          }
        }
        if (!loginBtn || typeof w._submit !== "function" || typeof w._encrypt !== "function") {
          w.__loginError = "无法调用登录表单";
          return;
        }
        (loginBtn as any)._ready = 1;
        const encryptedPW = w._encrypt(opts.pw);

        w.__loginCallback = function (y: any) {
          if (y.error) {
            w.__loginError = y.error[0] || JSON.stringify(y.error);
            return;
          }
          w.__loginOk = true;
          if (y.data) {
            w.__loginData = y.data;
            if (y.data[3] && typeof (w as any).__appDoAction === "function") {
              (w as any).__appDoAction("loginSuccess", JSON.stringify(y.data[3]));
            }
          }
        };

        w._submit(loginBtn, w.__loginCallback,
          "__lib", "login", "__act", "login", "__output", "8",
          "name", opts.user, "type", "", "password", encryptedPW
        );
      }, { code: captchaCode, user: username, pw: password });
    } catch (e) {
      console.log(`[RSA] Submit evaluate error:`, (e as Error).message);
      return { success: false, error: "登录提交失败，请关闭弹窗后重试" };
    }

    // Poll cookies ONLY (no frame access after _submit — loginSuccess may navigate parent)
    // Also try to read login data from callback
    let loginData: any = null;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(2000);
      try {
        // Check if frame still accessible (may have been detached)
        if (!loginData) {
          try {
            loginData = await frame.evaluate(() => (window as any).__loginData || null);
          } catch { loginData = null; }
        }
        if (loginData) {
          console.log(`[RSA] Login data from callback:`, JSON.stringify(loginData).substring(0, 200));
        }

        const cookies = await ctx.cookies();
        console.log(`[RSA] Cookies check ${i + 1}:`, cookies.map((c) => `${c.name}=${c.value.substring(0, 15)}`).join(", "));

        // If we have login data from callback, try to extract UID
        if (loginData && typeof loginData === "object") {
          // Try data[0] (uid string), data[1] (token), or data[3] ({uid,token})
          const d3 = loginData[3];
          const uid = (typeof d3 === "object" ? (d3.uid || d3[0]) : null) || loginData[0];
          if (uid && typeof uid === "string" && uid.length > 3 && !uid.startsWith("guest")) {
            console.log(`[RSA] Setting ngaPassportUid=${uid}`);
            await ctx.addCookies([
              { name: "ngaPassportUid", value: uid, domain: ".nga.cn", path: "/" },
            ]);
          }
          const token = (typeof d3 === "object" ? (d3.token || d3.cid || d3[1]) : null) || loginData[1];
          if (token && typeof token === "string" && token.length > 3) {
            console.log(`[RSA] Setting ngaPassportCid=${token.substring(0,10)}...`);
            await ctx.addCookies([
              { name: "ngaPassportCid", value: token, domain: ".nga.cn", path: "/" },
            ]);
          }
        }

        const hasAuth = cookies.some((c) =>
          (c.name === "ngaPassportUid" && !c.value.startsWith("guest")) ||
          c.name === "ngaPassportCid" || c.name === "lastvisit"
        );
        if (hasAuth) {
          console.log(`[RSA] Auth cookies detected at check ${i + 1}`);
          break;
        }
      } catch {}
    }

    // Check for login error
    let submitError = "";
    try { submitError = await frame.evaluate(() => (window as any).__loginError || ""); } catch {}

    if (submitError && submitError.length > 0 && submitError !== "undefined") {
      console.log(`[RSA] Login error:`, submitError);
      if (submitError.includes("验证码") || submitError.includes("验")) {
        // Reload captcha
        try {
          await frame.evaluate(() => {
            const w = window as any;
            w.__checkCode = undefined; w.__checkCodeId = undefined;
            const as = document.querySelectorAll("a");
            for (let i = 0; i < as.length; i++) {
              if ((as[i].textContent || "").replace(/\s/g, "") === "登录") {
                w._checkCodeInput(as[i], "login");
                break;
              }
            }
          });
          for (let i = 0; i < 4; i++) {
            await page.waitForTimeout(1500);
            const b64 = await captureCaptchaInFrame(frame, page);
            if (b64) return { success: false, captcha: b64, sessionId, error: submitError };
          }
        } catch {}
      }
      return { success: false, error: submitError };
    }

    // Still guest cookies — final attempt
    return await finishLoginHelper(sessionId, username, password, saveCredential);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── Public API ───

export async function startLogin(username: string, password: string, method: "xpath" | "legacy" | "main" | "rsa" = "rsa", saveCredential: boolean = false): Promise<LoginResult> {
  if (method === "legacy") return startLoginLegacy(username, password, saveCredential);
  if (method === "main") return startLoginFromMain(username, password, saveCredential);
  if (method === "rsa") return startLoginRSA(username, password, saveCredential);
  return startLoginWithXPath(username, password, saveCredential);
}

export async function verifyCaptcha(sessionId: string, captchaCode: string): Promise<LoginResult> {
  const session = pendingLogins.get(sessionId);
  if (!session) return { success: false, error: "登录会话已过期" };
  if (session.method === "legacy") return verifyCaptchaLegacy(sessionId, captchaCode);
  if (session.method === "main") return verifyCaptchaFromMain(sessionId, captchaCode);
  if (session.method === "rsa") return verifyCaptchaRSA(sessionId, captchaCode);
  return verifyCaptchaWithXPath(sessionId, captchaCode);
}

export function getPendingLoginCount(): number {
  return pendingLogins.size;
}

import { getSession, isExpiringSoon } from "./session-store";
import { getCredential } from "./credential-store";
import { startLogin } from "./login-engine";

const RENEW_JITTER_HOURS = parseInt(process.env.AUTH_RENEW_JITTER_HOURS || "2"); // 2-5 hours random window

export async function renewSessions(): Promise<{ renewed: number; needsManual: number }> {
  const session = getSession();
  if (!session) return { renewed: 0, needsManual: 0 };

  // Random jitter: prevent fixed-interval auto-renew pattern detectable by NGA
  const jitterWindow = RENEW_JITTER_HOURS + Math.floor(Math.random() * 3); // 2-5 hours
  if (!isExpiringSoon(jitterWindow)) return { renewed: 0, needsManual: 0 };

  const credential = getCredential(session.username);
  if (!credential) {
    console.log(`[Auth] ${session.username} 的 session 即将过期，但无保存的凭证，需要手动登录`);
    return { renewed: 0, needsManual: 1 };
  }

  console.log(`[Auth] 自动续期 ${session.username} (jitter=${jitterWindow}h) ...`);
  try {
    const result = await startLogin(credential.username, credential.password, "xpath", true);
    if (result.success) {
      console.log(`[Auth] ${session.username} 自动续期成功`);
      return { renewed: 1, needsManual: 0 };
    }
    console.log(`[Auth] ${session.username} 自动续期失败: ${result.error}`);
    return { renewed: 0, needsManual: 1 };
  } catch (err) {
    console.log(`[Auth] ${session.username} 自动续期异常:`, (err as Error).message);
    return { renewed: 0, needsManual: 1 };
  }
}

export function getCredentialStatus(): { hasCredential: boolean; username: string | null } {
  const credential = getCredential();
  const session = getSession();
  return {
    hasCredential: !!credential,
    username: credential?.username || session?.username || null,
  };
}

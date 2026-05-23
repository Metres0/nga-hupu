"use client";

import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth-store";

export default function LoginDialog() {
  const { loginDialogOpen, closeLoginDialog, setLoggedIn, setSessionInfo, resumable } = useAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveCred, setSaveCred] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorType, setErrorType] = useState<"network" | "auth" | "captcha" | "timeout" | "blocked" | null>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const captchaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (captchaImg) captchaRef.current?.focus();
  }, [captchaImg]);

  if (!loginDialogOpen) return null;

  function reset() {
    setUsername(""); setPassword(""); setCaptchaImg(null);
    setCaptchaCode(""); setSessionId(null); setError(null); setLoading(false);
    setErrorType(null);
  }

  function classifyError(msg: string | undefined): typeof errorType {
    if (!msg) return null;
    if (msg.includes("网络") || msg.includes("fetch")) return "network";
    if (msg.includes("验证码")) return "captcha";
    if (msg.includes("超时")) return "timeout";
    if (msg.includes("403") || msg.includes("拦截")) return "blocked";
    return "auth";
  }

  async function doLogin() {
    if (!username || !password) { setError("请输入用户名和密码"); setErrorType("auth"); return; }
    setError(null); setErrorType(null); setLoading(true);
    try {
      const resp = await fetch("/api/v1/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, method: "rsa", saveCredential: saveCred }),
      });
      const data = await resp.json();
      if (data.captcha) {
        setCaptchaImg(data.captcha);
        setSessionId(data.sessionId);
        if (data.error) { setError(data.error); setErrorType("captcha"); }
        return;
      }
      if (data.success) {
        setLoggedIn(data.username || username);
        setSessionInfo({ hasCredential: saveCred });
        reset();
        return;
      }
      setError(data.error || "登录失败");
      setErrorType(classifyError(data.error));
    } catch { setError("网络错误，请检查连接"); setErrorType("network"); }
    finally { setLoading(false); }
  }

  async function doVerify() {
    if (!captchaCode || !sessionId) return;
    setError(null); setErrorType(null); setLoading(true);
    try {
      const resp = await fetch("/api/v1/auth/login/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, captcha: captchaCode, username, password }),
      });
      const data = await resp.json();
      if (data.success) {
        setLoggedIn(data.username || username);
        setSessionInfo({ hasCredential: saveCred });
        reset();
        return;
      }
      if (data.captcha) {
        setCaptchaImg(data.captcha);
        setCaptchaCode("");
        setError(data.error || "验证码错误，请重试");
        setErrorType("captcha");
        return;
      }
      setError(data.error || "验证失败");
      setErrorType(classifyError(data.error));
    } catch { setError("网络错误"); setErrorType("network"); }
    finally { setLoading(false); }
  }

  async function refreshCaptcha() {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await fetch("/api/v1/auth/login/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, captcha: "", username, password }),
      });
      const data = await resp.json();
      if (data.captcha) { setCaptchaImg(data.captcha); setCaptchaCode(""); setError(null); }
    } catch {}
    finally { setLoading(false); }
  }

  const errorIcon = errorType === "network" ? "🌐" : errorType === "captcha" ? "🔐" :
    errorType === "timeout" ? "⏳" : errorType === "blocked" ? "🚫" : "⚠️";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.4)] backdrop-blur-sm" onClick={closeLoginDialog}>
      <div className="w-full max-w-sm mx-4 glass-card-elevated rounded-3xl p-6 shadow-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-title text-[var(--text-primary)] mb-1">NGA 账号登录</h2>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--md-primary)]/10 text-[var(--md-primary)] font-medium">RSA 引擎 v4.0</span>
          {resumable && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">存有凭据</span>}
        </div>
        <p className="text-body-sm text-[var(--text-tertiary)] mb-5">
          {captchaImg ? "输入验证码完成登录" : "登录后可访问晴风村等受限板块"}
        </p>

        <div className="space-y-3">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名"
            className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" disabled={!!captchaImg}
            onKeyDown={(e) => { if (e.key === "Enter") passRef.current?.focus(); }} />

          <div className="relative">
            <input ref={passRef} type={showPassword ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="密码"
              className="glass-input w-full px-4 py-2.5 rounded-xl text-sm pr-10" disabled={!!captchaImg}
              onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm p-1">
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          {!captchaImg && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={saveCred} onChange={(e) => setSaveCred(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--md-primary)]" />
              <span className="text-label text-[var(--text-tertiary)]">保存凭据用于自动续期</span>
            </label>
          )}

          {captchaImg && (
            <div className="space-y-2">
              <div className="relative">
                <img src={`data:image/png;base64,${captchaImg}`} alt="验证码"
                  className="rounded-xl border border-[var(--border-default)] w-full h-16 object-contain bg-white" />
                <button onClick={refreshCaptcha} disabled={loading}
                  className="absolute top-1.5 right-1.5 px-2 py-1 text-xs bg-white/80 rounded-lg border border-[var(--border-default)] hover:bg-white transition-colors disabled:opacity-50"
                  title="刷新验证码">
                  🔄 刷新
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] text-center">看不清？点击刷新按钮获取新验证码</p>
              <input ref={captchaRef} type="text" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} placeholder="输入验证码"
                className="glass-input w-full px-4 py-2.5 rounded-xl text-sm" autoFocus
                onKeyDown={(e) => e.key === "Enter" && doVerify()} />
            </div>
          )}

          {error && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${
              errorType === "captcha" ? "bg-amber-50 text-amber-700" :
              errorType === "network" ? "bg-red-50 text-red-600" :
              "bg-red-50 text-[var(--md-error)]"
            }`}>
              <span>{errorIcon}</span>
              <span>{error}</span>
            </div>
          )}

          <button onClick={captchaImg ? doVerify : doLogin} disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[var(--md-primary)] text-[var(--md-on-primary)] text-sm font-semibold hover:shadow-elevated transition-all active:scale-[0.98] disabled:opacity-50">
            {loading ? (captchaImg ? "验证中..." : "登录中...") : (captchaImg ? "确认验证码" : "登 录")}
          </button>
        </div>

        <div className="flex gap-3 mt-3">
          {captchaImg && (
            <button onClick={reset} className="flex-1 py-2 rounded-xl border border-[var(--border-default)] text-body-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors">
              重新输入
            </button>
          )}
          <button onClick={closeLoginDialog} className="flex-1 py-2 rounded-xl border border-[var(--border-default)] text-body-sm text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] transition-colors">
            取消
          </button>
        </div>

        {saveCred && (
          <p className="text-[10px] text-[var(--text-tertiary)] text-center mt-3">
            🔒 凭据经 AES-256-GCM 加密存储于本地数据库
          </p>
        )}
      </div>
    </div>
  );
}

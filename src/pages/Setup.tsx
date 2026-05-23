import { useEffect, useState } from "react";
import { vault, oauth, cloudinary } from "../lib/tauri";
import { useSettings } from "../lib/settings";
import { useT } from "../lib/i18n";

type CardState = {
  busy: boolean;
  error: string | null;
  info: string | null;
};

const card = "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";
const label = "block text-xs uppercase tracking-wide text-(--color-muted) mb-1";
const input =
  "w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)";
const btnConnect = (connected: boolean) =>
  `px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
    connected
      ? "bg-(--color-success) text-black hover:opacity-90"
      : "bg-(--color-surface-2) text-(--color-text) hover:bg-(--color-border)"
  }`;
const btnGhost =
  "px-3 py-2 rounded-md bg-(--color-surface-2) text-(--color-text) text-sm font-medium hover:bg-(--color-border) disabled:opacity-50 disabled:cursor-not-allowed";
const pill = (ok: boolean, okText: string, offText: string) => ({
  className: `inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
    ok
      ? "bg-(--color-success)/15 text-(--color-success)"
      : "bg-(--color-surface-2) text-(--color-muted)"
  }`,
  text: ok ? okText : offText,
});

function useVaultField(key: string) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    vault.get(key).then((v) => {
      if (cancelled) return;
      setValue(v ?? "");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const save = async (v: string) => {
    setValue(v);
    if (v) await vault.set(key, v);
    else await vault.delete(key);
  };
  return { value, setValue, save, loaded };
}

function StatusRow({ status, name }: { status: Record<string, boolean>; name: string }) {
  const t = useT();
  const ok = !!status[name];
  const p = pill(ok, t("connected"), t("notSet"));
  return <span className={p.className}>{p.text}</span>;
}

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const t = useT();
  if (!expiresAt) return null;
  if (expiresAt === "0") {
    return <span className="text-xs text-(--color-muted)">· {t("tokenNeverExpires")}</span>;
  }
  const ms = Number(expiresAt);
  if (!Number.isFinite(ms) || ms <= 0) {
    return <span className="text-xs text-(--color-muted)">· {t("tokenExpiryUnknown")}</span>;
  }
  const diffMs = ms - Date.now();
  if (diffMs <= 0) {
    return <span className="text-xs text-(--color-danger)">· {t("tokenExpired")}</span>;
  }
  const days = Math.floor(diffMs / 86400000);
  const cls = days < 7 ? "text-(--color-danger)" : "text-(--color-muted)";
  return (
    <span className={`text-xs ${cls}`}>
      · {t("tokenExpiresIn").replace("{days}", String(days))}
    </span>
  );
}

async function fetchExpiry(
  fn: (token: string) => Promise<number>,
  token: string,
): Promise<string> {
  try {
    const expSec = await fn(token);
    if (expSec <= 0) return "0";
    return String(expSec * 1000);
  } catch {
    return "";
  }
}

function useExpiryRefresh(
  tokenValue: string,
  tokenLoaded: boolean,
  expiresSave: (v: string) => Promise<void>,
  debugFn: (token: string) => Promise<number>,
) {
  useEffect(() => {
    if (!tokenLoaded || !tokenValue) return;
    let cancelled = false;
    (async () => {
      const fresh = await fetchExpiry(debugFn, tokenValue);
      if (cancelled || !fresh) return;
      await expiresSave(fresh);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenLoaded, tokenValue]);
}

export default function Setup() {
  const t = useT();
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const refreshStatus = async () => {
    const list = await vault.status();
    const obj: Record<string, boolean> = {};
    for (const [k, v] of list) obj[k] = v;
    setStatus(obj);
  };
  useEffect(() => {
    refreshStatus();
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("setupTitle")}</h1>
        <p className="text-sm text-(--color-muted)">{t("setupSub")}</p>
      </header>

      <PreferencesCard />

      {/* <FacebookCard status={status} refresh={refreshStatus} /> */}
      <InstagramCard status={status} refresh={refreshStatus} />
      <ThreadsCard status={status} refresh={refreshStatus} />
      <YouTubeCard status={status} refresh={refreshStatus} />
      <TikTokCard status={status} refresh={refreshStatus} />
      <CloudinaryCard status={status} refresh={refreshStatus} />

      <DangerZone refresh={refreshStatus} />
    </div>
  );
}

function PreferencesCard() {
  const t = useT();
  const { lang, theme, setLang, setTheme } = useSettings();
  return (
    <section className={card}>
      <header className="flex items-center gap-3">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: "var(--color-accent)" }}
        />
        <h2 className="text-lg font-semibold">{t("preferences")}</h2>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className={label}>{t("language")}</div>
          <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-bg) p-1">
            <SegBtn active={lang === "zh"} onClick={() => setLang("zh")}>
              {t("zh")}
            </SegBtn>
            <SegBtn active={lang === "en"} onClick={() => setLang("en")}>
              {t("en")}
            </SegBtn>
          </div>
        </div>
        <div>
          <div className={label}>{t("theme")}</div>
          <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-bg) p-1">
            <SegBtn active={theme === "dark"} onClick={() => setTheme("dark")}>
              {t("dark")}
            </SegBtn>
            <SegBtn active={theme === "light"} onClick={() => setTheme("light")}>
              {t("light")}
            </SegBtn>
          </div>
        </div>
      </div>
    </section>
  );

  function SegBtn({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`px-3 py-1.5 text-sm font-medium rounded ${
          active
            ? "bg-(--color-accent) text-black"
            : "text-(--color-muted) hover:text-(--color-text)"
        }`}
        aria-pressed={active}
      >
        {children}
      </button>
    );
  }
}

function CardShell({
  title,
  accent,
  badge,
  children,
}: {
  title: string;
  accent: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <header className="flex items-center gap-3">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: accent }}
        />
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="ml-auto">{badge}</div>
      </header>
      {children}
    </section>
  );
}

function SecretWarning() {
  const t = useT();
  return (
    <p className="text-[11px] text-(--color-danger) mt-1 leading-snug">
      {t("secretWarning")}
    </p>
  );
}

function CloudinaryNote({ msg }: { msg: string }) {
  return (
    <div className="text-xs px-3 py-2 rounded-md bg-(--color-bg) border border-(--color-border)/70 text-(--color-muted) flex items-start gap-2">
      <span
        className="font-semibold shrink-0"
        style={{ color: "#3448c5" }}
      >
        Cloudinary
      </span>
      <span className="leading-relaxed">{msg}</span>
    </div>
  );
}

function ErrorLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-(--color-danger) bg-(--color-danger)/10 px-3 py-2 rounded-md">
      {msg}
    </p>
  );
}
function InfoLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-(--color-success) bg-(--color-success)/10 px-3 py-2 rounded-md">
      {msg}
    </p>
  );
}

function FacebookCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const pageId = useVaultField("fb_page_id");
  const pageToken = useVaultField("fb_page_token");
  const expires = useVaultField("fb_page_token_expires_at");
  const [manualToken, setManualToken] = useState("");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });
  const [inspect, setInspect] = useState<string | null>(null);
  useExpiryRefresh(pageToken.value, pageToken.loaded, expires.save, oauth.facebookDebugToken);

  const saveManualToken = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      const raw = manualToken.trim();
      if (!raw) throw new Error("Token is empty");
      const pid = await oauth.facebookResolvePage(raw);
      await pageToken.save(raw);
      await pageId.save(pid);
      await expires.save(await fetchExpiry(oauth.facebookDebugToken, raw));
      setManualToken("");
      setS({ busy: false, error: null, info: `Saved Page ${pid}` });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  const doInspect = async () => {
    setS({ busy: true, error: null, info: null });
    setInspect(null);
    try {
      const tok = pageToken.value;
      if (!tok) throw new Error("尚未儲存 FB token");
      const r = await oauth.facebookInspectToken(tok);
      const all = Array.from(new Set([...r.scopes, ...r.granular_scopes]));
      const need = ["pages_manage_posts", "pages_read_engagement"];
      const missing = need.filter((p) => !all.includes(p));
      const lines = [
        `類型: ${r.token_type || "未知"}`,
        `有效: ${r.is_valid ? "是" : "否"}`,
        `所有 scope: ${all.length ? all.join(", ") : "(無)"}`,
        missing.length
          ? `❌ 缺少: ${missing.join(", ")}`
          : "✅ 發文必要 scope 都有",
      ];
      setInspect(lines.join("\n"));
      setS({ busy: false, error: null, info: null });
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title={t("fbCard")}
      accent="#1877f2"
      badge={<StatusRow status={status} name="fb_page_token" />}
    >
      <p className="text-xs text-(--color-muted)">{t("fbManualHint")}</p>
      <textarea
        className={`${input} font-mono text-xs`}
        rows={3}
        placeholder={t("tokenPh")}
        value={manualToken}
        onChange={(e) => setManualToken(e.currentTarget.value)}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className={btnConnect(!!status.fb_page_token)}
          disabled={s.busy || !manualToken.trim()}
          onClick={saveManualToken}
        >
          {t("thManualBtn")}
        </button>
        <button
          type="button"
          className={btnGhost}
          disabled={s.busy || !pageToken.value}
          onClick={doInspect}
        >
          {t("fbInspectBtn")}
        </button>
        {pageId.value && (
          <span className="text-xs text-(--color-muted)">
            {t("activePage")}: <span className="text-(--color-text)">{pageId.value}</span>
          </span>
        )}
        <ExpiryBadge expiresAt={expires.value} />
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
      {inspect && (
        <pre className="text-xs text-(--color-text) bg-(--color-bg) border border-(--color-border) rounded-md p-2 whitespace-pre-wrap break-all">
          {inspect}
        </pre>
      )}
      <CloudinaryNote msg={t("cloudinaryWhyFb")} />
    </CardShell>
  );
}

function InstagramCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const userId = useVaultField("ig_user_id");
  const token = useVaultField("ig_token");
  const expires = useVaultField("ig_token_expires_at");
  const [manualToken, setManualToken] = useState("");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  useEffect(() => {
    if (!token.loaded || !token.value) return;
    let cancelled = false;
    (async () => {
      try {
        const [newToken, expiresIn] = await oauth.instagramRefreshToken(token.value);
        if (cancelled) return;
        if (newToken && newToken !== token.value) await token.save(newToken);
        if (expiresIn > 0) await expires.save(String(Date.now() + expiresIn * 1000));
      } catch {
        // refresh fails for tokens < 24h old — keep existing expires
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.loaded]);

  const saveManualToken = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      const raw = manualToken.trim();
      if (!raw) throw new Error("Token is empty");
      const uid = await oauth.instagramResolveUser(raw);
      await userId.save(uid);
      let info = `Saved token for IG user ${uid}`;
      try {
        const [newToken, expiresIn] = await oauth.instagramRefreshToken(raw);
        await token.save(newToken || raw);
        await expires.save(String(Date.now() + expiresIn * 1000));
        info += ` · refresh ok (${Math.floor(expiresIn / 86400)}d)`;
      } catch (refreshErr) {
        console.error("[IG refresh]", refreshErr);
        await token.save(raw);
        await expires.save(String(Date.now() + 60 * 86400000));
        info += ` · refresh failed → 60d fallback: ${String(refreshErr).slice(0, 200)}`;
      }
      setManualToken("");
      setS({ busy: false, error: null, info });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title={t("igCard")}
      accent="#e1306c"
      badge={<StatusRow status={status} name="ig_token" />}
    >
      <p className="text-xs text-(--color-muted)">{t("igManualHint")}</p>
      <textarea
        className={`${input} font-mono text-xs`}
        rows={3}
        placeholder={t("tokenPh")}
        value={manualToken}
        onChange={(e) => setManualToken(e.currentTarget.value)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnConnect(!!status.ig_token)}
          disabled={s.busy || !manualToken.trim()}
          onClick={saveManualToken}
        >
          {t("thManualBtn")}
        </button>
        {userId.value && (
          <span className="text-xs text-(--color-muted)">
            {t("igUser")}: <span className="text-(--color-text)">{userId.value}</span>
          </span>
        )}
        <ExpiryBadge expiresAt={expires.value} />
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
      <CloudinaryNote msg={t("cloudinaryWhyIg")} />
    </CardShell>
  );
}

function ThreadsCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const userId = useVaultField("th_user_id");
  const token = useVaultField("th_token");
  const expires = useVaultField("th_token_expires_at");
  const [manualToken, setManualToken] = useState("");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  useEffect(() => {
    if (!token.loaded || !token.value) return;
    let cancelled = false;
    (async () => {
      try {
        const [newToken, expiresIn] = await oauth.threadsRefreshToken(token.value);
        if (cancelled) return;
        if (newToken && newToken !== token.value) await token.save(newToken);
        if (expiresIn > 0) await expires.save(String(Date.now() + expiresIn * 1000));
      } catch {
        // refresh fails for tokens < 24h old — keep existing expires
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.loaded]);

  const saveManualToken = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      const raw = manualToken.trim();
      if (!raw) throw new Error("Token is empty");
      const uid = await oauth.threadsResolveUser(raw);
      await userId.save(uid);
      let info = `Saved token for Threads user ${uid}`;
      try {
        const [newToken, expiresIn] = await oauth.threadsRefreshToken(raw);
        await token.save(newToken || raw);
        await expires.save(String(Date.now() + expiresIn * 1000));
        info += ` · refresh ok (${Math.floor(expiresIn / 86400)}d)`;
      } catch (refreshErr) {
        console.error("[Threads refresh]", refreshErr);
        await token.save(raw);
        await expires.save(String(Date.now() + 60 * 86400000));
        info += ` · refresh failed → 60d fallback: ${String(refreshErr).slice(0, 200)}`;
      }
      setManualToken("");
      setS({ busy: false, error: null, info });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title={t("thCard")}
      accent="#a855f7"
      badge={<StatusRow status={status} name="th_token" />}
    >
      <p className="text-xs text-(--color-muted)">{t("thManualHint")}</p>
      <textarea
        className={`${input} font-mono text-xs`}
        rows={3}
        placeholder={t("tokenPh")}
        value={manualToken}
        onChange={(e) => setManualToken(e.currentTarget.value)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnConnect(!!status.th_token)}
          disabled={s.busy || !manualToken.trim()}
          onClick={saveManualToken}
        >
          {t("thManualBtn")}
        </button>
        {userId.value && (
          <span className="text-xs text-(--color-muted)">
            {t("thUser")}: <span className="text-(--color-text)">{userId.value}</span>
          </span>
        )}
        <ExpiryBadge expiresAt={expires.value} />
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
      <CloudinaryNote msg={t("cloudinaryWhyTh")} />
    </CardShell>
  );
}

function YouTubeCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const clientId = useVaultField("yt_client_id");
  const clientSecret = useVaultField("yt_client_secret");
  const refreshToken = useVaultField("yt_refresh_token");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });
  const [verifying, setVerifying] = useState(false);

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!clientId.value || !clientSecret.value)
        throw new Error("Client ID and Secret are required");
      const r = await oauth.flow("youtube", clientId.value, clientSecret.value);
      if (!r.refresh_token) {
        throw new Error(
          "Google returned no refresh_token. Make sure the OAuth consent screen has been re-approved (revoke prior access in your Google account and reconnect)."
        );
      }
      await refreshToken.save(r.refresh_token);
      setS({
        busy: false,
        error: null,
        info: "Connected — refresh token saved.",
      });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  const verify = async () => {
    setVerifying(true);
    setS({ busy: false, error: null, info: null });
    try {
      const r = await oauth.youtubeVerify({
        clientId: clientId.value.trim(),
        clientSecret: clientSecret.value.trim(),
        refreshToken: refreshToken.value.trim(),
      });
      const info = t("youtubeOk")
        .replace("{title}", r.channel_title)
        .replace("{id}", r.channel_id);
      setS({ busy: false, error: null, info });
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    } finally {
      setVerifying(false);
    }
  };

  const canVerify =
    !!clientId.value.trim() && !!clientSecret.value.trim();

  return (
    <CardShell
      title={t("ytCard")}
      accent="#ff0000"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="yt_client_id" />
          <StatusRow status={status} name="yt_refresh_token" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">{t("ytHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("clientId")}</label>
          <input
            className={input}
            value={clientId.value}
            onChange={(e) => clientId.setValue(e.currentTarget.value)}
            onBlur={(e) => clientId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>{t("clientSecret")}</label>
          <input
            className={input}
            type="password"
            value={clientSecret.value}
            onChange={(e) => clientSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => clientSecret.save(e.currentTarget.value)}
          />
          <SecretWarning />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btnConnect(!!status.yt_refresh_token)} onClick={s.busy ? () => oauth.cancel() : connect}>
          {s.busy ? t("waitingBrowser") : t("connectOAuth")}
        </button>
        <button
          className={btnConnect(false)}
          onClick={verify}
          disabled={verifying || s.busy || !canVerify}
        >
          {verifying ? t("verifyingYoutube") : t("verifyYoutube")}
        </button>
        {refreshToken.value && (
          <span className="text-xs text-(--color-muted)">{t("refreshTokenStored")}</span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function TikTokCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const clientId = useVaultField("tt_client_id");
  const clientSecret = useVaultField("tt_client_secret");
  const refreshToken = useVaultField("tt_refresh_token");
  const openId = useVaultField("tt_open_id");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!clientId.value || !clientSecret.value)
        throw new Error("Client Key and Secret are required");
      const r = await oauth.flow("tiktok", clientId.value, clientSecret.value);
      if (!r.refresh_token) throw new Error("TikTok returned no refresh_token");
      await refreshToken.save(r.refresh_token);
      if (r.open_id) await openId.save(r.open_id);
      setS({
        busy: false,
        error: null,
        info: `Connected${r.open_id ? ` as ${r.open_id}` : ""}.`,
      });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title={t("ttCard")}
      accent="#25f4ee"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="tt_client_id" />
          <StatusRow status={status} name="tt_refresh_token" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">{t("ttHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("clientKey")}</label>
          <input
            className={input}
            value={clientId.value}
            onChange={(e) => clientId.setValue(e.currentTarget.value)}
            onBlur={(e) => clientId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>{t("clientSecret")}</label>
          <input
            className={input}
            type="password"
            value={clientSecret.value}
            onChange={(e) => clientSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => clientSecret.save(e.currentTarget.value)}
          />
          <SecretWarning />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btnConnect(!!status.tt_refresh_token)} onClick={s.busy ? () => oauth.cancel() : connect}>
          {s.busy ? t("waitingBrowser") : t("connectOAuth")}
        </button>
        {openId.value && (
          <span className="text-xs text-(--color-muted)">
            open_id: <span className="text-(--color-text)">{openId.value}</span>
          </span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
      <CloudinaryNote msg={t("cloudinaryWhyTt")} />
    </CardShell>
  );
}

function CloudinaryCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const t = useT();
  const cn = useVaultField("cl_cloud_name");
  const ak = useVaultField("cl_api_key");
  const as = useVaultField("cl_api_secret");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const saveAll = async () => {
    await Promise.all([
      cn.save(cn.value),
      ak.save(ak.value),
      as.save(as.value),
    ]);
    refresh();
  };

  const verify = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      await saveAll();
      const r = await cloudinary.verify({
        cloudName: cn.value.trim(),
        apiKey: ak.value.trim(),
        apiSecret: as.value.trim(),
      });
      const info =
        r.credits_used != null && r.credits_limit != null
          ? t("cloudinaryOk")
              .replace("{plan}", r.plan || "—")
              .replace("{used}", r.credits_used.toFixed(2))
              .replace("{limit}", r.credits_limit.toFixed(0))
          : t("cloudinaryOkNoLimit").replace("{plan}", r.plan || "—");
      setS({ busy: false, error: null, info });
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title={t("cloudinaryCard")}
      accent="#3448c5"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="cl_cloud_name" />
          <StatusRow status={status} name="cl_api_secret" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">{t("cloudinaryHint")}</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>{t("cloudName")}</label>
          <input
            className={input}
            value={cn.value}
            onChange={(e) => cn.setValue(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>{t("apiKey")}</label>
          <input
            className={input}
            value={ak.value}
            onChange={(e) => ak.setValue(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>{t("apiSecret")}</label>
          <input
            className={input}
            type="password"
            value={as.value}
            onChange={(e) => as.setValue(e.currentTarget.value)}
          />
          <SecretWarning />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className={btnConnect(!!status.cl_api_secret)} onClick={saveAll} disabled={s.busy}>
          {t("saveCloudinary")}
        </button>
        <button
          className={btnConnect(false)}
          onClick={verify}
          disabled={s.busy || !cn.value.trim() || !ak.value.trim() || !as.value.trim()}
        >
          {s.busy ? t("verifyingCloudinary") : t("verifyCloudinary")}
        </button>
      </div>
      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function DangerZone({ refresh }: { refresh: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const wipe = async () => {
    if (!confirm(t("confirmWipe"))) return;
    setBusy(true);
    try {
      await vault.wipeAll();
      await refresh();
      location.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${card} border-(--color-danger)/30`}>
      <h2 className="text-lg font-semibold text-(--color-danger)">{t("dangerZone")}</h2>
      <p className="text-xs text-(--color-muted)">{t("dangerHint")}</p>
      <button
        className="px-3 py-2 rounded-md bg-(--color-danger) text-black text-sm font-medium disabled:opacity-50"
        disabled={busy}
        onClick={wipe}
      >
        {busy ? t("wiping") : t("wipeAll")}
      </button>
    </section>
  );
}


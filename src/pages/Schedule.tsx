import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  schedule,
  type Platform,
  type ScheduledPost,
  type ScheduleInput,
  type ScheduleStatus,
} from "../lib/tauri";
import { PLATFORMS, platformLabel } from "../lib/platforms";
import { useT, type TKey } from "../lib/i18n";

type ScheduleMode = "photo" | "video";

const card =
  "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";
const btn =
  "px-3 py-2 rounded-md bg-(--color-accent) text-black text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "px-3 py-2 rounded-md bg-(--color-surface-2) text-(--color-text) text-sm font-medium hover:bg-(--color-border) disabled:opacity-50";
const btnDanger =
  "px-3 py-2 rounded-md text-sm font-medium text-(--color-danger) hover:bg-(--color-danger)/10 disabled:opacity-50";
const input =
  "w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)";
const fieldLabel =
  "block text-xs uppercase tracking-wide text-(--color-muted) mb-1";

const STATUS_KEY: Record<ScheduleStatus, TKey> = {
  pending: "scheduleStatusPending",
  running: "scheduleStatusRunning",
  done: "scheduleStatusDone",
  failed: "scheduleStatusFailed",
};

const STATUS_COLOR: Record<ScheduleStatus, string> = {
  pending: "bg-(--color-accent)/15 text-(--color-accent)",
  running: "bg-(--color-accent)/20 text-(--color-accent)",
  done: "bg-(--color-success)/15 text-(--color-success)",
  failed: "bg-(--color-danger)/15 text-(--color-danger)",
};

function tsToLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToTs(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

function nowLocalInput(): string {
  const d = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function Schedule() {
  const t = useT();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduledPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ScheduleMode>("photo");
  const [nowMin, setNowMin] = useState<string>(() => nowLocalInput());
  useEffect(() => {
    const id = window.setInterval(() => setNowMin(nowLocalInput()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const filtered = useMemo(
    () => posts.filter((p) => p.composeMode === tab),
    [posts, tab]
  );
  const counts = useMemo(
    () => ({
      photo: posts.filter((p) => p.composeMode === "photo").length,
      video: posts.filter((p) => p.composeMode === "video").length,
    }),
    [posts]
  );

  const goCreate = (mode: ScheduleMode) => {
    navigate("/compose", { state: { presetMode: mode, focusSchedule: true } });
  };

  const refresh = async () => {
    try {
      setPosts(await schedule.list());
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  const startEdit = (p: ScheduledPost) => {
    setEditingId(p.id);
    setDraft(p);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!draft || !editingId) return;
    setError(null);
    const input: ScheduleInput = {
      scheduledAt: draft.scheduledAt,
      composeMode: draft.composeMode,
      text: draft.text,
      videoTitle: draft.videoTitle,
      media: draft.media,
      platforms: draft.platforms,
      postPrivacy: draft.postPrivacy,
      ttMode: draft.ttMode,
      ttSource: draft.ttSource,
    };
    try {
      await schedule.update(editingId, input);
      cancelEdit();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("scheduleConfirmDelete"))) return;
    try {
      await schedule.delete(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("scheduleTitle")}
        </h1>
        <p className="text-sm text-(--color-muted)">{t("scheduleSub")}</p>
      </header>

      {error && (
        <p className="text-sm text-(--color-danger) bg-(--color-danger)/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-(--color-border) bg-(--color-surface) p-1"
        >
          <TabBtn
            active={tab === "photo"}
            label={`${t("scheduleTabPhoto")} (${counts.photo})`}
            onClick={() => {
              setTab("photo");
              if (editingId) {
                setEditingId(null);
                setDraft(null);
              }
            }}
          />
          <TabBtn
            active={tab === "video"}
            label={`${t("scheduleTabVideo")} (${counts.video})`}
            onClick={() => {
              setTab("video");
              if (editingId) {
                setEditingId(null);
                setDraft(null);
              }
            }}
          />
        </div>
        <button className={btn} onClick={() => goCreate(tab)}>
          {tab === "photo" ? t("scheduleAddPhoto") : t("scheduleAddVideo")}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-(--color-muted)">
          {tab === "photo" ? t("scheduleEmptyPhoto") : t("scheduleEmptyVideo")}
        </p>
      ) : (
        <ul className="space-y-4">
          {filtered.map((p) => {
            const isEditing = editingId === p.id && draft;
            const editableStatus =
              p.status === "pending" || p.status === "failed";
            return (
              <li key={p.id} className={card}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status]}`}
                      >
                        {t(STATUS_KEY[p.status])}
                      </span>
                      <span className="text-xs text-(--color-muted)">
                        {p.composeMode}
                      </span>
                    </div>
                    <div className="text-sm font-medium">
                      {new Date(p.scheduledAt * 1000).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!isEditing && editableStatus && (
                      <button className={btnGhost} onClick={() => startEdit(p)}>
                        {t("scheduleEdit")}
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button className={btn} onClick={save}>
                          {t("scheduleSave")}
                        </button>
                        <button className={btnGhost} onClick={cancelEdit}>
                          {t("scheduleCancel")}
                        </button>
                      </>
                    )}
                    <button className={btnDanger} onClick={() => remove(p.id)}>
                      {t("scheduleDelete")}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <EditForm
                    draft={draft!}
                    setDraft={setDraft}
                  />
                ) : (
                  <ReadView post={p} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  function ReadView({ post }: { post: ScheduledPost }) {
    return (
      <div className="space-y-2">
        {post.composeMode === "video" && post.videoTitle && (
          <div>
            <div className={fieldLabel}>{t("videoTitle")}</div>
            <div className="text-sm">{post.videoTitle}</div>
          </div>
        )}
        {post.text && (
          <div>
            <div className={fieldLabel}>
              {post.composeMode === "photo"
                ? t("captionPhoto")
                : t("captionVideo")}
            </div>
            <div className="text-sm whitespace-pre-wrap break-words">
              {post.text}
            </div>
          </div>
        )}
        <div className="flex gap-4 flex-wrap text-xs text-(--color-muted)">
          <span>
            {t("schedulePlatforms")}:{" "}
            <span className="text-(--color-text)">
              {post.platforms.map(platformLabel).join(", ") || "—"}
            </span>
          </span>
          <span>
            {t("scheduleVisibility")}:{" "}
            <span className="text-(--color-text)">{post.postPrivacy}</span>
          </span>
          {post.composeMode === "video" && post.platforms.includes("tiktok") && (
            <span>
              {t("scheduleMode")}:{" "}
              <span className="text-(--color-text)">
                {post.ttMode} / {post.ttSource}
              </span>
            </span>
          )}
          <span>
            Media:{" "}
            <span className="text-(--color-text)">{post.media.length}</span>
          </span>
        </div>
        {post.results.length > 0 && (
          <div className="space-y-1">
            <div className={fieldLabel}>{t("scheduleResults")}</div>
            <ul className="space-y-1">
              {post.results.map((r, i) => (
                <li
                  key={i}
                  className={`text-xs px-2 py-1 rounded-md ${
                    r.ok
                      ? "bg-(--color-success)/10 text-(--color-success)"
                      : "bg-(--color-danger)/10 text-(--color-danger)"
                  }`}
                >
                  <span className="font-semibold capitalize">{r.platform}</span>
                  : {r.message}
                  {r.permalink && (
                    <a
                      href={r.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-(--color-accent) ml-2"
                    >
                      {t("open")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  function EditForm({
    draft,
    setDraft,
  }: {
    draft: ScheduledPost;
    setDraft: (p: ScheduledPost) => void;
  }) {
    const togglePlatform = (id: Platform) => {
      const has = draft.platforms.includes(id);
      const next = has
        ? draft.platforms.filter((x) => x !== id)
        : [...draft.platforms, id];
      setDraft({ ...draft, platforms: next });
    };
    const allowed =
      draft.composeMode === "photo"
        ? (["facebook", "instagram", "threads"] as Platform[])
        : (PLATFORMS.map((p) => p.id) as Platform[]);
    return (
      <div className="space-y-3 border-t border-(--color-border) pt-3">
        <div>
          <label className={fieldLabel}>{t("scheduleAt")}</label>
          <input
            type="datetime-local"
            className={input}
            value={tsToLocalInput(draft.scheduledAt)}
            min={nowMin}
            onChange={(e) =>
              setDraft({
                ...draft,
                scheduledAt: localInputToTs(e.currentTarget.value),
              })
            }
          />
        </div>
        {draft.composeMode === "video" && (
          <div>
            <label className={fieldLabel}>{t("videoTitle")}</label>
            <input
              className={input}
              value={draft.videoTitle}
              onChange={(e) =>
                setDraft({ ...draft, videoTitle: e.currentTarget.value })
              }
              maxLength={100}
            />
          </div>
        )}
        <div>
          <label className={fieldLabel}>
            {draft.composeMode === "photo"
              ? t("captionPhoto")
              : t("captionVideo")}
          </label>
          <textarea
            rows={4}
            className={`${input} leading-relaxed`}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
          />
        </div>
        <div>
          <label className={fieldLabel}>{t("schedulePlatforms")}</label>
          <div className="flex gap-2 flex-wrap">
            {PLATFORMS.filter((p) => allowed.includes(p.id)).map((p) => {
              const on = draft.platforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlatform(p.id)}
                  className={`px-3 py-1.5 text-sm rounded-md border ${
                    on
                      ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-text)"
                      : "border-(--color-border) text-(--color-muted) hover:text-(--color-text)"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={fieldLabel}>{t("scheduleVisibility")}</label>
          <div className="inline-flex rounded-md border border-(--color-border) overflow-hidden">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, postPrivacy: "public" })}
              className={`px-3 py-1.5 text-sm ${
                draft.postPrivacy === "public"
                  ? "bg-(--color-accent) text-black"
                  : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {t("postPrivacyPublic")}
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, postPrivacy: "private" })}
              className={`px-3 py-1.5 text-sm border-l border-(--color-border) ${
                draft.postPrivacy === "private"
                  ? "bg-(--color-accent) text-black"
                  : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              {t("postPrivacyPrivate")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function TabBtn({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-(--color-accent) text-black"
          : "text-(--color-muted) hover:text-(--color-text)"
      }`}
    >
      {label}
    </button>
  );
}

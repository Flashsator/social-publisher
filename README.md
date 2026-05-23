# Social Publisher

跨平台桌面工具 — 一次把同一篇貼文發到 **Instagram / Threads / YouTube**,憑證只存在本機 OS 金鑰庫,不經過任何中介伺服器。

[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-edition_2021-DEA584?logo=rust)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#授權)

---

## 這是什麼

一個本地優先(local-first)的多平台社群發文桌機程式。沒有後端伺服器、沒有訂閱、沒有資料收集 — 你的 API 憑證跟內容都只在你自己的電腦上。

### 主要功能

- **多平台同步發文**:同時發 IG、Threads、YouTube,單篇文字 / 圖片 / 影片皆可
- **排程**:設未來時間自動發
- **自動媒體中轉**:IG / Threads 需要公開 URL 的部分,自動上傳到你的 Cloudinary,發完立刻刪除
- **本地憑證**:Token / Secret 全部存在 macOS Keychain / Windows Credential Manager / Linux Secret Service
- **OAuth + 手動 Token**:兩種授權方式都支援
- **Token 自動續命**:IG / Threads 的 60 天 token 每次開啟 App 時自動 refresh
- **中英雙語**:UI 內建繁體中文 + English

### 目前支援的平台

| 平台 | 圖文 | 影片 | 備註 |
|------|------|------|------|
| Instagram | ✓ | ✓ (Reels) | 自動透過 Cloudinary 中轉 |
| Threads | ✓ | ✓ | 自動透過 Cloudinary 中轉 |
| YouTube | — | ✓ | 直接從本機上傳,不需 Cloudinary |
| TikTok | — | — | 介面保留,標記「未實作」 |

---

## 截圖

> 設定頁 / 發布頁 / 排程頁 / 說明頁

(截圖可後續補上)

---

## 安裝

### 從 Release 下載(推薦)

到 [Releases](https://github.com/Flashsator/social-publisher/releases) 抓對應平台的安裝包。

### 從原始碼建置

需要先裝好 [Rust](https://rustup.rs/) + [Node.js 18+](https://nodejs.org/) + Tauri 系統相依([官方文件](https://tauri.app/start/prerequisites/))。

```bash
git clone https://github.com/Flashsator/social-publisher.git
cd social-publisher
npm install
npm run tauri dev      # 開發模式
npm run tauri build    # 編出對應平台 release 安裝檔
```

---

## 快速開始

1. **打開 App,進入「設定」頁**
2. **逐一連線你要用的平台**(IG / Threads / YouTube / Cloudinary)— 每張卡片內有提示文字告訴你去哪個開發者後台拿憑證
3. **去「發布」頁**,選圖文或影片模式,填內容,勾平台,按「發布」

詳細教學:[USAGE.md](USAGE.md)(在 GitHub 上直接看)或 [USAGE.html(美化版)](https://htmlpreview.github.io/?https://github.com/Flashsator/social-publisher/blob/main/USAGE.html)

---

## 一次性準備:你需要什麼憑證

本工具只負責「使用」憑證,**不代為註冊**。每個平台都要自己去申請。

| 平台 | 你要拿到的 |
|------|----------|
| Instagram / Threads | Meta App 的 App ID + App Secret(或直接抓 long-lived access token 手動貼) |
| YouTube | Google Cloud OAuth Client(桌面應用程式類型)的 Client ID + Client Secret |
| Cloudinary | Cloud name + API key + API secret(免費方案足夠) |

App 內每張卡片上方都會顯示 **Redirect URI**,把那串網址貼到對應後台的 OAuth 白名單,否則授權會被擋。

---

## 排程注意事項

排程功能只記錄「本機檔案路徑」,**到時候才去讀檔**。所以:

- ⚠️ 排程建立後,圖片/影片**不要移動、改名、刪除**
- ⚠️ 外接硬碟上的檔案,排程到時硬碟要插著
- ⚠️ 排程到時電腦必須**開機 + App 在執行**(最小化到系統匣 OK)才會自動發
- 建議排程前先把媒體複製到一個固定資料夾再選

---

## 為什麼憑證不外洩

- 所有 token / secret 透過 [`keyring`](https://crates.io/crates/keyring) crate 存進 OS 提供的安全儲存空間
- App 本身**不連任何後端伺服器**,只直接呼叫各平台官方 API
- OAuth 授權碼換 token 在本機 Rust 後端完成
- 媒體上傳用你自己 Cloudinary 帳號,發完立刻刪除

---

## 技術棧

- **桌面 Shell**:[Tauri 2](https://tauri.app)
- **前端**:[React 19](https://react.dev) + [TypeScript 5.8](https://www.typescriptlang.org) + [Vite 7](https://vitejs.dev) + [Tailwind CSS 4](https://tailwindcss.com)
- **路由**:React Router 7
- **後端**:Rust(reqwest, tokio, serde, chrono)
- **驗證**:[Zod 4](https://zod.dev)
- **金鑰庫**:[keyring](https://crates.io/crates/keyring)

---

## 專案結構

```
social-publisher/
├── src/                      # React 前端
│   ├── pages/                # Setup / Compose / Schedule / Help
│   ├── lib/                  # i18n, tauri bindings, settings, platforms
│   └── components/
├── src-tauri/                # Rust 後端
│   └── src/
│       ├── lib.rs            # Tauri command 註冊
│       ├── oauth.rs          # OAuth flow + token inspector
│       ├── vault.rs          # OS keyring 封裝
│       ├── cloudinary.rs     # Cloudinary 上傳 / 刪除 / verify
│       ├── scheduler.rs      # 排程引擎
│       └── platforms/        # 各平台 publish 實作
│           ├── instagram.rs
│           ├── threads.rs
│           ├── youtube.rs
│           └── tiktok.rs
├── USAGE.md                  # 完整使用教學(Markdown)
├── USAGE.html                # 完整使用教學(瀏覽器版)
└── README.md
```

---

## 常見問題

**Q. 我只用 YouTube,需要設 Cloudinary 嗎?**
不用。Cloudinary 只在 IG / Threads 發文時才會被呼叫。

**Q. 為什麼 IG / Threads 一律公開?**
官方 API 不支援私人貼文,這是平台限制。

**Q. Cloudinary 免費額度會被吃光嗎?**
不會。每次發完(不論成敗)工具會立刻刪掉剛剛上傳的檔案。

**Q. YouTube 一天能上傳幾部?**
預設 Google 配額一天約 6 部(每支消耗 ~1,600 units / 共 10,000)。需要更多去 Google Cloud Console 申請額度提升。

更多 FAQ 請見 [USAGE.md](USAGE.md#常見問題)。

---

## 開發

```bash
npm run tauri dev              # 啟動開發模式(熱重載)
npm run build                  # TypeScript 編譯 + Vite 打包
cd src-tauri && cargo check    # Rust 後端編譯檢查
cd src-tauri && cargo clippy   # Rust lint
```

主要的 Tauri command 都註冊在 [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)。前端透過 [`src/lib/tauri.ts`](src/lib/tauri.ts) 的 type-safe wrapper 呼叫。

---

## 貢獻

歡迎 issue、PR。送 PR 前麻煩:

1. `cargo fmt` + `cargo clippy` Rust 端無 warning
2. `npm run build` 前端 build 過
3. Commit message 用 conventional commits 風格(`feat:` / `fix:` / `docs:` / `refactor:`)

---

## 授權

MIT — 詳見 [LICENSE](LICENSE)。

---

## 致謝

- [Tauri](https://tauri.app) — 跨平台桌面框架
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-platform) / [Threads API](https://developers.facebook.com/docs/threads)
- [YouTube Data API v3](https://developers.google.com/youtube/v3)
- [Cloudinary](https://cloudinary.com) — 媒體中轉

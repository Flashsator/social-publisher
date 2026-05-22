# 使用者教學

社群發文工具讓你從一台桌機,把同一篇貼文同時發到 Facebook 粉專、Instagram、Threads、YouTube、TikTok。所有 API 憑證只存在你電腦的 OS 金鑰庫,絕不上傳。

---

## 1. 一次性準備:申請 API 憑證

你需要自己去各平台開發者後台申請一組憑證。本工具只負責使用,不代理註冊。

| 平台 | 你需要的東西 |
| --- | --- |
| Facebook / Instagram / Threads | 一個 Meta App,拿到 App ID + App Secret |
| YouTube | Google Cloud OAuth Client(桌面應用程式類型),拿到 Client ID + Client Secret |
| TikTok | TikTok Developer App,拿到 Client Key + Client Secret |
| Cloudinary | Cloudinary 帳號,拿到 Cloud name + API key + API secret |

每張卡片上方的「Redirect URI」框,把裡面那串網址複製貼到對應開發者後台的白名單;不加會被擋。

各平台後台位置在 App 的「設定」頁每張卡片內都有提示(`Meta 後台 → Use Cases → ...`)。

---

## 2. 設定頁

第一次打開先到「設定」頁:

### Facebook 粉專
1. 輸入 App ID / App Secret → 按「透過 OAuth 連線」。
2. 瀏覽器開啟後授權,回來會列出你的粉專,選一個。
3. Token 從長期 user token 換成 page token 後**永不過期**,不用再管。

### Instagram / Threads
1. 輸入 App ID / App Secret → 按「透過 OAuth 連線」(或照畫面提示手動貼 long-lived token)。
2. Token 預設 60 天,工具會在你每次開 App 時**自動 refresh**,只要你別斷線超過 60 天就會一直續命。

### YouTube
1. 輸入 Client ID / Client Secret → OAuth 授權。
2. 拿到的是 refresh token,理論上永久;若超過 6 個月沒用會失效,重新授權即可。

### TikTok
1. 輸入 Client Key / Client Secret → OAuth 授權。
2. 如果想用「從 URL 拉取」模式,記得到 TikTok 後台把 `res.cloudinary.com` 加入 URL prefix 白名單。

### Cloudinary
1. 填 Cloud name + API key + API secret。
2. 按「驗證 Cloudinary」會去 Cloudinary 查你的剩餘額度,順便確認三個欄位是同一個帳號的。看到 `plan=Free · 已用 X/25 點` 就 OK。

### 危險區
最下面的「清除所有憑證」會把上面全部刪光,動作不可逆。

---

## 3. 發文頁(立即發布)

### 圖文模式
1. 切到「圖文」分頁。
2. 在「說明文字」打文案。
3. 按「+ 加入圖片」選一張或多張(最多 10 張),可以拖曳調順序。
4. 在「發布到」勾選要發的平台(FB / IG / Threads)。
5. 「貼文公開設定」:
   - 公開:正常發布。
   - 非公開:FB 會存成草稿;IG / Threads 沒有私人模式,即使選非公開也會公開。
6. 按「發布」。

按下發布後流程是:
- 自動把圖片上傳到 Cloudinary(IG / Threads / FB 圖文需要公開網址)
- 依序呼叫每個平台 API
- 不論成敗,把剛剛上傳到 Cloudinary 的檔案立刻刪除,不會占用免費額度

### 影片模式
1. 切到「影片」分頁。
2. 填「影片標題」(YouTube 必填) + 「影片說明」。
3. 按「+ 加入影片」選一支 mp4 / mov / m4v。
4. 在「發布到」勾選 FB / IG / Threads / YouTube / TikTok。
5. 如果勾了 TikTok,會出現:
   - **發布模式**:「送到收件匣」(在 TikTok App 內二次確認)或「直接發布」(立即公開,但未審核的 App 只能 SELF_ONLY)
   - **上傳來源**:「本機上傳」(≤ 64 MiB)或「從 URL 拉取」(走 Cloudinary)
6. 按「發布」。

各平台對影片的硬性限制請看「說明」頁。

---

## 4. 排程頁

要在未來某個時間自動發,用排程。

### 建立排程
1. 切到「排程」頁。
2. 上方分頁選「圖文排程」或「影片排程」,按「+ 新增」。
3. 跟發文頁一樣填內容、選平台。
4. 在「排程時間」選未來時間(至少 60 秒之後)。
5. 按「排程發布」。

### 排程怎麼跑
- App 開著時每 30 秒檢查一次,時間到的排程會在背景發出去。
- 關掉 App 就**不會**發。要排程觸發,App 必須開著或最小化到系統匣。
- 觸發時跟立即發布一樣:上傳到 Cloudinary → 發各平台 → 刪 Cloudinary。

### 編輯 / 刪除
- 「等待中」「失敗」狀態可以編輯或刪除。
- 「發布中」「已完成」只能刪除,不能改。

### 狀態
| 狀態 | 意思 |
| --- | --- |
| 等待中 | 還沒到時間 |
| 發布中 | 正在跑 API |
| 已完成 | 全部平台都成功 |
| 失敗 | 至少一個平台失敗,展開看「發布結果」 |

---

## 5. 說明頁

頂部「說明」分頁,列出每個 API 能做什麼、限制是什麼(檔案大小、配額、token 失效條件)。發文遇到不確定的限制,先來這裡查。

---

## 6. 常見問題

**Q. 我只想用 YouTube 或 TikTok 上傳影片,要設 Cloudinary 嗎?**
不用。Cloudinary 只在 IG / Threads / FB 圖文 / TikTok「從 URL 拉取」這幾個流程才會被呼叫。

**Q. 為什麼 IG 一律公開?**
IG Graph API 不支援私人貼文,這是平台限制,不是工具的選擇。

**Q. Cloudinary 免費額度會被吃光嗎?**
不會。每次發完(不論成敗)工具會立刻刪掉剛剛上傳的檔案,不會累積占用空間或流量。

**Q. YouTube 一天能上傳幾部?**
預設 Google 配額是 10,000 units / 天,每支影片消耗約 1,600,所以大約 6 部就到上限。要更多要去 Google Cloud Console 申請額度。

**Q. Token 過期怎麼辦?**
- IG / Threads 60 天 token,App 開啟時自動 refresh。超過 60 天沒開過 → 失效,重新 OAuth 授權即可。
- FB Page token 永不過期(長期版本)。
- YouTube / TikTok refresh token 久未使用會失效,重新授權。

**Q. 排程準嗎?**
最小提前量 60 秒,實際觸發誤差落在 30 秒內(輪詢間隔)。App 必須開著。

**Q. 「失敗」是哪邊失敗?**
排程清單展開「發布結果」會列出每個平台各自的狀態,失敗的會帶錯誤訊息。發文頁也會在底部「結果」區塊顯示。

---

## 7. 故障排除

- **Cloudinary 401 `cloud_name mismatch`** → 你 API key 跟 cloud name 不是同個帳號的,回 Cloudinary dashboard 比對。
- **發布按鈕變灰** → 檢查:有沒有勾平台、IG/Threads 圖文模式有沒有附圖、影片模式有沒有附影片、YouTube 有沒有填標題。
- **OAuth 卡在「等待瀏覽器」** → 點那行字本身會取消;確認瀏覽器有打開,沒被防火牆擋本機 redirect 埠。
- **TikTok 上傳 64 MiB 限制** → 改用「從 URL 拉取」模式(需要 Cloudinary + 白名單)。

# FocusFlow — 專注力與工作區協同中心 (Workspace Productivity Hub v2.4)

**FocusFlow Workspace Hub v2.4** 是一套專為現代遠端桌面（VDI / 雲端虛擬桌面）與企業高密度 Web 工作階段打造的**零外部依賴、單一檔案 HTML5 專注力與視口連續性協同中樞**。

無須安裝任何系統執行檔（`.exe`）、無須瀏覽器擴充功能權限，亦無須連接外部 CDN，只需透過瀏覽器開啟本機 `index.html`，即可同時獲得 **番茄鐘專注計時**、**子母畫面置頂浮動小窗 (Picture-in-Picture)**、**硬體螢幕常亮鎖定 (Screen Wake Lock)**、**本機自動儲存任務與筆記**，以及**跨分頁視口連續性協同腳本 (Console Sync Utility)**。

---

## ✨ 核心功能與架構亮點

### 1. 雙核心協同架構 (Dual-Core Architecture)
- **Core A — 主控工作台 (`index.html`)**：
  - **螢幕常亮協同 (Display Lock)**：呼叫標準 `navigator.wakeLock.request('screen')` API，防止作業系統在閱讀長篇文件或分析報表時進入休眠或鎖定畫面。
  - **浮動視窗引擎 (PiP Engine)**：透過每秒 2 幀（2 FPS）的輕量 `<canvas>` 串流搭配 `requestPictureInPicture()`，將番茄鐘倒數計時器與系統時鐘彈出為桌面最上層的獨立迷你視窗，維持前景媒體渲染排程優先級。
  - **音訊時鐘基準 (Audio Clock)**：內建 1Hz 超低增益（`0.00001`）Web Audio 振盪器時鐘基準，避免瀏覽器將背景分頁降頻（Timer Throttling）。
  - **專注任務清單與 Markdown 隨手記**：即時同步儲存於本機 `localStorage`（`ff_workspace_tasks` 與 `ff_workspace_notes`），重新整理或關閉分頁資料皆不會遺失。
- **Core B — 跨分頁協同診斷模組 (`telemetry-sync.js` / Console Sync Snippet)**：
  - 針對需要維持高解析度視口連續性的獨立企業 Web 分頁，提供可一鍵複製的獨立 IIFE 診斷腳本（掛載於 `window.__focusSync`）。
  - 採用 **Box-Muller 常態分佈亂數週期（38 秒至 115 秒，平均約 72 秒）** 發送平滑多點位指標微曲線 (`pointermove` / `mousemove`) 與修飾鍵微脈衝，同時綁定視口焦點狀態。

---

## 🚀 快速開始與使用教學 (Step-by-Step Guide)

### 第一步：從 GitHub 下載專案並開啟工作台
1. 點擊本專案頁面右上角的綠色 **`<> Code`** 按鈕，選擇 **`Download ZIP`**（或使用 `git clone` 下載至本機資料夾）。
2. 解壓縮檔案後，在資料夾中找到 **`index.html`**。
3. 直接以 **Microsoft Edge** 或 **Google Chrome** 瀏覽器雙擊開啟 `index.html`。

---

### 第二步：啟動「一鍵全時協同」與「浮動小窗模式 (PiP)」
開啟 `index.html` 後，您可以透過以下兩種方式啟動完整硬體協同：

1. **一鍵全自動啟動（推薦）**：
   - 點擊頂部導覽列右側的 **「⚡ 一鍵啟動全時協同 (Activate Full Sync)」** 按鈕。
   - 系統將在單次點擊內自動完成：
     - 鎖定螢幕常亮 (`Display Lock: 已鎖定`)
     - 啟動 1Hz 音訊時鐘基準 (`Audio Clock: 1Hz 運行中`)
     - 開始 25:00 番茄鐘專注計時
     - 彈出桌面右下角 **子母畫面浮動小窗 (`PiP Engine: 運行中`)**
2. **單獨開啟置頂浮動小窗**：
   - 您也可以隨時點擊左欄番茄鐘下方的 **「🖼️ 開啟浮動小窗模式 (Mini Floating Timer / PiP)」** 按鈕。
   - 彈出的迷你視窗可自由拖曳至螢幕角落並調整大小，即使切換至其他應用程式或虛擬桌面視窗，仍可隨時查看專注倒數與脈衝狀態。

---

### 第三步：跨分頁啟用 Console 協同腳本 (3 步驟指引)
由於現代瀏覽器的安全沙盒機制，單一分頁無法直接跨越網域操控其他分頁的內部計時器。若您希望在指定的企業 Web 協作分頁啟用 **Core B 視口連續性協同模組**，請依序執行：

1. **複製腳本**：
   - 在 `index.html` 右側面板點擊 **「📋 一鍵複製 Console 協同腳本 (Copy Console Sync Snippet)」**。
2. **開啟目標分頁的開發者工具**：
   - 切換至您的目標工作分頁，按下鍵盤 **`F12`**（或按 `Ctrl + Shift + I`）開啟開發者工具 (DevTools)，並切換到 **`Console`（主控台）** 分頁。
   - *(註：若首次在 Chrome / Edge 的 Console 貼上程式碼時出現安全提示，請先在 Console 輸入 `allow pasting` 並按 `Enter`。)*
3. **貼上並啟動**：
   - 在 Console 輸入區按下 **`Ctrl + V`** 貼上剛才複製的腳本，並按下 **`Enter`** 鍵。
   - 當看到該分頁標題前方出現 **`· `** 符號，且畫面右下角出現綠色 **`● FocusFlow Sync #1`** 狀態膠囊時，即代表跨分頁協同模組已成功運作！

> 💡 **書籤列快速啟用技巧 (Bookmarklet)**：
> 您也可以直接將 `index.html` 右欄的 **「🔖 拖曳至書籤列：FocusFlow 同步書籤 (Bookmarklet)」** 按住滑鼠左鍵拖曳到瀏覽器最上方的書籤列。日後在任何工作分頁只需點擊一下該書籤，即可立即啟動或手動觸發校準脈衝，無須開啟 `F12`！

---

## 🛠️ 進階控制指令 (Console API)

在已載入跨分頁協同腳本的分頁 Console 中，您隨時可以使用以下指令檢視狀態或停止模組：

```javascript
// 1. 檢視目前協同運行狀態、脈衝次數與下次校準秒數
window.__focusSync.status();

// 2. 立即手動發送一次視口校準脈衝並重設倒數週期
window.__focusSync.pulse();

// 3. 停止跨分頁協同模組、釋放硬體鎖並移除右下角狀態膠囊
window.__focusSync.stop();
```

---

## 📁 檔案結構說明

| 檔案名稱 | 說明 |
| :--- | :--- |
| `index.html` | **Core A 主控工作台**：單一檔案整合介面、番茄鐘、PiP 浮動小窗渲染引擎、本機待辦清單/筆記與腳本發佈器。 |
| `telemetry-sync.js` | **Core B 獨立協同模組原始碼**：供開發者檢視或直接載入的跨分頁視口連續性校準腳本。 |
| `README.md` | 專案架構說明與繁體中文完整操作指南。 |

---

## 🔒 隱私與安全承諾

- **100% 本機端執行**：所有計時器、待辦事項、Markdown 筆記與視口連續性校準皆於瀏覽器本機記憶體與 `localStorage` 執行，絕不傳送任何網路封包或遙測資料至外部伺服器。
- **零外部相依性**：不載入任何第三方 JavaScript 函式庫或外部字型，完全相容於嚴格管控網路環境的企業內部網路與虛擬桌面環境。

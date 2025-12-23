import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import fs from 'fs';

// --- 动态确定支持的语言 ---
const localesDir = path.join(__dirname, 'locales');
let dynamicSupportedLngs: string[] = [];
try {
  const entries = fs.readdirSync(localesDir, { withFileTypes: true });
  // Filter for .json files directly, assuming filenames are language codes (e.g., en-US.json)
  dynamicSupportedLngs = entries
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.json'))
    .map((dirent) => dirent.name.replace('.json', '')); // Extract lang code from filename
  console.log('[i18next] 动态检测到的语言:', dynamicSupportedLngs);
} catch (err) {
  console.error('[i18next] 读取 locales 目录时出错:', err);
  dynamicSupportedLngs = ['en-US']; // Fallback
}

export const defaultLng = 'en-US';
if (!dynamicSupportedLngs.includes(defaultLng)) {
  dynamicSupportedLngs.push(defaultLng);
  console.warn(`[i18next] 在检测到的文件中未找到默认语言 '${defaultLng}'，将其添加到支持列表中。`);
}
export const supportedLngs = dynamicSupportedLngs;
// --- 结束动态确定 ---

let i18nInitialized = false;
// Create a promise that resolves when i18next is initialized
const i18nInitializationPromise = new Promise<void>((resolve, reject) => {
  i18next.use(Backend).init(
    {
      debug: false, // 强制禁用 i18next 调试日志
      supportedLngs,
      fallbackLng: defaultLng,
      preload: supportedLngs,
      // ns and defaultNS removed as translations are now in root language files (e.g., en-US.json)
      backend: {
        loadPath: path.join(localesDir, '{{lng}}.json'), // Load root JSON files directly
      },
      interpolation: {
        escapeValue: false,
      },
    },
    (err, t) => {
      // Init callback
      if (err) {
        console.error('[i18next] 初始化过程中出错:', err);
        i18nInitialized = false; // Mark as not initialized on error
        return reject(err); // Reject the promise on error
      }
      console.log('[i18next] 初始化完成。已加载语言:', Object.keys(i18next.store.data || {})); // Safe access to store.data
      i18nInitialized = true; // Mark as initialized
      resolve(); // Resolve the promise on success
    }
  );
});

// Export the promise and a function to check status (optional)
export { i18nInitializationPromise, i18nInitialized };
export default i18next; // Export the instance as well

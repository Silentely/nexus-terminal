import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';
import jaJP from '../locales/ja-JP.json';

const languages = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

export function getTranslation(key: string, locale: string = 'zh-CN'): string {
  const keys = key.split('.');
  let current: any = languages[locale as keyof typeof languages] || languages['zh-CN'];

  for (const k of keys) {
    current = current[k];
    if (!current) {
      return key;
    }
  }

  return current;
}

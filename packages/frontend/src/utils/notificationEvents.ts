/**
 * 通知事件名称展示工具
 *
 * 集中处理通知事件的 i18n 翻译与缺失翻译的 fallback 逻辑，
 * 供 NotificationSettings.vue 与 NotificationSettingForm.vue 复用，避免重复实现。
 */

/**
 * 翻译单个通知事件名
 * @param event 后端 AppEventType 事件标识，如 'LOGIN_SUCCESS'
 * @param t i18n 翻译函数（由调用方注入）
 * @returns 翻译后的事件名；若翻译缺失则回退为空格分隔的首字母大写形式
 */
export function getNotificationEventDisplayName(event: string, t: (key: string) => string): string {
  const i18nKey = `settings.notifications.events.${event}`;
  const translated = t(i18nKey);
  // 翻译缺失时 i18n 返回 key 本身，此时回退为可读的事件名
  if (translated === i18nKey) {
    return event
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }
  return translated;
}

/**
 * 拼接多个事件名的展示文本（用于列表项的触发事件摘要）
 * @param events 事件标识数组
 * @param t i18n 翻译函数
 * @param noEventsText 无事件时显示的文案（由调用方传入已翻译文本）
 * @param triggerPrefix 前缀文案（由调用方传入已翻译文本）
 */
export function getNotificationEventsSummary(
  events: string[],
  t: (key: string) => string,
  noEventsText: string,
  triggerPrefix: string,
): string {
  if (!events || events.length === 0) return noEventsText;
  const translatedNames = events.map((event) => getNotificationEventDisplayName(event, t));
  return `${triggerPrefix}: ${translatedNames.join(', ')}`;
}

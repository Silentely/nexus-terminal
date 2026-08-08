/**
 * 通知模板渲染工具
 * 从 notification.service 提取，便于独立复用与测试。
 * 职责：占位符插值、{event} → {eventDisplay} 归一化、自定义模板渲染。
 */

/** 将 {key} 占位符替换为 data 中对应值；无模板时返回默认文本 */
export function renderTemplate(
  template: string | undefined,
  data: Record<string, string>,
  defaultText: string,
): string {
  if (!template) return defaultText;
  let rendered = template;
  for (const key of Object.keys(data)) {
    rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key]);
  }
  return rendered;
}

/** 归一化 {event} 占位符为 {eventDisplay}（兼容旧模板写法） */
export function normalizeEventPlaceholder(template: string): string {
  return template.replace(/\{event\}/g, '{eventDisplay}');
}

/**
 * 渲染自定义模板：先归一化 {event} 占位符再插值；
 * 未配置模板时直接返回默认文本。
 */
export function renderCustomTemplate(
  template: string | undefined,
  data: Record<string, string>,
  defaultText: string,
): string {
  if (!template) return defaultText;
  return renderTemplate(normalizeEventPlaceholder(template), data, defaultText);
}

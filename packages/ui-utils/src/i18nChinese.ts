/**
 * 文件作用：i18nChinese 工具函数（共享版）
 * 从 platform/frontend/gis-platform-ui/src/utils/i18nChinese.ts 迁移而来，
 * 供 platform 及 extensions 共用。
 * 2026-07-20：转换器改为复用 convertChinese 的按需创建实例（'t2s' 方向），
 * opencc-js 由平台宿主统一提供，扩展包构建时 external 不再打包字典。
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-13
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-13) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import { convertText } from './convertChinese'

/** 本地存储语言模式的键名 */
const STORAGE_KEY = 'gis-tide-lang-mode'

/** OpenCC 繁体（台湾）转简体（大陆）转换器（与 convertText 't2s' 共享同一实例） */
export const converter = (text: string): string => convertText(text, 't2s') as string

/** 语言模式：cn 为简体，tw 为繁体 */
export type LangMode = 'cn' | 'tw'

/**
 * 获取当前语言模式
 * @returns LangMode 当前语言模式，默认 'cn'
 */
export function getLangMode(): LangMode {
  return (localStorage.getItem(STORAGE_KEY) as LangMode) || 'cn'
}

/**
 * 设置语言模式并持久化到 localStorage
 * @param mode - 目标语言模式
 */
export function setLangMode(mode: LangMode) {
  localStorage.setItem(STORAGE_KEY, mode)
}

/**
 * 判断当前是否为简体模式
 * @returns boolean
 */
export function isSimplified(): boolean {
  return getLangMode() === 'cn'
}

/**
 * 繁简转换辅助函数
 * @param text - 待转换文本
 * @returns string | undefined | null 转换后的文本；繁体模式直接返回原值
 */
export function t(text: string | undefined | null): string | undefined | null {
  if (!text) return text
  if (getLangMode() === 'tw') return text
  return converter(String(text))
}

/**
 * 切换语言模式
 * @returns LangMode 切换后的语言模式
 */
export function toggleLangMode(): LangMode {
  const next = isSimplified() ? 'tw' : 'cn'
  setLangMode(next)
  return next
}

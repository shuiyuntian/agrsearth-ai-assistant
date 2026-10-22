/**
 * 文件作用：useChineseLang 组合式函数（模板仓 vendored 共享包 @agrsearth/ui-utils）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 自平台仓 extensions/_shared/ui-utils/src/useChineseLang.ts vendor（内容同源）
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */
import { ref, computed } from 'vue'
import { converter, type LangMode, getLangMode, setLangMode } from './i18nChinese'

// 全局共享的简繁状态，确保面板、弹窗等所有组件同步
const globalLangMode = ref<LangMode>(getLangMode())

/**
 * 中文繁简切换组合式函数
 * @description 提供全局共享的繁体/简体状态与转换函数
 * @returns 语言模式、是否简体、转换函数、切换函数
 */
export function useChineseLang() {
  const langMode = globalLangMode

  /** 是否为简体模式 */
  const isSimplified = computed(() => langMode.value === 'cn')

  /**
   * 繁简转换
   * @param text - 待转换文本
   * @returns 转换后的文本；繁体模式直接返回原值
   */
  const t = (text: string | undefined | null): string | undefined | null => {
    if (!text) return text
    return langMode.value === 'tw' ? text : converter(String(text))
  }

  /**
   * 切换繁简语言模式并持久化
   */
  const toggleLangMode = () => {
    const next = langMode.value === 'cn' ? 'tw' : 'cn'
    langMode.value = next
    setLangMode(next)
  }

  return {
    /** 当前语言模式（cn/tw） */
    langMode,
    /** 是否为简体 */
    isSimplified,
    /** 繁简转换函数 */
    t,
    /** 切换语言模式 */
    toggleLangMode
  }
}

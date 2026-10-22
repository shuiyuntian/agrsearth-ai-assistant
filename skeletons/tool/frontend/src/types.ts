/**
 * 文件作用：扩展本地类型（可选模式：CapabilityContext 子集声明）
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-09-14
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-09-14) 模板仓骨架初始版本。模板内经 @agrsearth/sdk-types 提供完整
 *                       CapabilityContext 类型；本文件保留「最小子集」声明模式，
 *                       团队如希望收窄类型面可改用本接口并在 index.ts 中替换类型来源
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

/** CapabilityContext 最小子集（按插件实际用到的能力裁剪） */
export interface CapabilityContextLike {
  readonly viewer: any
  readonly container: HTMLElement
  readonly manifest: { id: string; name: string; version: string; [k: string]: any }
  readonly http: {
    get: <T = any>(url: string, params?: Record<string, any>) => Promise<T>
    post: <T = any>(url: string, body?: any) => Promise<T>
  }
  readonly camera: {
    flyTo: (options: any) => void
  }
  readonly entities: {
    add: (options: any) => any
    remove: (entity: any) => void
    removeAll: () => void
    getById: (id: string) => any
  }
  readonly ui: {
    createPanel: (options: any) => any
  }
}

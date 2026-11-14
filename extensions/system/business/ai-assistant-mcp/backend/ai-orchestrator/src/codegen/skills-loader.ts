/**
 * 文件作用：skills-loader 模块
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：2026-07-23
 * 版本：1.0.0
 * 修改记录：
 *   - 1.0.0 (2026-07-23) 初始创建
 *
 * 版权所有 (C) 2026 AGRSEarth 项目
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 领域技能加载 + BM25 检索（P3-A grounding）。
 *
 * 从 CODEGEN_SKILLS_DIR（默认仓库根 .kimi-code/skills）加载 cesiumjs-*​/SKILL.md，
 * 取 frontmatter description + 正文；按用户 intent 用轻量 BM25（无外部依赖）选 top N 域。
 *
 * CJK 处理：skill 文档为英文，intent 常为中文 —— tokenizer 产出拉丁词 + CJK 二元组，
 * 并内置 GIS 领域同义词表把中文意图词扩展为英文 token（圆→circle/ellipse 等）。
 */
export interface SkillDoc {
  /** 目录名，如 cesiumjs-entities */
  id: string;
  description: string;
  body: string;
  path: string;
}

/** CJK → 英文领域同义词（检索扩展用，非穷尽，可按需补充） */
const CJK_SYNONYMS: Record<string, string[]> = {
  圆: ["circle", "ellipse"],
  椭圆: ["ellipse"],
  多边形: ["polygon"],
  矩形: ["rectangle"],
  折线: ["polyline"],
  线: ["polyline", "line"],
  点: ["point"],
  标签: ["label"],
  文字: ["label", "text"],
  模型: ["model", "gltf"],
  图标: ["billboard"],
  广告牌: ["billboard"],
  标记: ["billboard", "label", "point", "marker"],
  实体: ["entity", "entities"],
  相机: ["camera"],
  视角: ["camera", "view"],
  飞: ["camera", "flyto", "fly"],
  飞行: ["camera", "flyto", "fly"],
  轨道: ["camera", "orbit"],
  图层: ["layer", "imagery"],
  影像: ["imagery"],
  底图: ["imagery", "basemap"],
  地形: ["terrain"],
  高度: ["height", "terrain"],
  高程: ["elevation", "terrain"],
  光照: ["lighting"],
  阴影: ["shadow"],
  天气: ["weather"],
  时间: ["clock", "time"],
  动画: ["animation"],
  路径: ["path"],
  漫游: ["animation", "path"],
  裁剪: ["clipping"],
  瓦片: ["tile", "tiles", "tileset"],
  倾斜摄影: ["tileset"],
  粒子: ["particle"],
  材质: ["material"],
  着色器: ["shader"],
  量测: ["measure"],
  测量: ["measure"],
  半径: ["radius"],
  中心: ["center"],
  删除: ["remove"],
  列表: ["list"],
  位置: ["position"],
  坐标: ["coordinate", "position"],
};

/** 解析 SKILL.md frontmatter（---\nkey: value\n---），取 description + 正文 */
export function parseSkillMarkdown(content: string): {
  description: string;
  body: string;
} {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { description: "", body: content };
  const frontmatter = m[1] ?? "";
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  return {
    description: (descMatch?.[1] ?? "").trim(),
    body: content.slice(m[0].length),
  };
}

export function loadSkills(skillsDir: string): SkillDoc[] {
  if (!fs.existsSync(skillsDir)) return [];
  const docs: SkillDoc[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("cesiumjs-")) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const { description, body } = parseSkillMarkdown(
      fs.readFileSync(skillFile, "utf8"),
    );
    docs.push({ id: entry.name, description, body, path: skillFile });
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 轻量 BM25
// ---------------------------------------------------------------------------

/** 拉丁词（小写）+ CJK 同义词扩展（贪婪最长匹配，多边形/实体等多字词可命中） */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]*/g);
  if (latin) tokens.push(...latin);

  const keysByLen = Object.keys(CJK_SYNONYMS).sort(
    (a, b) => b.length - a.length,
  );
  const cjkRuns = text.match(/[一-鿿]+/g) ?? [];
  for (const run of cjkRuns) {
    let i = 0;
    while (i < run.length) {
      let matched = false;
      for (const key of keysByLen) {
        if (run.startsWith(key, i)) {
          tokens.push(...CJK_SYNONYMS[key]!);
          i += key.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        tokens.push(run[i]!);
        i += 1;
      }
    }
  }
  return tokens;
}

interface BM25Index {
  docs: string[][];
  docLen: number[];
  avgDl: number;
  df: Map<string, number>;
  n: number;
}

function buildIndex(docs: string[][]): BM25Index {
  const df = new Map<string, number>();
  const docLen: number[] = [];
  let total = 0;
  for (const d of docs) {
    docLen.push(d.length);
    total += d.length;
    for (const term of new Set(d)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return { docs, docLen, avgDl: docs.length ? total / docs.length : 0, df, n: docs.length };
}

function bm25Score(index: BM25Index, query: string[], docIdx: number): number {
  const k1 = 1.5;
  const b = 0.75;
  const doc = index.docs[docIdx]!;
  const tf = new Map<string, number>();
  for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const term of new Set(query)) {
    const df = index.df.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
    const f = tf.get(term) ?? 0;
    const dl = index.docLen[docIdx] ?? 0;
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / (index.avgDl || 1))));
  }
  return score;
}

/**
 * 按 intent 选 top N 技能域。
 * 检索文档 = description + 正文（正文截前 6000 字符，控制索引体积）。
 */
export function selectSkills(
  intent: string,
  docs: SkillDoc[],
  maxSkills: number = 1,
): SkillDoc[] {
  if (docs.length === 0) return [];
  const index = buildIndex(
    docs.map((d) => tokenize(`${d.id} ${d.description} ${d.body.slice(0, 6000)}`)),
  );
  const query = tokenize(intent);
  const scored = docs
    .map((doc, i) => ({ doc, score: bm25Score(index, query, i) }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, maxSkills)).map((s) => s.doc);
}

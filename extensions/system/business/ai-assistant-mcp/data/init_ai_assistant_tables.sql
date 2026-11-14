-- 文件作用：init_ai_assistant_tables SQL 脚本
-- 作者：JasonLee <shuiyuntian@foxmail.com>
-- 创建日期：2026-07-23
-- 版本：1.0.2
-- 修改记录：
--   - 1.0.2 (2026-10-18) 口径修正：目标库实为 ry_cloud（生产 deployment MYSQL_URL 指向 ry_cloud，DDL 已在 ry_cloud 执行）；ai_admin 独立库方案作废
--   - 1.0.1 (2026-10-05) 包更名收口 ai-assistant→ai-assistant-mcp：注释同步新名（表名 ai_config/ai_operation_log 不变）
--   - 1.0.0 (2026-07-23) 初始创建
--
-- 版权所有 (C) 2026 AGRSEarth 项目

-- ============================================================================
-- ai-assistant-mcp 管理面 DDL（P2-A）
-- 单一事实源：extensions/system/business/ai-assistant-mcp/data/init_ai_assistant_tables.sql
-- 目标库：ry_cloud（utf8mb4；2026-10-18 口径修正——生产/测试均并入 ry_cloud，不再单建 ai_admin 库）
-- 执行：mysql -uroot -p ry_cloud < init_ai_assistant_tables.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ai_config：AI 助手运行时配置（单行 JSON，id 恒为 1）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ai_config` (
  `id` TINYINT NOT NULL DEFAULT 1 COMMENT '恒为 1（单行配置）',
  `config_json` JSON NOT NULL COMMENT '配置 JSON，键见初始行',
  `update_by` VARCHAR(64) DEFAULT NULL COMMENT '最后修改人',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后修改时间',
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_ai_config_single` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 助手运行时配置（单行）';

INSERT INTO `ai_config` (`id`, `config_json`, `update_by`) VALUES
(1, '{
  "llmBaseUrl": "https://llm.example.invalid/v1",
  "llmModel": "external-model",
  "llmApiKeyRef": null,
  "agentMaxSteps": 8,
  "temperature": null,
  "maxTokens": null,
  "rateLimitRpm": 20,
  "enabledTools": null,
  "approvalPolicy": ["animation_remove", "entity_remove", "imagery_remove", "terrain_remove", "tileset_remove"],
  "codegenEnabled": false
}', 'init')
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

-- ----------------------------------------------------------------------------
-- ai_operation_log：操作审计/用量（tool 调用、LLM 完成、审批事件）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ai_operation_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(16) NOT NULL COMMENT 'tool|llm|approval',
  `username` VARCHAR(64) DEFAULT NULL COMMENT '操作人',
  `session_id` VARCHAR(64) DEFAULT NULL COMMENT '会话 ID',
  `tool_name` VARCHAR(64) DEFAULT NULL COMMENT '工具名（kind=tool/approval）',
  `risk_level` VARCHAR(16) DEFAULT NULL COMMENT 'read|write|destructive',
  `args_summary` VARCHAR(512) DEFAULT NULL COMMENT '参数摘要（截断）',
  `outcome` VARCHAR(32) DEFAULT NULL COMMENT 'success|error|validation_failed|denied|timeout 等',
  `approval_status` VARCHAR(16) DEFAULT NULL COMMENT 'approved|denied|timeout（kind=approval）',
  `duration_ms` INT DEFAULT NULL COMMENT '耗时（毫秒）',
  `model` VARCHAR(128) DEFAULT NULL COMMENT 'LLM 模型（kind=llm）',
  `prompt_tokens` INT DEFAULT NULL COMMENT '输入 tokens（kind=llm）',
  `completion_tokens` INT DEFAULT NULL COMMENT '输出 tokens（kind=llm）',
  `ip` VARCHAR(64) DEFAULT NULL COMMENT '来源 IP',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_username` (`username`),
  KEY `idx_tool` (`tool_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 助手操作审计/用量';

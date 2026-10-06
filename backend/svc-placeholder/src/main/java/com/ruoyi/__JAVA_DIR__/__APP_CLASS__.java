/**
 * 文件作用：__PKG_NAME__ 后端微服务启动类
 * 作者：JasonLee <shuiyuntian@foxmail.com>
 * 创建日期：__TODAY__
 * 版本：0.1.0
 * 修改记录：
 *   - 0.1.0 (__TODAY__) 脚手架初始创建（create-extension.sh）
 *
 * 版权所有 (C) 2026 CesiumAI 项目
 */

package com.ruoyi.__JAVA_DIR__;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * __PKG_NAME__ 后端微服务启动类
 * <p>
 * Nacos 注册名取 spring.application.name（= manifest.backendServices[].serviceId = __SVC_ID__）。
 * scanBasePackages 保留 com.ruoyi 以装入 ruoyi-common-* 的自动配置 Bean。
 * </p>
 */
@EnableDiscoveryClient
@SpringBootApplication(scanBasePackages = {"com.ruoyi"})
public class __APP_CLASS__ {

    private static final Logger log = LoggerFactory.getLogger(__APP_CLASS__.class);

    public static void main(String[] args) {
        SpringApplication.run(__APP_CLASS__.class, args);
        log.info("=== __SVC_ID__ started ===");
    }
}

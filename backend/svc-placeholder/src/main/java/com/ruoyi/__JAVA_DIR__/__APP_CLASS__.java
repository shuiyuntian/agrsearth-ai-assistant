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
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * __PKG_NAME__ 后端微服务启动类
 * <p>
 * Nacos 注册名取 spring.application.name（= manifest.backendServices[].serviceId = __SVC_ID__）。
 * scanBasePackages 保留 com.ruoyi 以装入 ruoyi-common-* 的自动配置 Bean。
 * ruoyi-common-security 传递引入 mybatis/HikariCP——本骨架默认无数据库，必须排除
 * DataSourceAutoConfiguration，否则启动即失败（Failed to determine a suitable driver class）；
 * 服务需要数据库时删除 exclude 并按 RuoYi 惯例配置数据源。
 * </p>
 */
@EnableDiscoveryClient
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class}, scanBasePackages = {"com.ruoyi"})
public class __APP_CLASS__ {

    private static final Logger log = LoggerFactory.getLogger(__APP_CLASS__.class);

    public static void main(String[] args) {
        SpringApplication.run(__APP_CLASS__.class, args);
        log.info("=== __SVC_ID__ started ===");
    }
}

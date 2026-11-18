CREATE TABLE `platform_mcp_audit` (
	`id` char(36) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`actor_name` varchar(100) NOT NULL,
	`before_value` json,
	`after_value` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_mcp_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_mcp_partners` (
	`id` char(36) NOT NULL,
	`name` varchar(60) NOT NULL,
	`remark` varchar(200) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`search_permission` json NOT NULL,
	`detail_permission` json NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `platform_mcp_partners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_mcp_audit` ADD CONSTRAINT `platform_mcp_audit_actor_id_admin_accounts_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `platform_mcp_audit_created_idx` ON `platform_mcp_audit` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `platform_mcp_partners_created_idx` ON `platform_mcp_partners` (`created_at`,`id`);